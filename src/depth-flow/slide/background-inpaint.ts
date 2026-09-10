import {
  circularDilateGrayscale,
  cloneImageData,
  gaussianBlurImageData,
  scaleImageData,
} from "../image/utils"


export interface RepairMaskArgs {
  repairThreshold: number
  repairDilateRadius: number
}

export interface RepairMasks {
  fullResolutionRepairMask: ImageData
  fullResolutionBlendMask: ImageData
  repairRatio: number
  dilatedRepairRatio: number
}

function thresholdImage(image: ImageData, threshold: number) {
  const output = new ImageData(image.width, image.height)
  const byteThreshold = Math.round(Math.max(0, Math.min(1, threshold)) * 255)
  let activePixels = 0

  for (let i = 0; i < image.data.length; i += 4) {
    const value = image.data[i] >= byteThreshold ? 255 : 0
    if (value)
      activePixels++
    output.data[i] = value
    output.data[i + 1] = value
    output.data[i + 2] = value
    output.data[i + 3] = 255
  }

  return {
    image: output,
    ratio: activePixels / (image.width * image.height),
  }
}

function maskRatio(mask: ImageData) {
  let activePixels = 0
  for (let i = 0; i < mask.data.length; i += 4) {
    if (mask.data[i] >= 128)
      activePixels++
  }
  return activePixels / (mask.width * mask.height)
}

export async function createRepairMasks(
  softDisocclusion: ImageData,
  outputWidth: number,
  outputHeight: number,
  args: RepairMaskArgs,
): Promise<RepairMasks> {
  // Upsample the soft map first. Thresholding a nearest-neighbor binary mask
  // would preserve the native-grid staircase at the final image resolution.
  const fullResolutionSoftMask = await scaleImageData(
    softDisocclusion,
    outputWidth,
    outputHeight,
  )
  const fullThresholded = thresholdImage(fullResolutionSoftMask, args.repairThreshold)
  const nativeToOutputScale = Math.max(
    outputWidth / softDisocclusion.width,
    outputHeight / softDisocclusion.height,
  )
  const outputDilateRadius = Math.round(args.repairDilateRadius * nativeToOutputScale)
  const fullResolutionRepairMask = outputDilateRadius > 0
    ? circularDilateGrayscale(fullThresholded.image, outputDilateRadius)
    : fullThresholded.image
  const fullResolutionBlendMask = gaussianBlurImageData(fullResolutionRepairMask, 2.5, true)
  // Feather inward only. Outside the repair mask Bottom must remain exactly
  // identical to Top/source, so harmless transparency cannot reveal altered RGB.
  for (let i = 0; i < fullResolutionBlendMask.data.length; i += 4) {
    if (fullResolutionRepairMask.data[i] >= 128)
      continue
    fullResolutionBlendMask.data[i] = 0
    fullResolutionBlendMask.data[i + 1] = 0
    fullResolutionBlendMask.data[i + 2] = 0
  }

  return {
    fullResolutionRepairMask,
    fullResolutionBlendMask,
    repairRatio: fullThresholded.ratio,
    dilatedRepairRatio: maskRatio(fullResolutionRepairMask),
  }
}

export function compositeInpaintedImage(
  source: ImageData,
  inpainted: ImageData,
  blendMask: ImageData,
) {
  if (
    source.width !== inpainted.width
    || source.height !== inpainted.height
    || source.width !== blendMask.width
    || source.height !== blendMask.height
  ) {
    throw new Error("Source, inpainted image, and mask must have the same size")
  }

  const output = cloneImageData(source)
  for (let i = 0; i < output.data.length; i += 4) {
    const alpha = blendMask.data[i] / 255
    if (alpha <= 0)
      continue
    const inverseAlpha = 1 - alpha
    output.data[i] = source.data[i] * inverseAlpha + inpainted.data[i] * alpha
    output.data[i + 1] = source.data[i + 1] * inverseAlpha + inpainted.data[i + 1] * alpha
    output.data[i + 2] = source.data[i + 2] * inverseAlpha + inpainted.data[i + 2] * alpha
  }
  return output
}

export function alignVisibilityToRepairMask(
  visibility: ImageData,
  blendMask: ImageData,
) {
  if (
    visibility.width !== blendMask.width
    || visibility.height !== blendMask.height
  ) {
    throw new Error("Visibility and blend mask must have the same size")
  }

  const output = cloneImageData(visibility)
  for (let i = 0; i < output.data.length; i += 4) {
    const blend = blendMask.data[i] / 255
    const value = 255 - (255 - visibility.data[i]) * blend
    output.data[i] = value
    output.data[i + 1] = value
    output.data[i + 2] = value
  }
  return output
}
