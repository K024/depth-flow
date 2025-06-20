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

export async function scaleImageAndDepthDataForInpaint(image: ImageData, depthData: ImageData) {
  const imageData = await scaleImageData(image, staticInputSize, staticInputSize)
  const scaledDepthData = await scaleImageData(depthData, staticInputSize, staticInputSize)
  return {
    imageData,
    scaledDepthData,
  }
}

