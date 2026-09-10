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


// Every length-like SLIDE parameter (pool radius, blur sigma, repair dilate
// radius) was tuned on the grid resizeImageForDepthModel produces, whose short
// edge is this constant. Exporting it turns what used to be an unwritten
// assumption into a stated reference, so the pipeline can rescale those
// parameters if the grid ever changes instead of silently changing meaning.
export const analysisReferenceShortEdge = 518
const analysisMultipleOf = 14


/**
 * How much wider the actual analysis grid is than the reference grid the
 * parameters were tuned on. 1 for the current pipeline.
 */
export function analysisGridScale(grid: { width: number, height: number }) {
  return Math.min(grid.width, grid.height) / analysisReferenceShortEdge
}


export async function resizeImageForDepthModel(imageData: ImageData) {

  // scale the shorter edge to 518 
  const desiredSize = analysisReferenceShortEdge
  const multipleOf = analysisMultipleOf

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
