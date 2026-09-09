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

  const scale = Math.min(staticInputSize / image.width, staticInputSize / image.height)
  const contentWidth = Math.max(1, Math.round(image.width * scale))
  const contentHeight = Math.max(1, Math.round(image.height * scale))
  const contentX = Math.floor((staticInputSize - contentWidth) / 2)
  const contentY = Math.floor((staticInputSize - contentHeight) / 2)
  const scaledImage = await scaleImageData(image, contentWidth, contentHeight)
  const scaledMask = await scaleImageData(mask, contentWidth, contentHeight)
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
  return scaleImageData(
    ctx.getImageData(0, 0, prepared.contentWidth, prepared.contentHeight),
    width,
    height,
  )
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
