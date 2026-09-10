
export function getCanvas(width: number, height: number) {
  let canvas
  if (typeof document !== undefined) {
    canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
  } else {
    throw new Error("Unable to create canvas")
  }

  const ctx = canvas.getContext("2d")
  if (!ctx)
    throw new Error("Failed to get canvas context")

  return { canvas, ctx }
}


export function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error("Failed to load image"))
    image.src = url
  })
}


export async function loadImageFromBlob(blob: Blob) {
  const url = URL.createObjectURL(blob)
  try {
    return await loadImage(url)
  } finally {
    URL.revokeObjectURL(url)
  }
}


export function getImageData(image: HTMLImageElement) {
  if (!image.complete) {
    throw new Error("Image is not loaded")
  }
  const { ctx } = getCanvas(image.width, image.height)
  ctx.drawImage(image, 0, 0)
  return ctx.getImageData(0, 0, image.width, image.height)
}


export async function saveImageData(imageData: ImageData, type: string = "image/png", quality?: number) {
  const { canvas, ctx } = getCanvas(imageData.width, imageData.height)
  const imageBitmap = await createImageBitmap(imageData)
  ctx.drawImage(imageBitmap, 0, 0)
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob)
      } else {
        reject(new Error("Failed to save image"))
      }
    }, type, quality)
  })
}


export function cloneImageData(imageData: ImageData) {
  const { data, width, height } = imageData
  const output = new ImageData(width, height)
  output.data.set(data)
  return output
}


export async function scaleImageData(imageData: ImageData, width: number, height: number, resizeQuality: ImageSmoothingQuality = "high") {
  const { ctx } = getCanvas(width, height)

  // const imageBitmap = await createImageBitmap(imageData, {
  //   resizeWidth: width,
  //   resizeHeight: height,
  //   resizeQuality,
  // })

  // ctx.drawImage(imageBitmap, 0, 0)

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = resizeQuality
  const imageBitmap = await createImageBitmap(imageData)
  ctx.drawImage(
    imageBitmap,
    0, 0, imageData.width, imageData.height,
    0, 0, width, height,
  )

  const scaledImageData = ctx.getImageData(0, 0, width, height)

  return scaledImageData
}

export async function scaleImageDataNearest(imageData: ImageData, width: number, height: number) {
  const { ctx } = getCanvas(width, height)
  ctx.imageSmoothingEnabled = false
  const imageBitmap = await createImageBitmap(imageData)
  ctx.drawImage(
    imageBitmap,
    0, 0, imageData.width, imageData.height,
    0, 0, width, height,
  )
  return ctx.getImageData(0, 0, width, height)
}


export const maxFilter = (a: number, b: number) => a > b ? a : b
export const minFilter = (a: number, b: number) => a < b ? a : b

export async function dilateImageData(imageData: ImageData, radius: number, filter: (a: number, b: number) => number = maxFilter) {
  radius = Math.round(radius)
  if (radius <= 0)
    return cloneImageData(imageData)

  const { data, width, height } = imageData
  const dataLength = data.length

  const tempData = new Uint8ClampedArray(dataLength)
  const outputData = new Uint8ClampedArray(dataLength)

  // First pass: horizontal filtering (row-wise)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixelIdx = (y * width + x) * 4
      for (let channel = 0; channel < 4; channel++) {
        const idx = pixelIdx + channel
        let result = data[idx]
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx
          if (nx >= 0 && nx < width) {
            const neighborIdx = (y * width + nx) * 4 + channel
            result = filter(result, data[neighborIdx])
          }
        }
        tempData[idx] = result
      }
    }
  }

  // Second pass: vertical filtering (column-wise)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixelIdx = (y * width + x) * 4
      for (let channel = 0; channel < 4; channel++) {
        const idx = pixelIdx + channel
        let result = tempData[idx]
        for (let dy = -radius; dy <= radius; dy++) {
          const ny = y + dy
          if (ny >= 0 && ny < height) {
            const neighborIdx = (ny * width + x) * 4 + channel
            result = filter(result, tempData[neighborIdx])
          }
        }
        outputData[idx] = result
      }
    }
  }

  const output = new ImageData(outputData, width, height)
  return output
}


export function circularDilateGrayscale(imageData: ImageData, radius: number) {
  // Fractional radii are meaningful and are kept. The structuring element is
  // the set of lattice points with x^2 + y^2 <= radius^2, which grows in real
  // steps between integers: 5, 9, 13, 21, 29 pixels for radius 1, 1.5, 2, 2.5,
  // 3. Rounding to an integer threw that resolution away, which matters now
  // that callers rescale radii by a non-integer analysis-grid factor and would
  // otherwise get the same element for a whole band of inputs. Below 1 the
  // element is the center pixel alone, i.e. the identity.
  if (!(radius >= 1))
    return cloneImageData(imageData)

  const { data, width, height } = imageData
  const output = new ImageData(width, height)
  const outputData = output.data
  const rowValues = new Uint8ClampedArray(width)
  const filteredRow = new Uint8ClampedArray(width)
  const deque = new Int32Array(width)
  const verticalRadius = Math.floor(radius)

  // A disk is the union of horizontal intervals. For each vertical offset,
  // compute an exact sliding-window maximum and merge it into the output.
  // The circular element avoids the axis-aligned contour steps produced by a
  // separable square max filter. This function is intentionally grayscale:
  // depth and masks share one value across RGB, and processing one channel is
  // substantially cheaper than the legacy four-channel morphology.
  for (let dy = -verticalRadius; dy <= verticalRadius; dy++) {
    const horizontalRadius = Math.floor(Math.sqrt(radius * radius - dy * dy))
    for (let y = 0; y < height; y++) {
      const sourceY = y + dy
      if (sourceY < 0 || sourceY >= height)
        continue

      for (let x = 0; x < width; x++)
        rowValues[x] = data[(sourceY * width + x) * 4]

      let dequeStart = 0
      let dequeEnd = 0
      let nextX = 0
      for (let x = 0; x < width; x++) {
        const windowEnd = Math.min(width - 1, x + horizontalRadius)
        while (nextX <= windowEnd) {
          while (
            dequeEnd > dequeStart
            && rowValues[deque[dequeEnd - 1]] <= rowValues[nextX]
          ) {
            dequeEnd--
          }
          deque[dequeEnd++] = nextX++
        }

        const windowStart = x - horizontalRadius
        while (dequeEnd > dequeStart && deque[dequeStart] < windowStart)
          dequeStart++

        filteredRow[x] = rowValues[deque[dequeStart]]
      }

      for (let x = 0; x < width; x++) {
        const outputIndex = (y * width + x) * 4
        const value = Math.max(outputData[outputIndex], filteredRow[x])
        outputData[outputIndex] = value
        outputData[outputIndex + 1] = value
        outputData[outputIndex + 2] = value
        outputData[outputIndex + 3] = 255
      }
    }
  }

  return output
}


export function gaussianBlurImageData(
  imageData: ImageData,
  sigma: number,
  grayscale = false,
) {
  sigma = Math.max(0, sigma)
  if (sigma <= 0)
    return cloneImageData(imageData)

  const { data, width, height } = imageData
  const radius = Math.max(1, Math.ceil(sigma * 3))
  const kernel = new Float32Array(radius * 2 + 1)
  let kernelSum = 0
  for (let offset = -radius; offset <= radius; offset++) {
    const weight = Math.exp(-(offset * offset) / (2 * sigma * sigma))
    kernel[offset + radius] = weight
    kernelSum += weight
  }
  for (let i = 0; i < kernel.length; i++)
    kernel[i] /= kernelSum

  const temp = new Float32Array(data.length)
  const output = new ImageData(width, height)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const channelCount = grayscale ? 1 : 4
      for (let channel = 0; channel < channelCount; channel++) {
        let value = 0
        for (let offset = -radius; offset <= radius; offset++) {
          const sourceX = Math.max(0, Math.min(width - 1, x + offset))
          value += data[(y * width + sourceX) * 4 + channel] * kernel[offset + radius]
        }
        temp[(y * width + x) * 4 + channel] = value
      }
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const channelCount = grayscale ? 1 : 4
      for (let channel = 0; channel < channelCount; channel++) {
        let value = 0
        for (let offset = -radius; offset <= radius; offset++) {
          const sourceY = Math.max(0, Math.min(height - 1, y + offset))
          value += temp[(sourceY * width + x) * 4 + channel] * kernel[offset + radius]
        }
        output.data[(y * width + x) * 4 + channel] = Math.round(value)
      }
      if (grayscale) {
        const outputIndex = (y * width + x) * 4
        output.data[outputIndex + 1] = output.data[outputIndex]
        output.data[outputIndex + 2] = output.data[outputIndex]
        output.data[outputIndex + 3] = 255
      }
    }
  }

  return output
}


export async function writeImageDataChannel(source: ImageData, sourceChannel: "r" | "g" | "b" | "a", target: ImageData, targetChannel: "r" | "g" | "b" | "a") {
  const { data: sourceData, width: sourceWidth, height: sourceHeight } = source
  const { data: targetData, width: targetWidth, height: targetHeight } = target

  if (sourceWidth !== targetWidth || sourceHeight !== targetHeight) {
    throw new Error("Source and target must have the same size")
  }

  const sourceChannelIndex = "rgba".indexOf(sourceChannel)
  const targetChannelIndex = "rgba".indexOf(targetChannel)

  if (sourceChannelIndex === -1 || targetChannelIndex === -1) {
    throw new Error("Invalid channel")
  }

  for (let h = 0; h < sourceHeight; h++) {
    for (let w = 0; w < sourceWidth; w++) {
      const sourceIndex = (h * sourceWidth + w) * 4 + sourceChannelIndex
      const targetIndex = (h * targetWidth + w) * 4 + targetChannelIndex
      targetData[targetIndex] = sourceData[sourceIndex]
    }
  }

  return target
}


export async function invertImageData(imageData: ImageData) {
  const { width, height, data } = imageData
  const output = new ImageData(width, height)

  for (let i = 0; i < data.length; i += 4) {
    output.data[i] = 255 - data[i]         // R
    output.data[i + 1] = 255 - data[i + 1] // G 
    output.data[i + 2] = 255 - data[i + 2] // B
    output.data[i + 3] = data[i + 3]       // A (copy)
  }

  return output
}


export async function alphaBlend(back: ImageData, ...fronts: ImageData[]) {
  for (const front of fronts) {
    if (back.width !== front.width || back.height !== front.height) {
      throw new Error("Back and front images must have the same dimensions")
    }
  }

  const { canvas, ctx } = getCanvas(back.width, back.height)

  ctx.drawImage(await createImageBitmap(back), 0, 0)
  for (const front of fronts) {
    ctx.drawImage(await createImageBitmap(front), 0, 0)
  }

  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}
