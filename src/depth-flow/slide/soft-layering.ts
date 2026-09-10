export interface SoftLayeringArgs {
  // Gaussian sigma in ACTUAL analysis-grid pixels. create-flow.ts resolves the
  // user-facing reference-grid value into this one; calculateTopVisibility's
  // effectiveWidth is only correct against the grid the blur really ran on.
  blurSigma: number
  // Both are normalized-disparity step heights, same unit as
  // bottomDepthEpsilon. See calculateTopVisibility.
  visibilityKnee: number
  visibilityCutoff: number
  disocclusionRho: number
  // The smallest disparity step, in the same normalized units as
  // visibilityCutoff and bottomDepthEpsilon, that counts as a real
  // disocclusion. This replaces the old (disocclusionGamma, repairThreshold)
  // pair: the mask only ever depended on them through atanh(threshold)/gamma,
  // so they were two sliders sharing one degree of freedom. See
  // resolveDisocclusionShaping for what gamma still does.
  repairScoreThreshold: number
}

// tanh's 10%-90% rise spans this much of its argument.
const tanhRiseSpan = Math.atanh(0.9) - Math.atanh(0.1)
const halfResponseArgument = Math.atanh(0.5)

/**
 * Split repairScoreThreshold into the (gamma, threshold) pair the soft map and
 * the mask cut still need.
 *
 * gamma no longer decides which pixels are repaired: thresholding
 * tanh(gamma * score) at tanh(gamma * t) is exactly score >= t for any gamma.
 * What it still does is shape the soft map before createRepairMasks upsamples
 * it to full resolution, so the right choice is the gamma that puts the cut on
 * tanh's steepest, most linear point — that is where bilinear interpolation
 * antialiases the boundary best, and it also pins the byte threshold at a
 * constant 128 instead of drifting with the setting.
 *
 * The second term backs gamma off when the first would squeeze the 10%-90%
 * transition below one native pixel, which would alias instead of feather. It
 * is inactive at the tuned defaults (rho 11, threshold 0.0183, 518 grid), where
 * this function reproduces the previous gamma of 30 and a 0.5 cut exactly, and
 * it starts to bite where the score rises steeply in space: below threshold
 * ~0.009 at rho 11, or across most of the threshold range at rho 24. The mask
 * stays exactly score >= threshold either way; only softThreshold moves off
 * 0.5.
 */
export function resolveDisocclusionShaping(
  args: Pick<SoftLayeringArgs, "disocclusionRho" | "repairScoreThreshold">,
  analysisShortEdge: number,
) {
  const linearCutGamma = halfResponseArgument / Math.max(args.repairScoreThreshold, 1e-6)
  const onePixelFeatherGamma =
    tanhRiseSpan * Math.max(analysisShortEdge - 1, 1) / Math.max(args.disocclusionRho, 1e-6)
  const gamma = Math.min(linearCutGamma, onePixelFeatherGamma)
  return {
    gamma,
    // Feed this to createRepairMasks; it is 0.5 whenever the feather guard is
    // inactive, which is the normal case.
    softThreshold: Math.tanh(gamma * args.repairScoreThreshold),
  }
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
  // Pass this to createRepairMasks. It is the repairScoreThreshold expressed in
  // the softDisocclusion map's own units.
  softDisocclusionThreshold: number
  disocclusionGamma: number
  stats: {
    gradientMagnitude: ImageValueStats
    topVisibility: ImageValueStats
    maxDisocclusionScore: ImageValueStats
    softDisocclusion: ImageValueStats
    lowVisibilityRatio: number
    opaqueVisibilityRatio: number
    zeroVisibilityRatio: number
    partialVisibilityRatio: number
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
  visibilityKnee: number,
  visibilityCutoff: number,
) {
  const visibility = new Float32Array(gradientMagnitude.length)
  // For a Gaussian-blurred disparity step ΔD, the peak gradient is
  // g ~= ΔD / sqrt(2πσ²). Multiplying by an effective width therefore recovers
  // the dimensionless step height E, so E is directly comparable to a raw
  // disparity difference (1-D simulation puts the recovery at 83–104%).
  //
  // Sobel contributes smoothing of its own, represented by the fitted 0.45
  // variance below. Without it, E/ΔD falls far below the accepted 0.85–1.05
  // range for σ < 1 and changing Blur Sigma also changes the knees' meaning.
  const effectiveWidth = Math.sqrt(2 * Math.PI * (blurSigma * blurSigma + 0.45))
  // A = 1 - smoothstep(knee², cutoff²) over E².
  //
  // This replaces SLIDE Eq. 4's A = exp(-βE²). The exponential has a single
  // knob, so its two 8-bit endpoints are locked together: A rounds to 255 at
  // βE² <= -ln(254.5/255) and to 0 at βE² >= ln(510), a fixed ratio of 56.36
  // in E no matter how β is tuned. In practice that means the darkest rim
  // bottomed out at 7/255 instead of 0 — never fully transparent, so every
  // depth edge kept a translucent rubber band roughly 10 native pixels wide,
  // and the band did not narrow as ΔD grew, it only got darker. Raising β did
  // not help: it dragged the opaque knee below the image's own median
  // gradient, making most of the frame slightly transparent from depth noise
  // alone.
  //
  // Two thresholds decouple the two ends. Below the knee A is exactly 1, which
  // keeps the shader's single-ray fast path (see opaqueVisibilityRatio) and
  // rejects depth-map noise outright; above the cutoff A is exactly 0, so the
  // stretched sheet is fully replaced by Bottom. smoothstep rather than a bare
  // clamp or a tanh: all three give the same endpoint statistics, but only
  // smoothstep is C1 at the knee, and the knee sits precisely on the
  // opaque/translucent boundary where a Mach band would be visible.
  //
  // Being C1 there is also what makes an aggressive knee affordable: at
  // knee = 0.02 the alpha loss is 0 LSB up to the gradient p90 and 0.35 LSB at
  // p95, where exp(-50E²) already lost 0.86 LSB at the median. The knee is
  // therefore tuned for cost, not for haze — it sets the width of the
  // partially transparent band, which is the only part the shader pays a
  // second ray search for. The cutoff alone decides how much becomes fully
  // transparent.
  const kneeSquared = visibilityKnee * visibilityKnee
  const cutoffSquared = visibilityCutoff * visibilityCutoff
  const inverseSpan = 1 / Math.max(cutoffSquared - kneeSquared, 1e-6)
  for (let i = 0; i < visibility.length; i++) {
    const stepHeight = gradientMagnitude[i] * effectiveWidth
    const ramp = (stepHeight * stepHeight - kneeSquared) * inverseSpan
    const t = ramp < 0 ? 0 : ramp > 1 ? 1 : ramp
    visibility[i] = 1 - t * t * (3 - 2 * t)
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

  // S = tanh(gamma * score). The mask cut is applied on S, but it is chosen as
  // tanh(gamma * repairScoreThreshold), so the decision is exactly
  // score >= repairScoreThreshold and gamma only sets how sharply S rises
  // through that cut. rho controls band width.
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
    args.visibilityKnee,
    args.visibilityCutoff,
  )
  const shaping = resolveDisocclusionShaping(args, Math.min(width, height))
  const { score, softDisocclusion, farReference } = calculateSoftDisocclusion(
    disocclusionValues,
    farReferenceValues,
    width,
    height,
    args.disocclusionRho,
    shaping.gamma,
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
    softDisocclusionThreshold: shaping.softThreshold,
    disocclusionGamma: shaping.gamma,
    stats: {
      gradientMagnitude: calculateStats(gradientMagnitude),
      topVisibility: calculateStats(topVisibility),
      maxDisocclusionScore: calculateStats(score),
      softDisocclusion: calculateStats(softDisocclusion),
      lowVisibilityRatio: ratioMatching(topVisibility, value => value < 0.5),
      opaqueVisibilityRatio: ratioMatching(topVisibility, value => value >= 254.5 / 255),
      // A hard 0 is what actually removes the rubber band; exp(-βE²) could
      // never produce one. A hard 1 and a hard 0 both skip the second ray
      // search, so partialVisibilityRatio is the real shader cost.
      zeroVisibilityRatio: ratioMatching(topVisibility, value => value < 0.5 / 255),
      partialVisibilityRatio: ratioMatching(
        topVisibility,
        value => value >= 0.5 / 255 && value < 254.5 / 255,
      ),
      // Reported on the raw score so the number stays comparable across
      // settings; it is the native-grid preview of the final repair ratio.
      disocclusionRatio: ratioMatching(score, value => value >= args.repairScoreThreshold),
    },
  }
}
