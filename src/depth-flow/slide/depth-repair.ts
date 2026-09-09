import { cloneImageData } from "../image/utils"


export interface BottomDepthRepairArgs {
  bottomDepthEpsilon: number
}

export function repairBottomDepth(
  sourceDisparity: ImageData,
  repairMask: ImageData,
  args: BottomDepthRepairArgs,
) {
  if (
    sourceDisparity.width !== repairMask.width
    || sourceDisparity.height !== repairMask.height
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

  for (let index = 0; index < pixelCount; index++) {
    if (!isMasked(index)) {
      result[index] = sourceValue(index)
      continue
    }

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
      if (neighbor >= 0 && !isMasked(neighbor)) {
        farBoundary = Math.min(farBoundary, sourceValue(neighbor))
        hasBoundary = true
      }
    }

    if (hasBoundary) {
      result[index] = farBoundary
      visited[index] = 1
      queue[queueEnd++] = index
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

  // Full-mask fallback: use globally farthest disparity.
  let globalFar = 255
  for (let index = 0; index < pixelCount; index++)
    globalFar = Math.min(globalFar, sourceValue(index))

  const epsilon = Math.max(0, args.bottomDepthEpsilon) * 255
  const output = cloneImageData(sourceDisparity)
  for (let index = 0; index < pixelCount; index++) {
    const top = sourceValue(index)
    const propagated = visited[index] ? result[index] : (isMasked(index) ? globalFar : top)
    const bottom = isMasked(index)
      ? Math.max(0, Math.min(propagated, top - epsilon))
      : Math.min(propagated, top)
    const outputIndex = index * 4
    output.data[outputIndex] = bottom
    output.data[outputIndex + 1] = bottom
    output.data[outputIndex + 2] = bottom
    output.data[outputIndex + 3] = 255
  }

  return output
}
