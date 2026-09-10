export interface SoftLayeringArgs {
  blurSigma: number
  betaStep: number
  disocclusionRho: number
  disocclusionGamma: number
}

export interface ImageValueStats {
  min: number
  max: number
  mean: number
}

export interface SoftLayeringDiagnostics {
  sourceDisparity: ImageData
  gradientMagnitude: ImageData
  topVisibility: ImageData
  maxDisocclusionScore: ImageData
  softDisocclusion: ImageData
  farReference: Float32Array
  farReferenceImage: ImageData
  stats: {
    gradientMagnitude: ImageValueStats
    topVisibility: ImageValueStats
    maxDisocclusionScore: ImageValueStats
    softDisocclusion: ImageValueStats
    lowVisibilityRatio: number
    opaqueVisibilityRatio: number
    disocclusionRatio: number
  }
}

function imageDataFromValues(values: Float32Array, width: number, height: number) {
  const output = new ImageData(width, height)
  for (let i = 0; i < values.length; i++) {
    const value = Math.round(Math.max(0, Math.min(1, values[i])) * 255)
    const outputIndex = i * 4
    output.data[outputIndex] = value
    output.data[outputIndex + 1] = value
    output.data[outputIndex + 2] = value
    output.data[outputIndex + 3] = 255
  }
  return output
}

function valuesFromImageData(image: ImageData) {
  const values = new Float32Array(image.width * image.height)
  for (let i = 0; i < values.length; i++)
    values[i] = image.data[i * 4] / 255
  return values
}

function calculateStats(values: Float32Array): ImageValueStats {
  let min = Infinity
  let max = -Infinity
  let sum = 0

  for (const value of values) {
    min = Math.min(min, value)
    max = Math.max(max, value)
    sum += value
  }

  return {
    min,
    max,
    mean: values.length > 0 ? sum / values.length : 0,
  }
}

function ratioMatching(values: Float32Array, predicate: (value: number) => boolean) {
  let matches = 0
  for (const value of values) {
    if (predicate(value))
      matches++
  }
  return values.length > 0 ? matches / values.length : 0
}

function sampleClamped(values: Float32Array, width: number, height: number, x: number, y: number) {
  const sampleX = Math.max(0, Math.min(width - 1, x))
  const sampleY = Math.max(0, Math.min(height - 1, y))
  return values[sampleY * width + sampleX]
}

function calculateSobelMagnitude(disparity: Float32Array, width: number, height: number) {
  const magnitude = new Float32Array(disparity.length)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const topLeft = sampleClamped(disparity, width, height, x - 1, y - 1)
      const top = sampleClamped(disparity, width, height, x, y - 1)
      const topRight = sampleClamped(disparity, width, height, x + 1, y - 1)
      const left = sampleClamped(disparity, width, height, x - 1, y)
      const right = sampleClamped(disparity, width, height, x + 1, y)
      const bottomLeft = sampleClamped(disparity, width, height, x - 1, y + 1)
      const bottom = sampleClamped(disparity, width, height, x, y + 1)
      const bottomRight = sampleClamped(disparity, width, height, x + 1, y + 1)

      const gradientX = (
        -topLeft + topRight
        - 2 * left + 2 * right
        - bottomLeft + bottomRight
      ) / 8
      const gradientY = (
        -topLeft - 2 * top - topRight
        + bottomLeft + 2 * bottom + bottomRight
      ) / 8

      magnitude[y * width + x] = Math.hypot(gradientX, gradientY)
    }
  }

  return magnitude
}

function calculateTopVisibility(
  gradientMagnitude: Float32Array,
  blurSigma: number,
  betaStep: number,
) {
  const visibility = new Float32Array(gradientMagnitude.length)
  // For a Gaussian-blurred disparity step ΔD, the peak gradient is
  // g ~= ΔD / sqrt(2πσ²). Multiplying by an effective width therefore recovers
  // the dimensionless step height E, and visibility is A = exp(-βE²).
  //
  // Sobel contributes smoothing of its own, represented by the fitted 0.45
  // variance below. Without it, E/ΔD falls far below the accepted 0.85–1.05
  // range for σ < 1 and changing Blur Sigma also changes Beta's meaning.
  const effectiveWidth = Math.sqrt(2 * Math.PI * (blurSigma * blurSigma + 0.45))
  for (let i = 0; i < visibility.length; i++) {
    const stepHeight = gradientMagnitude[i] * effectiveWidth
    visibility[i] = Math.exp(-betaStep * stepHeight * stepHeight)
  }
  return visibility
}

function calculateSoftDisocclusion(
  disparity: Float32Array,
  valueSource: Float32Array,
  width: number,
  height: number,
  rho: number,
  gamma: number,
) {
  const score = new Float32Array(disparity.length)
  const softDisocclusion = new Float32Array(disparity.length)
  const farReference = new Float32Array(valueSource)

  const envelope = new Float32Array(Math.max(width, height))
  const argmin = new Int32Array(Math.max(width, height))

  const accumulateLine = (start: number, length: number, stride: number, step: number) => {
    // Exact two-pass min-plus envelope:
    //   g(i) = min_j(D(j) + rho * step * |i-j|)
    // so D(i)-g(i) is the inner max term from SLIDE Eq. 5. The j=i term makes
    // the score non-negative, eliminating both an arbitrary scan radius and an
    // explicit ReLU. rho is measured in normalized image-axis coordinates, so
    // horizontal and vertical scans intentionally do not use the aspect ratio.
    envelope[0] = disparity[start]
    argmin[0] = 0
    for (let i = 1; i < length; i++) {
      const index = start + i * stride
      const propagated = envelope[i - 1] + rho * step
      if (disparity[index] <= propagated) {
        envelope[i] = disparity[index]
        argmin[i] = i
      } else {
        envelope[i] = propagated
        argmin[i] = argmin[i - 1]
      }
    }
    for (let i = length - 2; i >= 0; i--) {
      const propagated = envelope[i + 1] + rho * step
      if (propagated < envelope[i]) {
        envelope[i] = propagated
        argmin[i] = argmin[i + 1]
      }
    }
    for (let i = 0; i < length; i++) {
      const index = start + i * stride
      const axisScore = disparity[index] - envelope[i]
      if (axisScore > score[index]) {
        score[index] = axisScore
        // Geometry is detected on max-pooled disparity so the repair mask stays
        // conservative and aligned with Top. The value must come from raw depth:
        // taking it from the pool raises the supposedly far sample near contours
        // and regresses aboveBoundaryMedianRatio.
        farReference[index] = valueSource[start + argmin[i] * stride]
      }
    }
  }

  const horizontalStep = 1 / Math.max(1, width - 1)
  const verticalStep = 1 / Math.max(1, height - 1)
  for (let y = 0; y < height; y++)
    accumulateLine(y * width, width, 1, horizontalStep)
  for (let x = 0; x < width; x++)
    accumulateLine(x, height, width, verticalStep)

  // S = tanh(gamma * score). After thresholding at t, the smallest retained
  // score is atanh(t)/gamma. rho controls band width; gamma and the later
  // threshold control the soft response to weak disparity steps.
  for (let i = 0; i < score.length; i++)
    softDisocclusion[i] = Math.tanh(gamma * score[i])

  return { score, softDisocclusion, farReference }
}

export async function createSoftLayeringDiagnostics(
  topDisparity: ImageData,
  disocclusionDisparity: ImageData,
  farReferenceValueSource: ImageData,
  args: SoftLayeringArgs,
): Promise<SoftLayeringDiagnostics> {
  if (
    topDisparity.width !== disocclusionDisparity.width
    || topDisparity.height !== disocclusionDisparity.height
    || topDisparity.width !== farReferenceValueSource.width
    || topDisparity.height !== farReferenceValueSource.height
  ) {
    throw new Error("Soft-layering disparity maps must have the same size")
  }

  const { width, height } = topDisparity
  const topValues = valuesFromImageData(topDisparity)
  const disocclusionValues = valuesFromImageData(disocclusionDisparity)
  const farReferenceValues = valuesFromImageData(farReferenceValueSource)
  const gradientMagnitude = calculateSobelMagnitude(topValues, width, height)
  const topVisibility = calculateTopVisibility(
    gradientMagnitude,
    args.blurSigma,
    args.betaStep,
  )
  const { score, softDisocclusion, farReference } = calculateSoftDisocclusion(
    disocclusionValues,
    farReferenceValues,
    width,
    height,
    args.disocclusionRho,
    args.disocclusionGamma,
  )

  // score is non-negative and disparity is normalized, so it can be displayed directly.
  return {
    sourceDisparity: topDisparity,
    gradientMagnitude: imageDataFromValues(gradientMagnitude, width, height),
    topVisibility: imageDataFromValues(topVisibility, width, height),
    maxDisocclusionScore: imageDataFromValues(score, width, height),
    softDisocclusion: imageDataFromValues(softDisocclusion, width, height),
    farReference,
    farReferenceImage: imageDataFromValues(farReference, width, height),
    stats: {
      gradientMagnitude: calculateStats(gradientMagnitude),
      topVisibility: calculateStats(topVisibility),
      maxDisocclusionScore: calculateStats(score),
      softDisocclusion: calculateStats(softDisocclusion),
      lowVisibilityRatio: ratioMatching(topVisibility, value => value < 0.5),
      opaqueVisibilityRatio: ratioMatching(topVisibility, value => value >= 254.5 / 255),
      disocclusionRatio: ratioMatching(softDisocclusion, value => value > 0.5),
    },
  }
}
