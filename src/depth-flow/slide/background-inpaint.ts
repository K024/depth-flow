import {
  circularDilateGrayscale,
  cloneImageData,
  gaussianBlurImageData,
  scaleImageData,
} from "../image/utils"


export interface RepairMaskArgs {
  // Reference pixels on the analysisReferenceShortEdge grid. Do NOT pre-scale
  // this by the analysis grid: createRepairMasks already multiplies by
  // nativeToOutputScale, and the two factors would cancel into a double count.
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
  // Compare in float. Rounding the threshold to a byte first put the cut on the
  // wrong side for values that land near a half-LSB: the exact equivalent of
  // the old (gamma 30, threshold 0.5) pair is tanh(30 * 0.0183102) = 0.499995,
  // which rounds to byte 127 and silently widened the mask by one level.
  let activePixels = 0

  for (let i = 0; i < image.data.length; i += 4) {
    const value = image.data[i] / 255 >= threshold ? 255 : 0
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
  softThreshold: number,
): Promise<RepairMasks> {
  // Upsample the soft map first. Thresholding a nearest-neighbor binary mask
  // would preserve the native-grid staircase at the final image resolution.
  // softThreshold comes from resolveDisocclusionShaping, so this cut is exactly
  // score >= repairScoreThreshold; rho, not this threshold, remains the primary
  // geometric control of repair-band width.
  const fullResolutionSoftMask = await scaleImageData(
    softDisocclusion,
    outputWidth,
    outputHeight,
  )
  const fullThresholded = thresholdImage(fullResolutionSoftMask, softThreshold)
  // repairDilateRadius is in reference-grid pixels and this factor carries it
  // to output pixels. Because the analysis grid appears in both the numerator
  // of the tuned value and the denominator here, the composite is a fixed
  // fraction of the output short edge and does not need a grid-scale term.
  const nativeToOutputScale = Math.max(
    outputWidth / softDisocclusion.width,
    outputHeight / softDisocclusion.height,
  )
  const outputDilateRadius = args.repairDilateRadius * nativeToOutputScale
  const fullResolutionRepairMask = outputDilateRadius >= 1
    ? circularDilateGrayscale(fullThresholded.image, outputDilateRadius)
    : fullThresholded.image
  const fullResolutionBlendMask = gaussianBlurImageData(fullResolutionRepairMask, 2.5, true)
  // Feather inward only. Outside the repair mask Bottom must remain exactly
  // identical to source RGB; preserving zero outside-mask RGB change is a hard
  // acceptance invariant. Depth intentionally does NOT use this feather as a
  // lerp: blending Bottom back toward Top recreated an epsilon-hugging rim.
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
    // A' = 255 - (255-A)*blend. Outside the repair region, Bottom RGB is the
    // original image and Bottom depth is paired to the unpooled source depth,
    // so a second ray cannot add useful color. Forcing A=255 there preserves
    // appearance while raising opaqueVisibilityRatio (target >= 0.85), which
    // directly increases the shader's one-ray fast-path hit rate. Reusing the
    // feathered mask avoids a hard visibility ring at the boundary.
    const value = 255 - (255 - visibility.data[i]) * blend
    output.data[i] = value
    output.data[i + 1] = value
    output.data[i + 2] = value
  }
  return output
}
