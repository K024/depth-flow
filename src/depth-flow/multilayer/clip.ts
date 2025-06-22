import { alphaBlend as alphaBlendImageData, dilateImageData, gaussianBlurImageData, minFilter, writeImageDataChannel } from "../image/utils"


export function getBoundsForDivisions(divisionPoints: number[]) {
  if (!divisionPoints.length)
    throw new Error("divisionPoints must have at least one element")
  if (divisionPoints.some(x => x <= 0 || x >= 255))
    throw new Error("divisionPoints should be in range [1, 254]")

  const bounds = [
    0,
    ...divisionPoints,
    255
  ].sort((a, b) => a - b)

  const layerBounds = bounds.slice(1).map((x, i) => [bounds[i], x] as [lower: number, upper: number])

  return layerBounds.reverse() // from upper layer to lower layer
}


export async function clipDepthMapWithUpperBound(depthMap: ImageData, upperBound: number) {
  const width = depthMap.width
  const height = depthMap.height

  const clippedMap = new ImageData(width, height)
  const mask = new ImageData(width, height)

  for (let i = 0; i < depthMap.data.length; i += 4) {
    const depthValue = depthMap.data[i]

    let clippedValue = depthValue
    let maskValue = 0
    if (depthValue > upperBound) {
      clippedValue = upperBound
      maskValue = 255 // inverted, 1 for masked (to inpaint) and 0 for unchanged
    }

    clippedMap.data[i] = clippedValue     // R
    clippedMap.data[i + 1] = clippedValue // G
    clippedMap.data[i + 2] = clippedValue // B
    clippedMap.data[i + 3] = 255          // A

    mask.data[i] = maskValue     // R
    mask.data[i + 1] = maskValue // G
    mask.data[i + 2] = maskValue // B
    mask.data[i + 3] = 255       // A
  }

  return { clippedMap, mask }
}


export async function postprocessClippedDepthMap(clippedMap: ImageData, mask: ImageData) {
  const radius = 12
  const iterations = 12

  let currentImageData = clippedMap

  for (let i = 0; i < iterations; i++) {
    const blurredMap = await gaussianBlurImageData(clippedMap, radius)
    await writeImageDataChannel(mask, "r", blurredMap, "a")
    // update the inpainted areas with the blurred map
    currentImageData = await alphaBlendImageData(currentImageData, blurredMap)
  }

  return currentImageData
}



export async function getDepthMapMaskByLowerBound(depthMap: ImageData, lowerBound: number) {
  const width = depthMap.width
  const height = depthMap.height

  const mask = new ImageData(width, height)
  for (let i = 0; i < depthMap.data.length; i += 4) {
    const depthValue = depthMap.data[i]

    let clippedValue = depthValue
    let maskValue = 0
    if (depthValue >= lowerBound) {
      clippedValue = lowerBound
      maskValue = 255 // 1 for areas to show (to show) and 0 for areas to hide
    }

    mask.data[i] = maskValue     // R
    mask.data[i + 1] = maskValue // G
    mask.data[i + 2] = maskValue // B
    mask.data[i + 3] = 255       // A
  }

  return mask
}


export async function postprocessAndMergeDepthMapAndMasks(
  depthMap: ImageData, lowerBoundMask: ImageData, upperBoundMask: ImageData,
  layerDepthMapDilateRadius: number, layerDepthMapBlurRadius: number, layerDisplayMaskBlurRadius: number
) {
  depthMap = await dilateImageData(depthMap, layerDepthMapDilateRadius)
  depthMap = await gaussianBlurImageData(depthMap, layerDepthMapBlurRadius)
  lowerBoundMask = await gaussianBlurImageData(lowerBoundMask, layerDisplayMaskBlurRadius)
  await writeImageDataChannel(lowerBoundMask, "r", depthMap, "g")
  await writeImageDataChannel(upperBoundMask, "r", depthMap, "b")
  return depthMap
}

