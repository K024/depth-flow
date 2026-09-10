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
}

function getMaskBounds(mask: ImageData) {
  let minX = mask.width
  let minY = mask.height
  let maxX = -1
  let maxY = -1
  let area = 0
  let perimeter = 0

  const active = (x: number, y: number) => (
    x >= 0 && x < mask.width
    && y >= 0 && y < mask.height
    && mask.data[(y * mask.width + x) * 4] >= 128
  )

  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (!active(x, y))
        continue
      area++
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
      if (!active(x - 1, y)) perimeter++
      if (!active(x + 1, y)) perimeter++
      if (!active(x, y - 1)) perimeter++
      if (!active(x, y + 1)) perimeter++
    }
  }

  if (maxX < minX || maxY < minY)
    return undefined

  const estimatedBandWidth = perimeter > 0 ? 2 * area / perimeter : 0
  const margin = Math.max(64, Math.ceil(3 * estimatedBandWidth))
  return {
    x: Math.max(0, minX - margin),
    y: Math.max(0, minY - margin),
    right: Math.min(mask.width, maxX + 1 + margin),
    bottom: Math.min(mask.height, maxY + 1 + margin),
  }
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

export async function prepareImageAndMaskForInpaint(
  image: ImageData,
  mask: ImageData,
): Promise<PreparedInpaintInput> {
  if (image.width !== mask.width || image.height !== mask.height)
    throw new Error("Inpaint image and mask must have the same size")

  const bounds = getMaskBounds(mask)
  if (!bounds)
    throw new Error("Cannot prepare an empty inpaint mask")
  const cropX = bounds.x
  const cropY = bounds.y
  const cropWidth = bounds.right - bounds.x
  const cropHeight = bounds.bottom - bounds.y
  const croppedImage = cropImageData(image, cropX, cropY, cropWidth, cropHeight)
  const croppedMask = cropImageData(mask, cropX, cropY, cropWidth, cropHeight)

  const scale = Math.min(staticInputSize / cropWidth, staticInputSize / cropHeight)
  const contentWidth = Math.max(1, Math.round(cropWidth * scale))
  const contentHeight = Math.max(1, Math.round(cropHeight * scale))
  const contentX = Math.floor((staticInputSize - contentWidth) / 2)
  const contentY = Math.floor((staticInputSize - contentHeight) / 2)
  const scaledImage = await scaleImageData(croppedImage, contentWidth, contentHeight)
  const scaledMask = await scaleImageData(croppedMask, contentWidth, contentHeight)
  binarizeMask(scaledMask)

  const paddedImage = padImageWithEdgePixels(
    scaledImage,
    staticInputSize,
    staticInputSize,
    contentX,
    contentY,
  )
  const maskCanvas = getCanvas(staticInputSize, staticInputSize)
  maskCanvas.ctx.drawImage(await createImageBitmap(scaledMask), contentX, contentY)

  return {
    image: paddedImage,
    mask: maskCanvas.ctx.getImageData(0, 0, staticInputSize, staticInputSize),
    contentX,
    contentY,
    contentWidth,
    contentHeight,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
  }
}

export async function restoreInpaintOutput(
  output: ImageData,
  prepared: PreparedInpaintInput,
  width: number,
  height: number,
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
  const fullOutput = new ImageData(width, height)
  for (let y = 0; y < prepared.cropHeight; y++) {
    const sourceStart = y * prepared.cropWidth * 4
    const sourceEnd = sourceStart + prepared.cropWidth * 4
    const targetStart = ((prepared.cropY + y) * width + prepared.cropX) * 4
    fullOutput.data.set(restoredCrop.data.subarray(sourceStart, sourceEnd), targetStart)
  }
  return fullOutput
}

export async function scaleImageAndMaskDataForInpaint(image: ImageData, mask: ImageData) {
  const scaledImageData = await scaleImageData(image, staticInputSize, staticInputSize)
  // const scaledMask = await scaleImageData(mask, staticInputSize, staticInputSize, "pixelated")
  const scaledMask = await scaleImageData(mask, staticInputSize, staticInputSize)
  binarizeMask(scaledMask)
  return {
    scaledImageData,
    scaledMask,
  }
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
