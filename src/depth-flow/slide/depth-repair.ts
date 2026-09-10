import { cloneImageData } from "../image/utils"


export interface BottomDepthRepairArgs {
  bottomDepthEpsilon: number
}

export interface BottomDepthRepairStats {
  maskedPixels: number
  maskedMinDisparity: number
  maskedMaxDisparity: number
  maskedMeanDisparity: number
  highGradientRatio: number
  gradientP99Lsb: number
  aboveBoundaryMedianRatio: number
  epsilonGapRatio: number
}

function percentile(values: number[], p: number) {
  if (values.length === 0)
    return 0
  values.sort((a, b) => a - b)
  return values[Math.min(values.length - 1, Math.floor(p * values.length))]
}

export function repairBottomDepth(
  sourceDisparity: ImageData,
  topDisparity: ImageData,
  farReference: ImageData,
  blendMask: ImageData,
  args: BottomDepthRepairArgs,
) {
  if (
    sourceDisparity.width !== blendMask.width
    || sourceDisparity.height !== blendMask.height
    || topDisparity.width !== blendMask.width
    || topDisparity.height !== blendMask.height
    || farReference.width !== blendMask.width
    || farReference.height !== blendMask.height
  ) {
    throw new Error("Bottom depth repair inputs must have the same size")
  }

  const { width, height } = sourceDisparity
  const pixelCount = width * height
  const source = new Float32Array(pixelCount)
  const top = new Float32Array(pixelCount)
  const far = new Float32Array(pixelCount)
  const blend = new Float32Array(pixelCount)
  const active = new Uint8Array(pixelCount)

  for (let index = 0; index < pixelCount; index++) {
    const offset = index * 4
    source[index] = sourceDisparity.data[offset] / 255
    top[index] = topDisparity.data[offset] / 255
    far[index] = farReference.data[offset] / 255
    blend[index] = blendMask.data[offset] / 255
    active[index] = blendMask.data[offset] > 0 ? 1 : 0
  }

  // The max-plus argmin gives the background sample that dominates each
  // disocclusion. Smooth only argmin-switch seams, not the entire geometry.
  let current = new Float32Array(far)
  let next = new Float32Array(pixelCount)
  const dirichletSlack = 0.02
  for (let iteration = 0; iteration < 8; iteration++) {
    next.set(current)
    for (let index = 0; index < pixelCount; index++) {
      if (!active[index])
        continue

      const x = index % width
      const y = Math.floor(index / width)
      const neighbors = [
        x > 0 ? index - 1 : -1,
        x + 1 < width ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y + 1 < height ? index + width : -1,
      ]
      let sum = 0
      let count = 0

      for (const neighbor of neighbors) {
        if (neighbor < 0)
          continue
        if (active[neighbor]) {
          sum += current[neighbor]
          count++
        } else if (source[neighbor] <= far[index] + dirichletSlack) {
          // Only the locally far side is a fixed boundary. The foreground side
          // is Neumann/free and therefore cannot pull the repair toward Top.
          sum += source[neighbor]
          count++
        }
      }

      if (count > 0)
        next[index] = sum / count
    }
    const swap = current
    current = next
    next = swap
  }

  const epsilon = Math.max(0, args.bottomDepthEpsilon)
  const output = cloneImageData(topDisparity)
  let maskedPixels = 0
  let maskedMin = 1
  let maskedMax = 0
  let maskedSum = 0
  let epsilonGapPixels = 0

  for (let index = 0; index < pixelCount; index++) {
    if (!active[index])
      continue

    const repaired = Math.max(0, Math.min(current[index], top[index] - epsilon))
    // Use the same inward feather as RGB so geometry and texture transition
    // over exactly the same support. Outside it Bottom remains identical to Top.
    const bottom = top[index] + (repaired - top[index]) * blend[index]
    const byteValue = Math.round(bottom * 255)
    const offset = index * 4
    output.data[offset] = byteValue
    output.data[offset + 1] = byteValue
    output.data[offset + 2] = byteValue
    output.data[offset + 3] = 255

    if (blendMask.data[offset] >= 128) {
      maskedPixels++
      maskedMin = Math.min(maskedMin, bottom)
      maskedMax = Math.max(maskedMax, bottom)
      maskedSum += bottom
      if (Math.abs((top[index] - bottom) - epsilon) <= 0.5 / 255)
        epsilonGapPixels++
    }
  }

  const gradients: number[] = []
  let highGradients = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x
      if (blendMask.data[index * 4] < 128)
        continue
      let gradient = 0
      if (x + 1 < width)
        gradient = Math.max(gradient, Math.abs(output.data[index * 4] - output.data[(index + 1) * 4]))
      if (y + 1 < height)
        gradient = Math.max(gradient, Math.abs(output.data[index * 4] - output.data[(index + width) * 4]))
      gradients.push(gradient)
      if (gradient > 4)
        highGradients++
    }
  }

  // Diagnostic only: compare every repaired component against the median of
  // its original, unmasked boundary.
  const seen = new Uint8Array(pixelCount)
  const queue = new Int32Array(pixelCount)
  let aboveBoundaryMedian = 0
  let boundaryComparedPixels = 0
  for (let start = 0; start < pixelCount; start++) {
    if (blendMask.data[start * 4] < 128 || seen[start])
      continue

    let queueStart = 0
    let queueEnd = 0
    queue[queueEnd++] = start
    seen[start] = 1
    const component: number[] = []
    const boundary: number[] = []

    while (queueStart < queueEnd) {
      const index = queue[queueStart++]
      component.push(index)
      const x = index % width
      const y = Math.floor(index / width)
      const neighbors = [
        x > 0 ? index - 1 : -1,
        x + 1 < width ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y + 1 < height ? index + width : -1,
      ]
      for (const neighbor of neighbors) {
        if (neighbor < 0)
          continue
        if (blendMask.data[neighbor * 4] >= 128) {
          if (!seen[neighbor]) {
            seen[neighbor] = 1
            queue[queueEnd++] = neighbor
          }
        } else {
          boundary.push(source[neighbor])
        }
      }
    }

    if (boundary.length === 0)
      continue
    const median = percentile(boundary, 0.5)
    for (const index of component) {
      boundaryComparedPixels++
      if (output.data[index * 4] / 255 > median)
        aboveBoundaryMedian++
    }
  }

  return {
    image: output,
    stats: {
      maskedPixels,
      maskedMinDisparity: maskedPixels > 0 ? maskedMin : 0,
      maskedMaxDisparity: maskedPixels > 0 ? maskedMax : 0,
      maskedMeanDisparity: maskedPixels > 0 ? maskedSum / maskedPixels : 0,
      highGradientRatio: gradients.length > 0 ? highGradients / gradients.length : 0,
      gradientP99Lsb: percentile(gradients, 0.99),
      aboveBoundaryMedianRatio: boundaryComparedPixels > 0
        ? aboveBoundaryMedian / boundaryComparedPixels
        : 0,
      epsilonGapRatio: maskedPixels > 0 ? epsilonGapPixels / maskedPixels : 0,
    } satisfies BottomDepthRepairStats,
  }
}
