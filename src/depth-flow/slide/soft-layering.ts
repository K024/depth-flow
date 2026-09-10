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
  // A Gaussian-blurred unit step has peak gradient
  // 1 / (sigma * sqrt(2 PI)); multiplying by this width recovers step height.
  // At sigma=0, Sobel's central difference needs a factor of two for a hard step.
  const effectiveWidth = blurSigma > 0
    ? blurSigma * Math.sqrt(2 * Math.PI)
    : 2
  for (let i = 0; i < visibility.length; i++) {
    const stepHeight = gradientMagnitude[i] * effectiveWidth
    visibility[i] = Math.exp(-betaStep * stepHeight * stepHeight)
  }
  return visibility
}

function calculateSoftDisocclusion(
  disparity: Float32Array,
  width: number,
  height: number,
  rho: number,
  gamma: number,
) {
  const score = new Float32Array(disparity.length)
  const softDisocclusion = new Float32Array(disparity.length)

  const envelope = new Float32Array(Math.max(width, height))

  const accumulateLine = (start: number, length: number, stride: number, step: number) => {
    envelope[0] = disparity[start]
    for (let i = 1; i < length; i++) {
      const index = start + i * stride
      envelope[i] = Math.min(disparity[index], envelope[i - 1] + rho * step)
    }
    for (let i = length - 2; i >= 0; i--) {
      envelope[i] = Math.min(envelope[i], envelope[i + 1] + rho * step)
    }
    for (let i = 0; i < length; i++) {
      const index = start + i * stride
      score[index] = Math.max(score[index], disparity[index] - envelope[i])
    }
  }

  const horizontalStep = 1 / Math.max(1, width - 1)
  const verticalStep = 1 / Math.max(1, height - 1)
  for (let y = 0; y < height; y++)
    accumulateLine(y * width, width, 1, horizontalStep)
  for (let x = 0; x < width; x++)
    accumulateLine(x, height, width, verticalStep)

  for (let i = 0; i < score.length; i++)
    softDisocclusion[i] = Math.tanh(gamma * score[i])

  return { score, softDisocclusion }
}

export async function createSoftLayeringDiagnostics(
  topDisparity: ImageData,
  disocclusionDisparity: ImageData,
  args: SoftLayeringArgs,
): Promise<SoftLayeringDiagnostics> {
  if (
    topDisparity.width !== disocclusionDisparity.width
    || topDisparity.height !== disocclusionDisparity.height
  ) {
    throw new Error("Top and disocclusion disparity maps must have the same size")
  }

  const { width, height } = topDisparity
  const topValues = valuesFromImageData(topDisparity)
  const disocclusionValues = valuesFromImageData(disocclusionDisparity)
  const gradientMagnitude = calculateSobelMagnitude(topValues, width, height)
  const topVisibility = calculateTopVisibility(
    gradientMagnitude,
    args.blurSigma,
    args.betaStep,
  )
  const { score, softDisocclusion } = calculateSoftDisocclusion(
    disocclusionValues,
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
