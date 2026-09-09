import { cloneImageData, dilateImageData, scaleImageDataNearest } from "../image/utils"


export interface RepairMaskArgs {
  repairThreshold: number
  repairDilateRadius: number
}

export interface RepairMasks {
  repairMask: ImageData
  dilatedRepairMask: ImageData
  fullResolutionRepairMask: ImageData
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
  const thresholded = thresholdImage(softDisocclusion, args.repairThreshold)
  const dilatedRepairMask = args.repairDilateRadius > 0
    ? await dilateImageData(thresholded.image, args.repairDilateRadius)
    : cloneImageData(thresholded.image)
  const fullResolutionRepairMask = await scaleImageDataNearest(
    dilatedRepairMask,
    outputWidth,
    outputHeight,
  )

  return {
    repairMask: thresholded.image,
    dilatedRepairMask,
    fullResolutionRepairMask,
    repairRatio: thresholded.ratio,
    dilatedRepairRatio: maskRatio(dilatedRepairMask),
  }
}

export function compositeInpaintedImage(
  source: ImageData,
  inpainted: ImageData,
  mask: ImageData,
) {
  if (
    source.width !== inpainted.width
    || source.height !== inpainted.height
    || source.width !== mask.width
    || source.height !== mask.height
  ) {
    throw new Error("Source, inpainted image, and mask must have the same size")
  }

  const output = cloneImageData(source)
  for (let i = 0; i < output.data.length; i += 4) {
    if (mask.data[i] < 128)
      continue
    output.data[i] = inpainted.data[i]
    output.data[i + 1] = inpainted.data[i + 1]
    output.data[i + 2] = inpainted.data[i + 2]
  }
  return output
}
