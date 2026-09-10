import { getCachedFile } from "./file-cache"
import { saveFlowZip } from "./flow-file"
import { consoleLogImageData } from "./image/console"
import {
  circularDilateImageData,
  dilateImageData,
  gaussianBlurImageData,
  getImageData,
  loadImageFromBlob,
  saveImageData,
  scaleImageData,
} from "./image/utils"
import { depthModelUrl, inpaintModelUrl } from "./models/cache"
import { getDepthModelSession, inferDepthModelSession, resizeImageForDepthModel } from "./models/depth"
import {
  getInpaintModelSession,
  inferInpaintSession,
  prepareImageAndMaskForInpaint,
  restoreInpaintOutput,
} from "./models/inpaint"
import {
  tensorFromImageData,
  tensorFromImageDataChannel,
  tensorToGrayscaleImageData,
  tensorToRgbImageData,
} from "./models/tensor"
import { compositeInpaintedImage, createRepairMasks, type RepairMaskArgs } from "./slide/background-inpaint"
import { repairBottomDepth, type BottomDepthRepairArgs } from "./slide/depth-repair"
import { packSlideLayerMap } from "./slide/layer-map"
import { createSoftLayeringDiagnostics, type SoftLayeringArgs } from "./slide/soft-layering"
import type { FlowSimple, FlowSlide } from "./types"
import { error, frame, lazyPromise, type ProgressReporter } from "./utils"



const cachedDepthModelSession = lazyPromise(async () => {
  const depthModelBlob = await getCachedFile(depthModelUrl) || error("Depth model not found")
  const depthModelSession = await getDepthModelSession(depthModelBlob)
  return depthModelSession
})

const cachedInpaintModelSession = lazyPromise(async () => {
  const inpaintModelBlob = await getCachedFile(inpaintModelUrl) || error("Inpaint model not found")
  return getInpaintModelSession(inpaintModelBlob)
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
    depthMap,
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
    type: "simple",
    version: 1,
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

export interface SlideFlowArgs extends SoftLayeringArgs, RepairMaskArgs, BottomDepthRepairArgs {
  poolRadius: number
}

export async function createSlideFlow(
  image: Blob,
  args: SlideFlowArgs,
  progress?: ProgressReporter,
) {
  const normalizedArgs: SlideFlowArgs = {
    poolRadius: clip(args.poolRadius, 0, 8),
    blurSigma: clip(args.blurSigma, 0, 6, false),
    betaStep: clip(args.betaStep, 5, 300, false),
    disocclusionRho: clip(args.disocclusionRho, 3, 24, false),
    disocclusionGamma: clip(args.disocclusionGamma, 5, 100, false),
    repairThreshold: clip(args.repairThreshold, 0, 1, false),
    repairDilateRadius: clip(args.repairDilateRadius, 0, 16),
    bottomDepthEpsilon: clip(args.bottomDepthEpsilon, 0, 0.25, false),
  }

  const { imageData, depthMap, scaledBackDepthMap } = await simpleProcess(
    image,
    { depthMapDilateRadius: 0 },
    progress,
  )

  progress?.("Computing SLIDE soft layering")
  await frame()

  // Keep all layering analysis on the depth model's native grid. D_pool is
  // used for disocclusion; its blurred form D_top drives both rendered Top
  // geometry and visibility so their transition bands stay aligned.
  const pooledDepthMap = circularDilateImageData(depthMap, normalizedArgs.poolRadius)
  const nativeTopDepthMap = await gaussianBlurImageData(
    pooledDepthMap,
    normalizedArgs.blurSigma,
  )
  const diagnostics = await createSoftLayeringDiagnostics(
    nativeTopDepthMap,
    pooledDepthMap,
    normalizedArgs,
  )
  const repairMasks = await createRepairMasks(
    diagnostics.softDisocclusion,
    imageData.width,
    imageData.height,
    normalizedArgs,
  )
  const images = [
    ["sourceDisparity", diagnostics.sourceDisparity],
    ["gradientMagnitude", diagnostics.gradientMagnitude],
    ["topVisibility", diagnostics.topVisibility],
    ["maxDisocclusionScore", diagnostics.maxDisocclusionScore],
    ["softDisocclusion", diagnostics.softDisocclusion],
    ["repairMask", repairMasks.repairMask],
    ["dilatedRepairMask", repairMasks.dilatedRepairMask],
    ["fullResolutionRepairMask", repairMasks.fullResolutionRepairMask],
    ["fullResolutionBlendMask", repairMasks.fullResolutionBlendMask],
  ] as const

  console.group("SLIDE soft-layering diagnostics")
  console.log("parameters", normalizedArgs)
  console.table(diagnostics.stats)
  for (const [name, imageData] of images) {
    console.log(`${name} (${imageData.width}x${imageData.height})`)
    await consoleLogImageData(imageData)
  }

  console.log("repair mask ratios", {
    thresholded: repairMasks.repairRatio,
    dilated: repairMasks.dilatedRepairRatio,
  })

  let bottomImage = imageData
  if (repairMasks.dilatedRepairRatio > 0) {
    progress?.("Running LaMa background inpaint")
    await frame()

    const inpaintSession = await cachedInpaintModelSession()
    const prepared = await prepareImageAndMaskForInpaint(
      imageData,
      repairMasks.fullResolutionRepairMask,
    )
    console.log("LaMa crop", {
      x: prepared.cropX,
      y: prepared.cropY,
      width: prepared.cropWidth,
      height: prepared.cropHeight,
    })
    const imageTensor = tensorFromImageData(prepared.image, false)
    const maskTensor = tensorFromImageDataChannel(prepared.mask, "r", false)
    const outputTensor = await inferInpaintSession(inpaintSession, imageTensor, maskTensor)
    const paddedOutput = tensorToRgbImageData(outputTensor, false)
    const restoredOutput = await restoreInpaintOutput(
      paddedOutput,
      prepared,
      imageData.width,
      imageData.height,
    )
    bottomImage = compositeInpaintedImage(
      imageData,
      restoredOutput,
      repairMasks.fullResolutionBlendMask,
    )

    console.log(`bottomImage (${bottomImage.width}x${bottomImage.height})`)
    await consoleLogImageData(bottomImage)
  } else {
    console.log("LaMa skipped: repair mask is empty")
  }

  progress?.("Building SLIDE depth layers")
  await frame()

  const topDepthMap = await scaleImageData(
    nativeTopDepthMap,
    imageData.width,
    imageData.height,
  )
  const topVisibility = await scaleImageData(
    diagnostics.topVisibility,
    imageData.width,
    imageData.height,
  )
  const bottomDepthRepair = repairBottomDepth(
    scaledBackDepthMap,
    topDepthMap,
    repairMasks.fullResolutionRepairMask,
    normalizedArgs,
  )
  const bottomDepthMap = bottomDepthRepair.image

  console.log(`topDepthMap (${topDepthMap.width}x${topDepthMap.height})`)
  await consoleLogImageData(topDepthMap)
  console.log(`topVisibility (${topVisibility.width}x${topVisibility.height})`)
  await consoleLogImageData(topVisibility)
  console.log(`bottomDepthMap (${bottomDepthMap.width}x${bottomDepthMap.height})`)
  await consoleLogImageData(bottomDepthMap)
  console.log("bottom depth repair", bottomDepthRepair.stats)
  const layerMap = packSlideLayerMap(topDepthMap, topVisibility, bottomDepthMap)
  console.log("layerMap RGB = topDepth / topVisibility / bottomDepth")
  await consoleLogImageData(layerMap)
  console.groupEnd()

  progress?.("Making SLIDE flow file")
  await frame()

  const flow: FlowSlide = {
    type: "slide",
    version: 1,
    originalImage: image,
    originalDepthMap: await saveImageData(scaledBackDepthMap, "image/png"),
    bottomImage: await saveImageData(bottomImage, "image/png"),
    layerMap: await saveImageData(layerMap, "image/png"),
    width: imageData.width,
    height: imageData.height,
    processedBy: "depth-flow-web/slide/v2",
    processArgs: normalizedArgs,
  }

  return saveFlowZip(flow)
}
