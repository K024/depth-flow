import { getCachedFile } from "./file-cache"
import { saveFlowZip } from "./flow-file"
import { consoleLogImageData } from "./image/console"
import {
  normalizeDepthMap,
  type DepthMapNormalization,
} from "./image/depth-map"
import {
  circularDilateGrayscale,
  cloneImageData,
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
  prepareImageAndMasksForInpaint,
  restoreInpaintOutputInto,
} from "./models/inpaint"
import {
  tensorFromImageData,
  tensorFromImageDataChannel,
  tensorToGrayscaleImageData,
  tensorToRgbImageData,
} from "./models/tensor"
import {
  alignVisibilityToRepairMask,
  compositeInpaintedImage,
  createRepairMasks,
  type RepairMaskArgs,
} from "./slide/background-inpaint"
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

async function simpleProcess(
  image: Blob,
  args: Required<SimpleFlowArgs>,
  progress?: ProgressReporter,
  suppliedDepthMap?: Blob,
) {
  progress?.("Loading image")
  await frame()

  const imageElement = await loadImageFromBlob(image)
  const imageData = getImageData(imageElement)

  if (suppliedDepthMap) {
    progress?.("Loading supplied depth map")
    await frame()

    const depthMapElement = await loadImageFromBlob(suppliedDepthMap)
    const suppliedDepthMapData = getImageData(depthMapElement)
    if (
      suppliedDepthMapData.width !== imageData.width
      || suppliedDepthMapData.height !== imageData.height
    ) {
      throw new Error(
        `Depth map must match image size (${imageData.width}×${imageData.height}); `
        + `received ${suppliedDepthMapData.width}×${suppliedDepthMapData.height}`,
      )
    }

    progress?.("Preparing supplied depth map")
    await frame()

    const { image: normalizedDepthMap, normalization } = normalizeDepthMap(suppliedDepthMapData)
    // Keep SLIDE analysis on same compact grid used for model-generated maps.
    // Simple Flow uses scaledBackDepthMap, while SLIDE uses depthMap for its
    // native-grid masks and scaledBackDepthMap for final full-size output.
    const analysisDepthMap = await resizeImageForDepthModel(normalizedDepthMap)
    const dilatedDepthMap = args.depthMapDilateRadius > 0
      ? circularDilateGrayscale(normalizedDepthMap, args.depthMapDilateRadius)
      : cloneImageData(normalizedDepthMap)

    console.log("supplied depth map normalization", normalization)
    return {
      imageData,
      depthMap: analysisDepthMap,
      scaledBackDepthMap: normalizedDepthMap,
      dilatedDepthMap,
      depthMapNormalization: normalization,
    }
  }

  progress?.("Loading depth model")
  await frame()

  const depthModelSession = await cachedDepthModelSession()

  const scaledImageData = await resizeImageForDepthModel(imageData)

  progress?.("Running depth model")
  await frame()

  const imageTensor = tensorFromImageData(scaledImageData, true)
  const depthTensor = await inferDepthModelSession(depthModelSession, imageTensor)
  const depthMap = tensorToGrayscaleImageData(depthTensor, true)

  progress?.("Post-processing depth map")
  await frame()

  const scaledBackDepthMap = await scaleImageData(depthMap, imageData.width, imageData.height)
  const dilatedDepthMap = args.depthMapDilateRadius > 0
    // Match SLIDE's grayscale circular max-pool: unlike the legacy square
    // filter, it expands curved and diagonal silhouettes isotropically.
    ? circularDilateGrayscale(scaledBackDepthMap, args.depthMapDilateRadius)
    : scaledBackDepthMap

  if (args.depthMapDilateRadius > 0) {
    console.log(`dilatedDepthMap`)
    await consoleLogImageData(dilatedDepthMap)
  }

  return {
    imageData,
    depthMap,
    scaledBackDepthMap,
    dilatedDepthMap,
    depthMapNormalization: undefined,
  }
}

export async function createSimpleFlow(
  image: Blob,
  args?: SimpleFlowArgs,
  progress?: ProgressReporter,
  suppliedDepthMap?: Blob,
) {

  const normalizedArgs: Required<SimpleFlowArgs> = {
    depthMapDilateRadius: clip(args?.depthMapDilateRadius ?? 4, 0, 20),
  }

  const {
    imageData,
    dilatedDepthMap,
    depthMapNormalization,
  } = await simpleProcess(image, normalizedArgs, progress, suppliedDepthMap)
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

    processedBy: suppliedDepthMap
      ? "depth-flow-web/simple/custom-depth/v1"
      : "depth-flow-web/simple/v0",
    processArgs: {
      ...normalizedArgs,
      depthMapSource: suppliedDepthMap ? "supplied" : "depth-anything-v2",
      ...(depthMapNormalization && { depthMapNormalization }),
    },
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
  suppliedDepthMap?: Blob,
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

  const {
    imageData,
    depthMap,
    scaledBackDepthMap,
    depthMapNormalization,
  } = await simpleProcess(
    image,
    { depthMapDilateRadius: 0 },
    progress,
    suppliedDepthMap,
  )

  progress?.("Computing SLIDE soft layering")
  await frame()

  // Keep all layering analysis on the depth model's native grid; downsampling
  // it again made the visibility contours visibly stair-step after upscaling.
  //
  // D_pool protects foreground silhouettes and is the geometry used by the
  // SLIDE Eq. 5 disocclusion scan. D_top = Gaussian(D_pool) drives both rendered
  // Top geometry and visibility so their transition bands stay aligned. The raw
  // depthMap is passed separately as the argmin value source: pooling is right
  // for conservative geometry but would bias far/background values toward Top.
  const pooledDepthMap = circularDilateGrayscale(depthMap, normalizedArgs.poolRadius)
  const nativeTopDepthMap = gaussianBlurImageData(
    pooledDepthMap,
    normalizedArgs.blurSigma,
    true,
  )
  const diagnostics = await createSoftLayeringDiagnostics(
    nativeTopDepthMap,
    pooledDepthMap,
    depthMap,
    normalizedArgs,
  )
  const repairMasks = await createRepairMasks(
    diagnostics.softDisocclusion,
    imageData.width,
    imageData.height,
    normalizedArgs,
  )
  const topDepthMap = await scaleImageData(
    nativeTopDepthMap,
    imageData.width,
    imageData.height,
  )
  const rawTopVisibility = await scaleImageData(
    diagnostics.topVisibility,
    imageData.width,
    imageData.height,
  )
  const topVisibility = alignVisibilityToRepairMask(
    rawTopVisibility,
    repairMasks.fullResolutionBlendMask,
  )
  // Recompute both visibility ratios from the final, aligned full-resolution
  // map. Mixing native-grid and final-grid diagnostics made the table look
  // internally comparable when it was not. opaqueVisibilityRatio also predicts
  // the shader's single-ray fast-path rate (accepted target >= 0.85).
  let lowVisibilityPixels = 0
  let opaquePixels = 0
  for (let i = 0; i < topVisibility.data.length; i += 4) {
    if (topVisibility.data[i] < 128)
      lowVisibilityPixels++
    if (topVisibility.data[i] === 255)
      opaquePixels++
  }
  const visibilityPixels = topVisibility.width * topVisibility.height
  diagnostics.stats.lowVisibilityRatio = lowVisibilityPixels / visibilityPixels
  diagnostics.stats.opaqueVisibilityRatio = opaquePixels / visibilityPixels
  const images = [
    ["sourceDisparity", diagnostics.sourceDisparity],
    ["gradientMagnitude", diagnostics.gradientMagnitude],
    ["topVisibility", diagnostics.topVisibility],
    ["maxDisocclusionScore", diagnostics.maxDisocclusionScore],
    ["softDisocclusion", diagnostics.softDisocclusion],
    ["farReference", diagnostics.farReferenceImage],
    ["fullResolutionRepairMask", repairMasks.fullResolutionRepairMask],
    ["fullResolutionBlendMask", repairMasks.fullResolutionBlendMask],
    ["finalTopVisibility", topVisibility],
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
    const preparedInputs = await prepareImageAndMasksForInpaint(
      imageData,
      repairMasks.fullResolutionRepairMask,
    )
    console.table(preparedInputs.map((prepared, index) => ({
      crop: index,
      x: prepared.cropX,
      y: prepared.cropY,
      width: prepared.cropWidth,
      height: prepared.cropHeight,
      modelMaskWidth: prepared.estimatedModelMaskWidth,
    })))
    const restoredOutput = new ImageData(imageData.width, imageData.height)
    for (let index = 0; index < preparedInputs.length; index++) {
      progress?.(`Running LaMa background inpaint (${index + 1}/${preparedInputs.length})`)
      await frame()
      const prepared = preparedInputs[index]
      const imageTensor = tensorFromImageData(prepared.image, false)
      const maskTensor = tensorFromImageDataChannel(prepared.mask, "r", false)
      const outputTensor = await inferInpaintSession(inpaintSession, imageTensor, maskTensor)
      const paddedOutput = tensorToRgbImageData(outputTensor, false)
      await restoreInpaintOutputInto(restoredOutput, paddedOutput, prepared)
    }
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

  const fullResolutionFarReference = await scaleImageData(
    diagnostics.farReferenceImage,
    imageData.width,
    imageData.height,
  )
  const bottomDepthRepair = repairBottomDepth(
    scaledBackDepthMap,
    topDepthMap,
    fullResolutionFarReference,
    repairMasks.fullResolutionBlendMask,
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

  // layer-map R is the rendered Top depth and is directly compatible with the
  // Simple shader's red-channel depth lookup. Reuse this packed image for
  // originalDepthMap instead of storing a redundant raw-depth PNG.
  const layerMapBlob = await saveImageData(layerMap, "image/png")
  const flow: FlowSlide = {
    type: "slide",
    version: 1,
    originalImage: image,
    originalDepthMap: layerMapBlob,
    bottomImage: await saveImageData(bottomImage, "image/png"),
    layerMap: layerMapBlob,
    width: imageData.width,
    height: imageData.height,
    processedBy: suppliedDepthMap
      ? "depth-flow-web/slide/custom-depth/v1"
      : "depth-flow-web/slide/v3",
    processArgs: {
      ...normalizedArgs,
      depthMapSource: suppliedDepthMap ? "supplied" : "depth-anything-v2",
      ...(depthMapNormalization && { depthMapNormalization }),
    },
  }

  return saveFlowZip(flow)
}
