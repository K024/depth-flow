import { cloneImageData } from "../image/utils"


export interface BottomDepthRepairArgs {
  bottomDepthEpsilon: number
}

export interface BottomDepthRepairStats {
  maskedPixels: number
  validFarSeeds: number
  fallbackBoundarySeeds: number
  unresolvedPixels: number
  maskedMinDisparity: number
  maskedMaxDisparity: number
  maskedMeanDisparity: number
}

export function repairBottomDepth(
  sourceDisparity: ImageData,
  topDisparity: ImageData,
  repairMask: ImageData,
  args: BottomDepthRepairArgs,
) {
  if (
    sourceDisparity.width !== repairMask.width
    || sourceDisparity.height !== repairMask.height
    || topDisparity.width !== repairMask.width
    || topDisparity.height !== repairMask.height
  ) {
    throw new Error("Depth map and repair mask must have the same size")
  }

  const { width, height } = sourceDisparity
  const pixelCount = width * height
  const result = new Uint8Array(pixelCount)
  const visited = new Uint8Array(pixelCount)
  const queue = new Int32Array(pixelCount)
  let queueStart = 0
  let queueEnd = 0

  const isMasked = (index: number) => repairMask.data[index * 4] >= 128
  const sourceValue = (index: number) => sourceDisparity.data[index * 4]
  const topValue = (index: number) => topDisparity.data[index * 4]
  const farSeedDelta = 0.02 * 255
  let maskedPixels = 0
  let validFarSeeds = 0
  let fallbackBoundarySeeds = 0

  for (let index = 0; index < pixelCount; index++) {
    if (!isMasked(index)) {
      result[index] = sourceValue(index)
      continue
    }
    maskedPixels++

    const x = index % width
    const y = Math.floor(index / width)
    let farBoundary = 255
    let hasBoundary = false
    const neighbors = [
      x > 0 ? index - 1 : -1,
      x + 1 < width ? index + 1 : -1,
      y > 0 ? index - width : -1,
      y + 1 < height ? index + width : -1,
    ]

    for (const neighbor of neighbors) {
      if (
        neighbor >= 0
        && !isMasked(neighbor)
        // The repair mask is dilated into the background, so sourceValue(index)
        // may already equal the adjacent background and cannot identify the
        // far side. Compare against the actual rendered Top surface instead.
        && sourceValue(neighbor) <= topValue(index) - farSeedDelta
      ) {
        farBoundary = Math.min(farBoundary, sourceValue(neighbor))
        hasBoundary = true
      }
    }

    if (hasBoundary) {
      result[index] = farBoundary
      visited[index] = 1
      queue[queueEnd++] = index
      validFarSeeds++
    }
  }

  // Multi-source propagation: nearest valid far-side boundary fills hidden regions.
  while (queueStart < queueEnd) {
    const index = queue[queueStart++]
    const x = index % width
    const y = Math.floor(index / width)
    const neighbors = [
      x > 0 ? index - 1 : -1,
      x + 1 < width ? index + 1 : -1,
      y > 0 ? index - width : -1,
      y + 1 < height ? index + width : -1,
    ]

    for (const neighbor of neighbors) {
      if (neighbor < 0 || !isMasked(neighbor) || visited[neighbor])
        continue
      result[neighbor] = result[index]
      visited[neighbor] = 1
      queue[queueEnd++] = neighbor
    }
  }

  // If a connected repair component had no depth-discontinuous far-side seed,
  // derive fallback seeds from the lower-disparity side of that component's
  // own boundary. A global minimum is unrelated to the local background and
  // commonly collapses the whole repaired component to disparity zero.
  const componentSeen = new Uint8Array(pixelCount)
  const componentQueue = new Int32Array(pixelCount)
  for (let start = 0; start < pixelCount; start++) {
    if (!isMasked(start) || visited[start] || componentSeen[start])
      continue

    let componentStart = 0
    let componentEnd = 0
    componentQueue[componentEnd++] = start
    componentSeen[start] = 1
    const boundaryPairs: Array<[number, number]> = []
    const boundaryValues: number[] = []

    while (componentStart < componentEnd) {
      const index = componentQueue[componentStart++]
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
        if (!isMasked(neighbor)) {
          const value = sourceValue(neighbor)
          boundaryPairs.push([index, value])
          boundaryValues.push(value)
        } else if (!visited[neighbor] && !componentSeen[neighbor]) {
          componentSeen[neighbor] = 1
          componentQueue[componentEnd++] = neighbor
        }
      }
    }

    if (boundaryValues.length === 0)
      continue

    // The two sides of a silhouette band generally contain near foreground
    // and far background samples. Use a robust low quartile rather than the
    // minimum so isolated zero-valued depth outliers cannot dominate.
    boundaryValues.sort((a, b) => a - b)
    const farCutoff = boundaryValues[
      Math.floor((boundaryValues.length - 1) * 0.25)
    ]

    queueStart = 0
    queueEnd = 0
    for (const [index, value] of boundaryPairs) {
      if (value > farCutoff)
        continue
      if (!visited[index]) {
        result[index] = value
        visited[index] = 1
        queue[queueEnd++] = index
        fallbackBoundarySeeds++
      } else {
        result[index] = Math.min(result[index], value)
      }
    }

    while (queueStart < queueEnd) {
      const index = queue[queueStart++]
      const x = index % width
      const y = Math.floor(index / width)
      const neighbors = [
        x > 0 ? index - 1 : -1,
        x + 1 < width ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y + 1 < height ? index + width : -1,
      ]

      for (const neighbor of neighbors) {
        if (neighbor < 0 || !isMasked(neighbor) || visited[neighbor])
          continue
        result[neighbor] = result[index]
        visited[neighbor] = 1
        queue[queueEnd++] = neighbor
      }
    }
  }

  const epsilon = Math.max(0, args.bottomDepthEpsilon) * 255
  const output = cloneImageData(topDisparity)
  let unresolvedPixels = 0
  let maskedMin = 255
  let maskedMax = 0
  let maskedSum = 0
  for (let index = 0; index < pixelCount; index++) {
    const top = topValue(index)
    if (isMasked(index) && !visited[index])
      unresolvedPixels++
    // A truly full-frame mask has no boundary evidence. Keep it immediately
    // behind Top rather than collapsing it to an unrelated global far plane.
    const propagated = visited[index] ? result[index] : top
    const bottom = isMasked(index)
      ? Math.max(0, Math.min(propagated, top - epsilon))
      : top
    const outputIndex = index * 4
    output.data[outputIndex] = bottom
    output.data[outputIndex + 1] = bottom
    output.data[outputIndex + 2] = bottom
    output.data[outputIndex + 3] = 255
    if (isMasked(index)) {
      maskedMin = Math.min(maskedMin, bottom)
      maskedMax = Math.max(maskedMax, bottom)
      maskedSum += bottom
    }
  }

  return {
    image: output,
    stats: {
      maskedPixels,
      validFarSeeds,
      fallbackBoundarySeeds,
      unresolvedPixels,
      maskedMinDisparity: maskedPixels > 0 ? maskedMin / 255 : 0,
      maskedMaxDisparity: maskedPixels > 0 ? maskedMax / 255 : 0,
      maskedMeanDisparity: maskedPixels > 0 ? maskedSum / maskedPixels / 255 : 0,
    } satisfies BottomDepthRepairStats,
  }
}
