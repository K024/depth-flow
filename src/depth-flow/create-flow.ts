import { error, type ProgressReporter } from "./utils"
import { getCachedFile } from "./file-cache"
import { depthModelUrl, getDepthModelSession, inferDepthModelSession, resizeImageForDepthModel } from "./models/depth"
import { getImageData, loadImageFromBlob, saveImageData, scaleImageData } from "./image/utils"
import { tensorFromImageData, tensorToGrayscaleImageData } from "./models/tensor"
import type { FlowSimple } from "./types"
import { saveFlowZip } from "./flow-file"


export async function makeSimpleFlow(image: Blob, progress?: ProgressReporter) {

  progress?.("Loading depth model")

  const depthModelBlob = await getCachedFile(depthModelUrl) || error("Depth model not found")
  const depthModelSession = await getDepthModelSession(depthModelBlob)

  progress?.("Loading image")

  const imageElement = await loadImageFromBlob(image)
  const imageData = getImageData(imageElement)
  const scaledImageData = await resizeImageForDepthModel(imageData)
  const imageTensor = tensorFromImageData(scaledImageData, true)

  progress?.("Running depth model")

  const depthTensor = await inferDepthModelSession(depthModelSession, imageTensor)

  progress?.("Post-processing depth map")

  const depthMap = tensorToGrayscaleImageData(depthTensor)
  const scaledBackDepthMap = await scaleImageData(depthMap, imageData.width, imageData.height)
  const depthMapBlob = await saveImageData(scaledBackDepthMap, "image/png")

  progress?.("Making flow file")

  const flow: FlowSimple = {
    originalImage: image,
    originalDepthMap: depthMapBlob,
    width: imageData.width,
    height: imageData.height,
  }
  const flowBlob = await saveFlowZip(flow)

  return flowBlob
}


export async function makeMultilayerFlow(image: Blob, progress?: ProgressReporter) {
  error("Not implemented")
}
