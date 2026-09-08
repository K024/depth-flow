import { getCachedFile } from "./file-cache"
import { saveFlowZip } from "./flow-file"
import { consoleLogImageData } from "./image/console"
import { dilateImageData, getImageData, loadImageFromBlob, saveImageData, scaleImageData } from "./image/utils"
import { depthModelUrl } from "./models/cache"
import { getDepthModelSession, inferDepthModelSession, resizeImageForDepthModel } from "./models/depth"
import { tensorFromImageData, tensorToGrayscaleImageData } from "./models/tensor"
import type { FlowSimple } from "./types"
import { error, frame, lazyPromise, type ProgressReporter } from "./utils"



const cachedDepthModelSession = lazyPromise(async () => {
  const depthModelBlob = await getCachedFile(depthModelUrl) || error("Depth model not found")
  const depthModelSession = await getDepthModelSession(depthModelBlob)
  return depthModelSession
})


function clip(x: number, min: number, max: number, int = true) {
  if (int) x = Math.round(x)
  if (x < min) return min
  if (x > max) return max
  return x
}


export interface SimpleFlowArgs {
  depthMapDilateRadius?: number
}

async function simpleProcess(image: Blob, args: Required<SimpleFlowArgs>, progress?: ProgressReporter) {
  progress?.("Loading depth model")
  await frame()

  const depthModelSession = await cachedDepthModelSession()

  progress?.("Loading image")
  await frame()

  const imageElement = await loadImageFromBlob(image)
  const imageData = getImageData(imageElement)
  const scaledImageData = await resizeImageForDepthModel(imageData)

  progress?.("Running depth model")
  await frame()

  const imageTensor = tensorFromImageData(scaledImageData, true)
  const depthTensor = await inferDepthModelSession(depthModelSession, imageTensor)
  const depthMap = tensorToGrayscaleImageData(depthTensor, true)

  progress?.("Post-processing depth map")
  await frame()

  const scaledBackDepthMap = await scaleImageData(depthMap, imageData.width, imageData.height)
  const dilatedDepthMap = await dilateImageData(scaledBackDepthMap, args.depthMapDilateRadius)

  console.log(`dilatedDepthMap`)
  await consoleLogImageData(dilatedDepthMap)

  return {
    imageData,
    scaledBackDepthMap,
    dilatedDepthMap,
  }
}

export async function createSimpleFlow(image: Blob, args?: SimpleFlowArgs, progress?: ProgressReporter) {

  const normalizedArgs: Required<SimpleFlowArgs> = {
    depthMapDilateRadius: clip(args?.depthMapDilateRadius ?? 4, 0, 20),
  }

  const {
    imageData,
    dilatedDepthMap,
  } = await simpleProcess(image, normalizedArgs, progress)
  const depthMapBlob = await saveImageData(dilatedDepthMap, "image/png")

  progress?.("Making flow file")
  await frame()

  const flow: FlowSimple = {
    originalImage: image,
    originalDepthMap: depthMapBlob,
    width: imageData.width,
    height: imageData.height,

    processedBy: "depth-flow-web/simple/v0",
    processArgs: normalizedArgs,
  }
  const flowBlob = await saveFlowZip(flow)

  return flowBlob
}
