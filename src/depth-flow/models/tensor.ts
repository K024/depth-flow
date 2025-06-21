import { ort } from "./ort"


const mean = [0.485, 0.456, 0.406]
const std = [0.229, 0.224, 0.225]


/**
 * rgb image => float32[n c(3) h w]
 */
export function tensorFromImageData(imageData: ImageData, normalize = true) {
  const { width, height, data } = imageData
  const floatData = new Float32Array(width * height * 3)
  const strideC = width * height

  for (let h = 0; h < height; h++) {
    for (let w = 0; w < width; w++) {
      const i = h * width + w
      const i4 = i * 4
      const r = data[i4] / 255
      const g = data[i4 + 1] / 255
      const b = data[i4 + 2] / 255

      if (normalize) {
        floatData[i] = (r - mean[0]) / std[0]
        floatData[i + strideC * 1] = (g - mean[1]) / std[1]
        floatData[i + strideC * 2] = (b - mean[2]) / std[2]
      } else {
        floatData[i] = r
        floatData[i + strideC * 1] = g
        floatData[i + strideC * 2] = b
      }
    }
  }

  return new ort.Tensor("float32", floatData, [1, 3, height, width])
}


/**
 * rgba image => float32[n 1 h w]
 */
export function tensorFromImageDataChannel(imageData: ImageData, channel: "r" | "g" | "b" | "a", normalize = false) {
  const channelIndex = "rgba".indexOf(channel)
  if (channelIndex === -1) {
    throw new Error("Invalid channel")
  }

  const { data, width, height } = imageData
  const floatData = new Float32Array(width * height)

  for (let h = 0; h < height; h++) {
    for (let w = 0; w < width; w++) {
      const i = h * width + w
      const i4 = i * 4
      const value = data[i4 + channelIndex] / 255

      if (normalize) {
        floatData[i] = (value - mean[channelIndex]) / std[channelIndex]
      } else {
        floatData[i] = value
      }
    }
  }

  return new ort.Tensor("float32", floatData, [1, 1, height, width])
}


/**
 * float32[n h w] => grayscale image
 */
export function tensorToGrayscaleImageData(tensor: ort.TypedTensor<"float32">, normalize = true) {
  if (tensor.dims.length !== 3 || tensor.dims[0] !== 1) {
    throw new Error("Unexpected size")
  }
  if (!normalize) {
    throw new Error("Grayscale image must be normalized")
  }

  const depthData = tensor.data
  const depthImageData = new ImageData(
    tensor.dims[2],
    tensor.dims[1]
  )

  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < depthData.length; i++) {
    const value = depthData[i]
    if (value < min) min = value
    if (value > max) max = value
  }
  const range = max - min

  for (let i = 0; i < depthData.length; i++) {
    const normalized = Math.round(((depthData[i] - min) / range) * 255)
    const idx = i * 4
    depthImageData.data[idx] = normalized     // R
    depthImageData.data[idx + 1] = normalized // G
    depthImageData.data[idx + 2] = normalized // B
    depthImageData.data[idx + 3] = 255        // A
  }

  return depthImageData
}


/**
 * float32[n c h w] => rgb image
 */
export function tensorToRgbImageData(tensor: ort.TypedTensor<"float32">, scale = true) {
  if (tensor.dims.length !== 4 || tensor.dims[0] !== 1 || tensor.dims[1] !== 3) {
    throw new Error("Unexpected size")
  }

  const data = tensor.data
  const imageData = new ImageData(
    tensor.dims[3],
    tensor.dims[2]
  )

  const height = tensor.dims[2]
  const width = tensor.dims[3]

  const strideC = height * width

  for (let h = 0; h < height; h++) {
    for (let w = 0; w < width; w++) {
      const i = h * width + w
      const i4 = i * 4

      if (scale) {
        imageData.data[i4] = data[i] * 255                   // R
        imageData.data[i4 + 1] = data[i + strideC] * 255     // G 
        imageData.data[i4 + 2] = data[i + strideC * 2] * 255 // B
        imageData.data[i4 + 3] = 255                         // A
      } else {
        imageData.data[i4] = data[i]                   // R
        imageData.data[i4 + 1] = data[i + strideC]     // G 
        imageData.data[i4 + 2] = data[i + strideC * 2] // B
        imageData.data[i4 + 3] = 255                   // A
      }
    }
  }

  return imageData
}

