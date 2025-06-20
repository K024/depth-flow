import { error, frame, lazyPromise, type ProgressReporter } from "./utils"
import { getCachedFile } from "./file-cache"
import type { FlowSimple } from "./types"
import { depthModelUrl, getDepthModelSession, inferDepthModelSession, resizeImageForDepthModel } from "./models/depth"
import { getInpaintModelSession, inpaintModelUrl } from "./models/inpaint"
import { getImageData, loadImageFromBlob, saveImageData, scaleImageData } from "./image/utils"
import { tensorFromImageData, tensorToGrayscaleImageData } from "./models/tensor"
import { saveFlowZip } from "./flow-file"



const cachedDepthModelSession = lazyPromise(async () => {
  const depthModelBlob = await getCachedFile(depthModelUrl) || error("Depth model not found")
  const depthModelSession = await getDepthModelSession(depthModelBlob)
  return depthModelSession
})


const cachedInpaintModelSession = lazyPromise(async () => {
  const inpaintModelBlob = await getCachedFile(inpaintModelUrl) || error("Inpaint model not found")
  const inpaintModelSession = await getInpaintModelSession(inpaintModelBlob)
  return inpaintModelSession
})


export async function createSimpleFlow(image: Blob, progress?: ProgressReporter) {

  progress?.("Loading depth model")
  await frame()

  const depthModelSession = await cachedDepthModelSession()

  progress?.("Loading image")
  await frame()

  const imageElement = await loadImageFromBlob(image)
  const imageData = getImageData(imageElement)
  const scaledImageData = await resizeImageForDepthModel(imageData)
  const imageTensor = tensorFromImageData(scaledImageData, true)

  progress?.("Running depth model")
  await frame()

  const depthTensor = await inferDepthModelSession(depthModelSession, imageTensor)

  progress?.("Post-processing depth map")
  await frame()

  const depthMap = tensorToGrayscaleImageData(depthTensor)
  const scaledBackDepthMap = await scaleImageData(depthMap, imageData.width, imageData.height)
  const depthMapBlob = await saveImageData(scaledBackDepthMap, "image/png")

  progress?.("Making flow file")
  await frame()

  const flow: FlowSimple = {
    originalImage: image,
    originalDepthMap: depthMapBlob,
    width: imageData.width,
    height: imageData.height,
  }
  const flowBlob = await saveFlowZip(flow)

  return flowBlob
}


export async function createMultilayerFlow(image: Blob, progress?: ProgressReporter): Promise<File> {
  error("Not implemented")
}
