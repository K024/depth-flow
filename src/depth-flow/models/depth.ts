import { ort } from "./ort"
import { scaleImageData } from "../image/utils"


export async function getDepthModelSession(blob: Blob) {
  console.log("getDepthModelSession")
  const session = await ort.InferenceSession.create(
    await blob.arrayBuffer(),
    {
      executionProviders: [
        "webgpu",
        "wasm",
      ],
    }
  )
  return session
}


export async function inferDepthModelSession(session: ort.InferenceSession, imageTensor: ort.TypedTensor<"float32">) {
  const feeds = {
    // image: imageTensor,  // for models in https://github.com/fabio-sim/Depth-Anything-ONNX
    pixel_values: imageTensor,  // for models in https://huggingface.co/onnx-community/depth-anything-v2-base
  }

  const results = await session.run(feeds)

  // const depthTensor = results.depth as ort.TypedTensor<"float32">
  const depthTensor = results.predicted_depth as ort.TypedTensor<"float32">

  return depthTensor
}


function ensureMultipleOf(x: number, n: number) {
  return Math.round(x / n) * n
}


export async function resizeImageForDepthModel(imageData: ImageData) {

  // scale the shorter edge to 518 
  const desiredSize = 518
  const multipleOf = 14

  const width = imageData.width
  const height = imageData.height

  const aspectRatio = width / height
  let targetWidth, targetHeight

  if (width < height) {
    targetWidth = desiredSize
    targetHeight = ensureMultipleOf(desiredSize / aspectRatio, multipleOf)
  } else {
    targetHeight = desiredSize
    targetWidth = ensureMultipleOf(desiredSize * aspectRatio, multipleOf)
  }

  const scaledImageData = await scaleImageData(imageData, targetWidth, targetHeight)
  return scaledImageData
}
