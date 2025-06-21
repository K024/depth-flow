import { getCachedFile } from "./file-cache"
import { saveFlowZip } from "./flow-file"
import { consoleLogHistogram, consoleLogImageData } from "./image/console"
import { alphaBlend, dilateImageData, getImageData, loadImageFromBlob, saveImageData, scaleImageData, writeImageDataChannel } from "./image/utils"
import { depthModelUrl, inpaintModelUrl } from "./models/cache"
import { getDepthModelSession, inferDepthModelSession, resizeImageForDepthModel } from "./models/depth"
import { getInpaintModelSession, inferInpaintSession, scaleImageAndMaskDataForInpaint } from "./models/inpaint"
import { tensorFromImageData, tensorFromImageDataChannel, tensorToGrayscaleImageData, tensorToRgbImageData } from "./models/tensor"
import { clipDepthMapWithUpperBound, getBoundsForDivisions, getDepthMapMaskByLowerBound, postprocessAndMergeDepthMapAndMasks, postprocessClippedDepthMap } from "./multilayer/clip"
import { multilayerDepthMapDivisions } from "./multilayer/division"
import type { FlowMultilayer, FlowSimple } from "./types"
import { error, frame, lazyPromise, type ProgressReporter } from "./utils"



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


function clip(x: number, min: number, max: number, int = true) {
  if (int) x = Math.round(x)
  if (x < min) return min
  if (x > max) return max
  return x
}


export interface SimpleFlowArgs {
  depthMapDilateRadius?: number
}

async function simpleProcess(image: Blob, args?: SimpleFlowArgs, progress?: ProgressReporter) {
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
  const depthMapDilateRadius = clip(args?.depthMapDilateRadius ?? 4, 0, 20)
  const dilatedDepthMap = await dilateImageData(scaledBackDepthMap, depthMapDilateRadius)
  const depthMapBlob = await saveImageData(dilatedDepthMap, "image/png")

  return {
    imageData,
    scaledBackDepthMap,
    dilatedDepthMap,
    depthMapBlob,
    depthMapDilateRadius,
  }
}

export async function createSimpleFlow(image: Blob, args?: SimpleFlowArgs, progress?: ProgressReporter) {
  const {
    imageData,
    depthMapBlob,
    depthMapDilateRadius,
  } = await simpleProcess(image, args, progress)

  progress?.("Making flow file")
  await frame()

  const flow: FlowSimple = {
    originalImage: image,
    originalDepthMap: depthMapBlob,
    width: imageData.width,
    height: imageData.height,

    processedBy: "depth-flow-web/simple/v0",
    processArgs: {
      depthMapDilateRadius,
    },
  }
  const flowBlob = await saveFlowZip(flow)

  return flowBlob
}


export interface MultilayerFlowArgs {
  depthMapDilateRadius?: number
  layerDepthMapDilateRadius?: number
}

export async function createMultilayerFlow(image: Blob, args: MultilayerFlowArgs, progress?: ProgressReporter): Promise<File> {

  const {
    imageData,
    dilatedDepthMap,
    depthMapBlob,
    depthMapDilateRadius,
  } = await simpleProcess(image, args, progress)

  progress?.("Splitting image by depth")
  await frame()

  const { histogram, divisionPoints } = multilayerDepthMapDivisions(dilatedDepthMap)
  console.log("divisionPoints", divisionPoints)
  await consoleLogHistogram(histogram, divisionPoints)

  const layerBounds = getBoundsForDivisions(divisionPoints)
  console.log("layerBounds", layerBounds)

  progress?.("Loading inpaint model")
  await frame()

  const inpaintModelSession = await cachedInpaintModelSession()

  await frame()

  const layerDepthMapDilateRadius = clip(args.layerDepthMapDilateRadius ?? 4, 0, 10)
  const layers: FlowMultilayer["layers"] = []
  for (const [index, [lowerBound, upperBound]] of layerBounds.entries()) {

    if (upperBound >= 255) {
      progress?.(`Processing layer ${index + 1}/${layerBounds.length}`)
      await frame()

      const lowerBoundMask = await getDepthMapMaskByLowerBound(dilatedDepthMap, lowerBound)
      const { mask: upperBoundMask } = await clipDepthMapWithUpperBound(dilatedDepthMap, upperBound)
      const mergedDepthMap = await postprocessAndMergeDepthMapAndMasks(dilatedDepthMap, lowerBoundMask, upperBoundMask, layerDepthMapDilateRadius)

      console.log(`layer ${index + 1}/${layerBounds.length} layerDepthMap`)
      await consoleLogImageData(mergedDepthMap)
      console.log(`layer ${index + 1}/${layerBounds.length} layerImageData`)
      await consoleLogImageData(imageData)

      const layerImage = await saveImageData(imageData)
      const layerDepthMap = await saveImageData(mergedDepthMap, "image/png")

      layers.push({
        image: layerImage,
        depthMap: layerDepthMap,
      })

    } else {
      progress?.(`Processing layer ${index + 1}/${layerBounds.length}`)
      await frame()

      const lowerBoundMask = await getDepthMapMaskByLowerBound(dilatedDepthMap, lowerBound)
      const { clippedMap, mask: upperBoundMask } = await clipDepthMapWithUpperBound(dilatedDepthMap, upperBound)
      const processedMap = await postprocessClippedDepthMap(clippedMap, upperBoundMask)
      const mergedDepthMap = await postprocessAndMergeDepthMapAndMasks(processedMap, lowerBoundMask, upperBoundMask, layerDepthMapDilateRadius)

      // console.log(`layer ${index + 1}/${layerBounds.length} lowerBoundMask`)
      // await consoleLogImageData(lowerBoundMask)
      // console.log(`layer ${index + 1}/${layerBounds.length} upperBoundMask`)
      // await consoleLogImageData(upperBoundMask)
      // console.log(`layer ${index + 1}/${layerBounds.length} clippedMap`)
      // await consoleLogImageData(clippedMap)
      // console.log(`layer ${index + 1}/${layerBounds.length} processedMap`)
      // await consoleLogImageData(processedMap)
      console.log(`layer ${index + 1}/${layerBounds.length} layerDepthMap`)
      await consoleLogImageData(mergedDepthMap)

      progress?.(`Running inpaint model for layer ${index + 1}/${layerBounds.length}`)
      await frame()

      const { scaledImageData, scaledMask } = await scaleImageAndMaskDataForInpaint(imageData, upperBoundMask)
      const imageTensor = tensorFromImageData(scaledImageData, false)
      const maskTensor = tensorFromImageDataChannel(scaledMask, "r", false)
      const inpaintedTensor = await inferInpaintSession(inpaintModelSession, imageTensor, maskTensor)
      const inpaintedLayer = tensorToRgbImageData(inpaintedTensor, false)

      // console.log(`layer ${index + 1}/${layerBounds.length} inpaintedLayer`)
      // await consoleLogImageData(inpaintedLayer)

      progress?.(`Postprocessing layer ${index + 1}/${layerBounds.length}`)
      await frame()

      const scaledBackInpaintedLayer = await scaleImageData(inpaintedLayer, imageData.width, imageData.height)

      await writeImageDataChannel(upperBoundMask, "r", scaledBackInpaintedLayer, "a")
      const layerImageData = await alphaBlend(imageData, scaledBackInpaintedLayer)
      const layerImage = await saveImageData(layerImageData, "image/png")
      const layerDepthMap = await saveImageData(mergedDepthMap, "image/png")

      // console.log(`layer ${index + 1}/${layerBounds.length} scaledBackInpaintedLayer`)
      // await consoleLogImageData(scaledBackInpaintedLayer)
      console.log(`layer ${index + 1}/${layerBounds.length} layerImageData`)
      await consoleLogImageData(layerImageData)

      layers.push({
        image: layerImage,
        depthMap: layerDepthMap,
      })
    }
  }

  progress?.("Making flow file")
  await frame()

  const flow: FlowMultilayer = {
    originalImage: image,
    originalDepthMap: depthMapBlob,
    width: imageData.width,
    height: imageData.height,

    inpaintLayers: layers.length,
    inpaintDivisionPoints: divisionPoints,

    layers,

    processedBy: "depth-flow-web/simple/v0",
    processArgs: {
      depthMapDilateRadius,
      layerDepthMapDilateRadius,
    },
  }
  const flowBlob = await saveFlowZip(flow)

  return flowBlob
}
