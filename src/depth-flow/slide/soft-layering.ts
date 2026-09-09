import { scaleImageData } from "../image/utils"


export interface SoftLayeringArgs {
  analysisResolution: number
  visibilityBeta: number
  disocclusionRho: number
  disocclusionGamma: number
  disocclusionRadius: number
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

function calculateTopVisibility(gradientMagnitude: Float32Array, beta: number) {
  const visibility = new Float32Array(gradientMagnitude.length)
  for (let i = 0; i < visibility.length; i++) {
    const gradient = gradientMagnitude[i]
    visibility[i] = Math.exp(-beta * gradient * gradient)
  }
  return visibility
}

function calculateSoftDisocclusion(
  disparity: Float32Array,
  width: number,
  height: number,
  radius: number,
  rho: number,
  gamma: number,
) {
  const score = new Float32Array(disparity.length)
  const softDisocclusion = new Float32Array(disparity.length)
  const aspectRatio = width / height
  const inverseWidth = aspectRatio / Math.max(1, width - 1)
  const inverseHeight = 1 / Math.max(1, height - 1)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x
      const centerDisparity = disparity[index]
      let maxScore = 0

      for (let offset = 1; offset <= radius; offset++) {
        const horizontalDistance = offset * inverseWidth
        const verticalDistance = offset * inverseHeight

        if (x - offset >= 0) {
          const candidate = centerDisparity - disparity[index - offset] - rho * horizontalDistance
          maxScore = Math.max(maxScore, candidate)
        }
        if (x + offset < width) {
          const candidate = centerDisparity - disparity[index + offset] - rho * horizontalDistance
          maxScore = Math.max(maxScore, candidate)
        }
        if (y - offset >= 0) {
          const candidate = centerDisparity - disparity[index - offset * width] - rho * verticalDistance
          maxScore = Math.max(maxScore, candidate)
        }
        if (y + offset < height) {
          const candidate = centerDisparity - disparity[index + offset * width] - rho * verticalDistance
          maxScore = Math.max(maxScore, candidate)
        }
      }

      score[index] = maxScore
      softDisocclusion[index] = Math.max(0, Math.tanh(gamma * maxScore))
    }
  }

  return { score, softDisocclusion }
}

export async function createSoftLayeringDiagnostics(
  sourceDisparity: ImageData,
  args: SoftLayeringArgs,
): Promise<SoftLayeringDiagnostics> {
  const scale = Math.min(1, args.analysisResolution / Math.max(sourceDisparity.width, sourceDisparity.height))
  const width = Math.max(1, Math.round(sourceDisparity.width * scale))
  const height = Math.max(1, Math.round(sourceDisparity.height * scale))
  const analysisDisparity = await scaleImageData(sourceDisparity, width, height)
  const disparity = valuesFromImageData(analysisDisparity)
  const gradientMagnitude = calculateSobelMagnitude(disparity, width, height)
  const topVisibility = calculateTopVisibility(gradientMagnitude, args.visibilityBeta)
  const { score, softDisocclusion } = calculateSoftDisocclusion(
    disparity,
    width,
    height,
    args.disocclusionRadius,
    args.disocclusionRho,
    args.disocclusionGamma,
  )

  // score is non-negative and disparity is normalized, so it can be displayed directly.
  return {
    sourceDisparity: analysisDisparity,
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
      disocclusionRatio: ratioMatching(softDisocclusion, value => value > 0.5),
    },
  }
}
