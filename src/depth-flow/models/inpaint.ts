import { ort } from "./ort"
import { getCanvas, scaleImageData } from "../image/utils"


export async function getInpaintModelSession(blob: Blob) {
  const session = await ort.InferenceSession.create(
    await blob.arrayBuffer(),
    {
      executionProviders: [
        // "webgpu", // TODO: blocked by https://github.com/microsoft/onnxruntime/issues/24744
        "wasm",
      ]
    }
  )
  return session
}


export async function inferInpaintSession(session: ort.InferenceSession, imageTensor: ort.TypedTensor<"float32">, maskTensor: ort.TypedTensor<"float32">) {
  const feeds = {
    image: imageTensor,
    mask: maskTensor,
  }

  const results = await session.run(feeds)

  const outputTensor = results.output as ort.TypedTensor<"float32">

  return outputTensor
}


const staticInputSize = 512

export interface PreparedInpaintInput {
  image: ImageData
  mask: ImageData
  contentX: number
  contentY: number
  contentWidth: number
  contentHeight: number
  cropX: number
  cropY: number
  cropWidth: number
  cropHeight: number
  estimatedModelMaskWidth: number
  restoreMask: ImageData
}

interface MaskComponent {
  indices: number[]
  minX: number
  minY: number
  maxX: number
  maxY: number
  area: number
  perimeter: number
}

interface MaskCluster {
  components: MaskComponent[]
  minX: number
  minY: number
  maxX: number
  maxY: number
  area: number
  perimeter: number
}

function findMaskComponents(mask: ImageData) {
  const pixelCount = mask.width * mask.height
  const seen = new Uint8Array(pixelCount)
  const queue = new Int32Array(pixelCount)
  const components: MaskComponent[] = []

  const active = (index: number) => mask.data[index * 4] >= 128

  for (let start = 0; start < pixelCount; start++) {
    if (seen[start] || !active(start))
      continue

    let queueStart = 0
    let queueEnd = 0
    queue[queueEnd++] = start
    seen[start] = 1
    const indices: number[] = []
    let minX = mask.width
    let minY = mask.height
    let maxX = -1
    let maxY = -1
    let perimeter = 0

    while (queueStart < queueEnd) {
      const index = queue[queueStart++]
      indices.push(index)
      const x = index % mask.width
      const y = Math.floor(index / mask.width)
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
      const neighbors = [
        x > 0 ? index - 1 : -1,
        x + 1 < mask.width ? index + 1 : -1,
        y > 0 ? index - mask.width : -1,
        y + 1 < mask.height ? index + mask.width : -1,
      ]
      for (const neighbor of neighbors) {
        if (neighbor < 0 || !active(neighbor)) {
          perimeter++
        } else if (!seen[neighbor]) {
          seen[neighbor] = 1
          queue[queueEnd++] = neighbor
        }
      }
    }

    components.push({
      indices,
      minX,
      minY,
      maxX,
      maxY,
      area: indices.length,
      perimeter,
    })
  }
  return components
}

function clusterMaskComponents(components: MaskComponent[], maxClusters = 4) {
  const clusters: MaskCluster[] = components.map(component => ({
    components: [component],
    minX: component.minX,
    minY: component.minY,
    maxX: component.maxX,
    maxY: component.maxY,
    area: component.area,
    perimeter: component.perimeter,
  }))

  while (clusters.length > maxClusters) {
    let bestA = 0
    let bestB = 1
    let bestCost = Infinity
    for (let a = 0; a < clusters.length; a++) {
      for (let b = a + 1; b < clusters.length; b++) {
        const first = clusters[a]
        const second = clusters[b]
        const minX = Math.min(first.minX, second.minX)
        const minY = Math.min(first.minY, second.minY)
        const maxX = Math.max(first.maxX, second.maxX)
        const maxY = Math.max(first.maxY, second.maxY)
        const unionArea = (maxX - minX + 1) * (maxY - minY + 1)
        const firstArea = (first.maxX - first.minX + 1) * (first.maxY - first.minY + 1)
        const secondArea = (second.maxX - second.minX + 1) * (second.maxY - second.minY + 1)
        // Merge the pair that adds the least empty bbox area. This keeps each
        // fixed 512x512 LaMa crop focused on actual repair pixels instead of
        // wasting model resolution on gaps between distant components.
        const cost = unionArea - firstArea - secondArea
        if (cost < bestCost) {
          bestCost = cost
          bestA = a
          bestB = b
        }
      }
    }

    const first = clusters[bestA]
    const second = clusters[bestB]
    clusters[bestA] = {
      components: [...first.components, ...second.components],
      minX: Math.min(first.minX, second.minX),
      minY: Math.min(first.minY, second.minY),
      maxX: Math.max(first.maxX, second.maxX),
      maxY: Math.max(first.maxY, second.maxY),
      area: first.area + second.area,
      perimeter: first.perimeter + second.perimeter,
    }
    clusters.splice(bestB, 1)
  }

  return clusters
}

function estimateModelMaskWidth(mask: ImageData, cluster: MaskCluster) {
  const bounds = getClusterBounds(mask, cluster)
  const cropWidth = bounds.right - bounds.x
  const cropHeight = bounds.bottom - bounds.y
  const scale = Math.min(staticInputSize / cropWidth, staticInputSize / cropHeight)
  return bounds.estimatedBandWidth * scale
}

function getClusterBounds(mask: ImageData, cluster: MaskCluster) {
  // For a long band, 2*area/perimeter approximates its width. Three widths of
  // context (at least 64 source pixels) gives LaMa surrounding texture without
  // reverting to a detail-destroying full-image letterbox.
  const estimatedBandWidth = cluster.perimeter > 0
    ? 2 * cluster.area / cluster.perimeter
    : 0
  const margin = Math.max(64, Math.ceil(3 * estimatedBandWidth))
  return {
    x: Math.max(0, cluster.minX - margin),
    y: Math.max(0, cluster.minY - margin),
    right: Math.min(mask.width, cluster.maxX + 1 + margin),
    bottom: Math.min(mask.height, cluster.maxY + 1 + margin),
    estimatedBandWidth,
  }
}

function createClusterMask(
  cluster: MaskCluster,
  cropX: number,
  cropY: number,
  cropWidth: number,
  cropHeight: number,
  sourceWidth: number,
) {
  const output = new ImageData(cropWidth, cropHeight)
  for (const component of cluster.components) {
    for (const index of component.indices) {
      const x = index % sourceWidth
      const y = Math.floor(index / sourceWidth)
      const outputIndex = ((y - cropY) * cropWidth + x - cropX) * 4
      output.data[outputIndex] = 255
      output.data[outputIndex + 1] = 255
      output.data[outputIndex + 2] = 255
      output.data[outputIndex + 3] = 255
    }
  }
  return output
}

function cropImageData(image: ImageData, x: number, y: number, width: number, height: number) {
  const output = new ImageData(width, height)
  for (let outputY = 0; outputY < height; outputY++) {
    const sourceStart = ((y + outputY) * image.width + x) * 4
    const sourceEnd = sourceStart + width * 4
    output.data.set(image.data.subarray(sourceStart, sourceEnd), outputY * width * 4)
  }
  return output
}

function padImageWithEdgePixels(
  image: ImageData,
  targetWidth: number,
  targetHeight: number,
  offsetX: number,
  offsetY: number,
) {
  const output = new ImageData(targetWidth, targetHeight)

  for (let y = 0; y < targetHeight; y++) {
    const sourceY = Math.max(0, Math.min(image.height - 1, y - offsetY))
    for (let x = 0; x < targetWidth; x++) {
      const sourceX = Math.max(0, Math.min(image.width - 1, x - offsetX))
      const sourceIndex = (sourceY * image.width + sourceX) * 4
      const outputIndex = (y * targetWidth + x) * 4
      output.data[outputIndex] = image.data[sourceIndex]
      output.data[outputIndex + 1] = image.data[sourceIndex + 1]
      output.data[outputIndex + 2] = image.data[sourceIndex + 2]
      output.data[outputIndex + 3] = 255
    }
  }

  return output
}

export async function prepareImageAndMasksForInpaint(
  image: ImageData,
  mask: ImageData,
  initialCrops = 4,
) {
  if (image.width !== mask.width || image.height !== mask.height)
    throw new Error("Inpaint image and mask must have the same size")

  const components = findMaskComponents(mask)
  const maximumCrops = Math.min(8, components.length)
  let cropCount = Math.min(Math.max(1, initialCrops), maximumCrops)
  let clusters = clusterMaskComponents(components, cropCount)
  // Preserve the four-crop fast path when it retains enough mask bandwidth,
  // but split up to eight ways when downscaling would make a cluster too thin
  // for the fixed-size LaMa input. Twelve model pixels is the quality target;
  // the eight-crop cap bounds WASM inference cost, so a difficult image may
  // stop slightly below the target rather than doubling latency again.
  while (
    cropCount < maximumCrops
    && clusters.some(cluster => estimateModelMaskWidth(mask, cluster) < 12)
  ) {
    cropCount++
    clusters = clusterMaskComponents(components, cropCount)
  }
  const prepared: PreparedInpaintInput[] = []

  for (const cluster of clusters) {
    const bounds = getClusterBounds(mask, cluster)
    const cropWidth = bounds.right - bounds.x
    const cropHeight = bounds.bottom - bounds.y
    const clusterMask = createClusterMask(
      cluster,
      bounds.x,
      bounds.y,
      cropWidth,
      cropHeight,
      mask.width,
    )
    const croppedImage = cropImageData(image, bounds.x, bounds.y, cropWidth, cropHeight)
    const scale = Math.min(staticInputSize / cropWidth, staticInputSize / cropHeight)
    const contentWidth = Math.max(1, Math.round(cropWidth * scale))
    const contentHeight = Math.max(1, Math.round(cropHeight * scale))
    const contentX = Math.floor((staticInputSize - contentWidth) / 2)
    const contentY = Math.floor((staticInputSize - contentHeight) / 2)
    const scaledImage = await scaleImageData(croppedImage, contentWidth, contentHeight)
    const scaledMask = await scaleImageData(clusterMask, contentWidth, contentHeight)
    // A lower post-resize threshold keeps thin antialiased mask bands from
    // disappearing before inference. Restoration still uses the original hard
    // cluster mask, preserving zero RGB changes outside the repair region.
    binarizeMask(scaledMask, 64)
    const paddedImage = padImageWithEdgePixels(
      scaledImage,
      staticInputSize,
      staticInputSize,
      contentX,
      contentY,
    )
    const maskCanvas = getCanvas(staticInputSize, staticInputSize)
    maskCanvas.ctx.drawImage(await createImageBitmap(scaledMask), contentX, contentY)
    prepared.push({
      image: paddedImage,
      mask: maskCanvas.ctx.getImageData(0, 0, staticInputSize, staticInputSize),
      contentX,
      contentY,
      contentWidth,
      contentHeight,
      cropX: bounds.x,
      cropY: bounds.y,
      cropWidth,
      cropHeight,
      estimatedModelMaskWidth: bounds.estimatedBandWidth * scale,
      restoreMask: clusterMask,
    })
  }

  return prepared
}

export async function restoreInpaintOutputInto(
  target: ImageData,
  output: ImageData,
  prepared: PreparedInpaintInput,
) {
  const { ctx } = getCanvas(prepared.contentWidth, prepared.contentHeight)
  const outputBitmap = await createImageBitmap(output)
  ctx.drawImage(
    outputBitmap,
    prepared.contentX,
    prepared.contentY,
    prepared.contentWidth,
    prepared.contentHeight,
    0,
    0,
    prepared.contentWidth,
    prepared.contentHeight,
  )
  const restoredCrop = await scaleImageData(
    ctx.getImageData(0, 0, prepared.contentWidth, prepared.contentHeight),
    prepared.cropWidth,
    prepared.cropHeight,
  )
  for (let y = 0; y < prepared.cropHeight; y++) {
    for (let x = 0; x < prepared.cropWidth; x++) {
      const sourceIndex = (y * prepared.cropWidth + x) * 4
      if (prepared.restoreMask.data[sourceIndex] < 128)
        continue
      const targetIndex = (
        (prepared.cropY + y) * target.width
        + prepared.cropX + x
      ) * 4
      target.data[targetIndex] = restoredCrop.data[sourceIndex]
      target.data[targetIndex + 1] = restoredCrop.data[sourceIndex + 1]
      target.data[targetIndex + 2] = restoredCrop.data[sourceIndex + 2]
      target.data[targetIndex + 3] = 255
    }
  }
  return target
}

function binarizeMask(mask: ImageData, threshold = 128) {
  const { data } = mask
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i] >= threshold ? 255 : 0         // R
    data[i + 1] = data[i + 1] >= threshold ? 255 : 0 // G 
    data[i + 2] = data[i + 2] >= threshold ? 255 : 0 // B
    // Alpha channel left unchanged
  }
  return mask
}
