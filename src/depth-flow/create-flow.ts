import { getCachedFile } from "./file-cache"
import { saveFlowZip } from "./flow-file"
import { consoleLogHistogram, consoleLogImageData } from "./image/console"
import { alphaBlend, dilateImageData, gaussianBlurImageData, getImageData, loadImageFromBlob, saveImageData, scaleImageData, writeImageDataChannel } from "./image/utils"
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


export interface MultilayerFlowArgs {
  depthMapDilateRadius?: number
  layerInpaintMaskDilateRadius?: number
  layerInpaintMaskBlurRadius?: number
  layerDepthMapDilateRadius?: number
  layerDepthMapBlurRadius?: number
  layerDisplayMaskBlurRadius?: number
  boundOverlap?: number
}

export async function createMultilayerFlow(image: Blob, args?: MultilayerFlowArgs, progress?: ProgressReporter): Promise<File> {

  const normalizedArgs: Required<MultilayerFlowArgs> = {
    depthMapDilateRadius: clip(args?.depthMapDilateRadius ?? 1, 0, 20),
    layerInpaintMaskDilateRadius: clip(args?.layerInpaintMaskDilateRadius ?? 12, 0, 30),
    layerInpaintMaskBlurRadius: clip(args?.layerInpaintMaskBlurRadius ?? 2, 0, 10),
    layerDepthMapDilateRadius: clip(args?.layerDepthMapDilateRadius ?? 6, 0, 10),
    layerDepthMapBlurRadius: clip(args?.layerDepthMapBlurRadius ?? 2, 0, 10),
    layerDisplayMaskBlurRadius: clip(args?.layerDisplayMaskBlurRadius ?? 2, 0, 10),
    boundOverlap: clip(args?.boundOverlap ?? 4, 0, 10),
  }

  const {
    imageData,
    dilatedDepthMap,
  } = await simpleProcess(image, normalizedArgs, progress)
  const depthMapBlob = await saveImageData(dilatedDepthMap, "image/png")

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

  const layers: FlowMultilayer["layers"] = []
  for (const [index, bounds] of layerBounds.entries()) {

    const lowerBound = bounds[0] - normalizedArgs.boundOverlap
    const upperBound = bounds[1] + normalizedArgs.boundOverlap

    if (upperBound >= 255) {
      progress?.(`Processing layer ${index + 1}/${layerBounds.length}`)
      await frame()

      const lowerBoundMask = await getDepthMapMaskByLowerBound(dilatedDepthMap, lowerBound)
      const { mask: upperBoundMask } = await clipDepthMapWithUpperBound(dilatedDepthMap, upperBound)
      // const dilatedUpperBoundMask = await dilateImageData(upperBoundMask, normalizedArgs.layerInpaintMaskDilateRadius)
      // const processedUpperBoundMask = await gaussianBlurImageData(dilatedUpperBoundMask, normalizedArgs.layerInpaintMaskBlurRadius)
      const mergedDepthMap = await postprocessAndMergeDepthMapAndMasks(
        dilatedDepthMap, lowerBoundMask, upperBoundMask,
        normalizedArgs.layerDepthMapDilateRadius,
        normalizedArgs.layerDepthMapBlurRadius,
        normalizedArgs.layerDisplayMaskBlurRadius
      )

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
      const dilatedUpperBoundMask = await dilateImageData(upperBoundMask, normalizedArgs.layerInpaintMaskDilateRadius)
      const processedUpperBoundMask = await gaussianBlurImageData(dilatedUpperBoundMask, normalizedArgs.layerInpaintMaskBlurRadius)
      const processedMap = await postprocessClippedDepthMap(
        clippedMap, processedUpperBoundMask,
        normalizedArgs.layerInpaintMaskDilateRadius
      )
      const mergedDepthMap = await postprocessAndMergeDepthMapAndMasks(
        processedMap, lowerBoundMask, processedUpperBoundMask,
        normalizedArgs.layerDepthMapDilateRadius,
        normalizedArgs.layerDepthMapBlurRadius,
        normalizedArgs.layerDisplayMaskBlurRadius
      )

      // console.log(`layer ${index + 1}/${layerBounds.length} lowerBoundMask`)
      // await consoleLogImageData(lowerBoundMask)
      // console.log(`layer ${index + 1}/${layerBounds.length} processedUpperBoundMask`)
      // await consoleLogImageData(processedUpperBoundMask)
      // console.log(`layer ${index + 1}/${layerBounds.length} clippedMap`)
      // await consoleLogImageData(clippedMap)
      // console.log(`layer ${index + 1}/${layerBounds.length} processedMap`)
      // await consoleLogImageData(processedMap)
      console.log(`layer ${index + 1}/${layerBounds.length} layerDepthMap`)
      await consoleLogImageData(mergedDepthMap)

      progress?.(`Running inpaint model for layer ${index + 1}/${layerBounds.length}`)
      await frame()

      const { scaledImageData, scaledMask } = await scaleImageAndMaskDataForInpaint(imageData, processedUpperBoundMask)
      const imageTensor = tensorFromImageData(scaledImageData, false)
      const maskTensor = tensorFromImageDataChannel(scaledMask, "r", false)
      const inpaintedTensor = await inferInpaintSession(inpaintModelSession, imageTensor, maskTensor)
      const inpaintedLayer = tensorToRgbImageData(inpaintedTensor, false)

      // console.log(`layer ${index + 1}/${layerBounds.length} inpaintedLayer`)
      // await consoleLogImageData(inpaintedLayer)

      progress?.(`Postprocessing layer ${index + 1}/${layerBounds.length}`)
      await frame()

      const scaledBackInpaintedLayer = await scaleImageData(inpaintedLayer, imageData.width, imageData.height)

      await writeImageDataChannel(processedUpperBoundMask, "r", scaledBackInpaintedLayer, "a")
      const layerImageData = await alphaBlend(imageData, scaledBackInpaintedLayer)

      // console.log(`layer ${index + 1}/${layerBounds.length} scaledBackInpaintedLayer`)
      // await consoleLogImageData(scaledBackInpaintedLayer)
      console.log(`layer ${index + 1}/${layerBounds.length} layerImageData`)
      await consoleLogImageData(layerImageData)

      const layerImage = await saveImageData(layerImageData, "image/png")
      const layerDepthMap = await saveImageData(mergedDepthMap, "image/png")
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
    processArgs: normalizedArgs,
  }
  const flowBlob = await saveFlowZip(flow)

  return flowBlob
}
