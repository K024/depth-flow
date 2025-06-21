import { ort } from "./ort"
import { scaleImageData } from "../image/utils"


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
