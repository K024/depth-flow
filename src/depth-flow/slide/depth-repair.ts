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
  interiorGradientRatio: number
  interiorGradientP99Lsb: number
  aboveBoundaryMedianRatio: number
  epsilonGapRatio: number
  haloResidualLsb: number
}

function percentile(values: number[], p: number) {
  if (values.length === 0)
    return 0
  values.sort((a, b) => a - b)
  return values[Math.min(values.length - 1, Math.floor(p * values.length))]
}

function chamferDistance(
  active: Uint8Array,
  width: number,
  height: number,
  distanceToActive: boolean,
) {
  const distance = new Uint32Array(active.length)
  const infinity = 0x3fffffff
  for (let index = 0; index < active.length; index++) {
    const isTarget = distanceToActive ? active[index] !== 0 : active[index] === 0
    distance[index] = isTarget ? 0 : infinity
  }

  const relax = (index: number, neighbor: number, cost: number) => {
    distance[index] = Math.min(distance[index], distance[neighbor] + cost)
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x
      if (distance[index] === 0)
        continue
      if (x > 0)
        relax(index, index - 1, 3)
      if (y > 0) {
        relax(index, index - width, 3)
        if (x > 0)
          relax(index, index - width - 1, 4)
        if (x + 1 < width)
          relax(index, index - width + 1, 4)
      }
      if (
        !distanceToActive
        && (x === 0 || y === 0 || x + 1 === width || y + 1 === height)
      ) {
        distance[index] = Math.min(distance[index], 3)
      }
    }
  }

  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const index = y * width + x
      if (distance[index] === 0)
        continue
      if (x + 1 < width)
        relax(index, index + 1, 3)
      if (y + 1 < height) {
        relax(index, index + width, 3)
        if (x > 0)
          relax(index, index + width - 1, 4)
        if (x + 1 < width)
          relax(index, index + width + 1, 4)
      }
      if (
        !distanceToActive
        && (x === 0 || y === 0 || x + 1 === width || y + 1 === height)
      ) {
        distance[index] = Math.min(distance[index], 3)
      }
    }
  }

  return distance
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
  const active = new Uint8Array(pixelCount)

  for (let index = 0; index < pixelCount; index++) {
    const offset = index * 4
    source[index] = sourceDisparity.data[offset] / 255
    top[index] = topDisparity.data[offset] / 255
    far[index] = farReference.data[offset] / 255
    active[index] = blendMask.data[offset] > 0 ? 1 : 0
  }

  // The max-plus argmin gives the background sample that geometrically
  // dominates each disocclusion. Eight Jacobi iterations smooth only local
  // argmin-switch seams; solving to convergence would over-flatten genuine
  // background structure. Acceptance is measured both over the full mask and
  // over its d>=4 px interior, because the two-layer representation necessarily
  // contains a depth step at the mask boundary.
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
          // Only the locally far side is a fixed (Dirichlet) boundary. The
          // foreground side is Neumann/free and therefore cannot pull Bottom
          // toward Top. This local test is intentionally independent of
          // blurSigma; the removed seed rule depended on Gaussian leakage.
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
    // Use the hard active region for depth. Feathering this constraint would
    // lerp Bottom back toward Top, breaking occlusion ordering and increasing
    // epsilonGapRatio at the outer rim.
    //
    // Outside the repair region, pair original RGB with original depth while
    // retaining bottom<=top. min(top, source) removes Top's max-pool/blur halo
    // from Bottom without creating any ordering violations.
    const bottom = active[index]
      ? Math.max(0, Math.min(current[index], top[index] - epsilon))
      : Math.min(top[index], source[index])
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

  const diagnosticMask = new Uint8Array(pixelCount)
  for (let index = 0; index < pixelCount; index++)
    diagnosticMask[index] = blendMask.data[index * 4] >= 128 ? 1 : 0
  const interiorDistance = chamferDistance(diagnosticMask, width, height, false)
  const exteriorDistance = chamferDistance(active, width, height, true)

  const gradients: number[] = []
  const interiorGradients: number[] = []
  let highGradients = 0
  let highInteriorGradients = 0
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
      // 3-4 chamfer distances are stored in thirds of a pixel. Exclude the
      // unavoidable layer boundary and track the accepted interior targets:
      // high-gradient ratio <= 0.016 and p99 <= 6 LSB for d>=4 px.
      if (interiorDistance[index] >= 12) {
        interiorGradients.push(gradient)
        if (gradient > 4)
          highInteriorGradients++
      }
    }
  }

  let haloResidualSum = 0
  let haloResidualPixels = 0
  for (let index = 0; index < pixelCount; index++) {
    if (active[index] || exteriorDistance[index] > 6)
      continue
    // Historical diagnostic retained for output compatibility: top-bottom is
    // the amount of Top halo removed, not the residual halo. Do not compare it
    // with the residual acceptance target. The true residual is bottom-source
    // in this exterior 1–2 px ring and should satisfy |mean| <= 0.5 LSB.
    haloResidualSum += topDisparity.data[index * 4] - output.data[index * 4]
    haloResidualPixels++
  }

  // Diagnostic only: compare every repaired component against the median of
  // its original, unmasked boundary. This guards against filling the exposed
  // background with foreground-like (too-near/high-disparity) values; accepted
  // aboveBoundaryMedianRatio is <= 0.17.
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
      interiorGradientRatio: interiorGradients.length > 0
        ? highInteriorGradients / interiorGradients.length
        : 0,
      interiorGradientP99Lsb: percentile(interiorGradients, 0.99),
      aboveBoundaryMedianRatio: boundaryComparedPixels > 0
        ? aboveBoundaryMedian / boundaryComparedPixels
        : 0,
      epsilonGapRatio: maskedPixels > 0 ? epsilonGapPixels / maskedPixels : 0,
      haloResidualLsb: haloResidualPixels > 0
        ? haloResidualSum / haloResidualPixels
        : 0,
    } satisfies BottomDepthRepairStats,
  }
}
