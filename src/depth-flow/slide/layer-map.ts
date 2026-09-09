export function packSlideLayerMap(
  topDepthMap: ImageData,
  topVisibility: ImageData,
  bottomDepthMap: ImageData,
) {
  if (
    topDepthMap.width !== topVisibility.width
    || topDepthMap.height !== topVisibility.height
    || topDepthMap.width !== bottomDepthMap.width
    || topDepthMap.height !== bottomDepthMap.height
  ) {
    throw new Error("SLIDE layer maps must have the same size")
  }

  const output = new ImageData(topDepthMap.width, topDepthMap.height)
  for (let i = 0; i < output.data.length; i += 4) {
    output.data[i] = topDepthMap.data[i]
    output.data[i + 1] = topVisibility.data[i]
    output.data[i + 2] = bottomDepthMap.data[i]
    output.data[i + 3] = 255
  }
  return output
}
