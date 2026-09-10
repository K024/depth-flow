export interface DepthMapNormalization {
  applied: boolean
  inputRange: [number, number]
  robustRange: [number, number]
}

const coverageThreshold = 0.8 * 255

function quantileFromHistogram(histogram: Uint32Array, pixelCount: number, quantile: number) {
  const target = Math.max(0, Math.ceil(pixelCount * quantile) - 1)
  let cumulative = 0
  for (let value = 0; value < histogram.length; value++) {
    cumulative += histogram[value]
    if (cumulative > target)
      return value
  }
  return histogram.length - 1
}

/**
 * Convert color/grayscale input to numeric grayscale. Preserve maps whose
 * 1st–99th percentile range covers at least 80% of 0–255; otherwise stretch
 * that robust range to avoid isolated black/white outliers suppressing depth.
 */
export function normalizeDepthMap(depthMap: ImageData): {
  image: ImageData
  normalization: DepthMapNormalization
} {
  const histogram = new Uint32Array(256)
  const grayscale = new ImageData(depthMap.width, depthMap.height)
  let min = 255
  let max = 0

  for (let i = 0; i < depthMap.data.length; i += 4) {
    const value = Math.round(
      depthMap.data[i] * 0.2126
      + depthMap.data[i + 1] * 0.7152
      + depthMap.data[i + 2] * 0.0722,
    )
    grayscale.data[i] = value
    grayscale.data[i + 1] = value
    grayscale.data[i + 2] = value
    grayscale.data[i + 3] = 255
    histogram[value]++
    min = Math.min(min, value)
    max = Math.max(max, value)
  }

  const pixelCount = depthMap.width * depthMap.height
  const low = quantileFromHistogram(histogram, pixelCount, 0.01)
  const high = quantileFromHistogram(histogram, pixelCount, 0.99)
  if (high <= low)
    throw new Error("Depth map must contain more than one depth value")

  const normalization: DepthMapNormalization = {
    applied: high - low < coverageThreshold,
    inputRange: [min, max],
    robustRange: [low, high],
  }
  if (!normalization.applied)
    return { image: grayscale, normalization }

  for (let i = 0; i < grayscale.data.length; i += 4) {
    const normalized = Math.round(Math.max(0, Math.min(255,
      (grayscale.data[i] - low) / (high - low) * 255,
    )))
    grayscale.data[i] = normalized
    grayscale.data[i + 1] = normalized
    grayscale.data[i + 2] = normalized
  }

  return { image: grayscale, normalization }
}
