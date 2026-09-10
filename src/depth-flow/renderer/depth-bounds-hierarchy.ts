export interface DepthBoundsLevel {
  width: number
  height: number
  data: Uint8Array
}

function createBaseLevel(depthMap: ImageData, channels: number[]): DepthBoundsLevel {
  const { width, height, data: source } = depthMap
  const data = new Uint8Array(width * height * 2)

  for (let textureY = 0; textureY < height; textureY++) {
    // Match depth_map, which is uploaded from a DOM image with flipY enabled.
    const imageY = height - 1 - textureY

    for (let x = 0; x < width; x++) {
      let minDepth = 255
      let maxDepth = 0

      // Bilinear depth sampling can use neighboring source texels.
      for (let dy = -1; dy <= 1; dy++) {
        const y = Math.max(0, Math.min(height - 1, imageY + dy))
        for (let dx = -1; dx <= 1; dx++) {
          const sampleX = Math.max(0, Math.min(width - 1, x + dx))
          const sourceIndex = (y * width + sampleX) * 4
          for (const channel of channels) {
            const depth = source[sourceIndex + channel]
            minDepth = Math.min(minDepth, depth)
            maxDepth = Math.max(maxDepth, depth)
          }
        }
      }

      const outputIndex = (textureY * width + x) * 2
      data[outputIndex] = minDepth
      data[outputIndex + 1] = maxDepth
    }
  }

  return { width, height, data }
}

function createNextLevel(previous: DepthBoundsLevel): DepthBoundsLevel {
  const width = Math.max(1, Math.floor(previous.width / 2))
  const height = Math.max(1, Math.floor(previous.height / 2))
  const data = new Uint8Array(width * height * 2)

  for (let y = 0; y < height; y++) {
    const sourceY0 = Math.floor(y * previous.height / height)
    const sourceY1 = Math.ceil((y + 1) * previous.height / height)

    for (let x = 0; x < width; x++) {
      const sourceX0 = Math.floor(x * previous.width / width)
      const sourceX1 = Math.ceil((x + 1) * previous.width / width)
      let minDepth = 255
      let maxDepth = 0

      for (let sourceY = sourceY0; sourceY < sourceY1; sourceY++) {
        for (let sourceX = sourceX0; sourceX < sourceX1; sourceX++) {
          const sourceIndex = (sourceY * previous.width + sourceX) * 2
          minDepth = Math.min(minDepth, previous.data[sourceIndex])
          maxDepth = Math.max(maxDepth, previous.data[sourceIndex + 1])
        }
      }

      const outputIndex = (y * width + x) * 2
      data[outputIndex] = minDepth
      data[outputIndex + 1] = maxDepth
    }
  }

  return { width, height, data }
}

function addCellHalo(level: DepthBoundsLevel): DepthBoundsLevel {
  const { width, height, data: source } = level
  const data = new Uint8Array(source.length)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let minDepth = 255
      let maxDepth = 0

      for (let dy = -1; dy <= 1; dy++) {
        const sourceY = Math.max(0, Math.min(height - 1, y + dy))
        for (let dx = -1; dx <= 1; dx++) {
          const sourceX = Math.max(0, Math.min(width - 1, x + dx))
          const sourceIndex = (sourceY * width + sourceX) * 2
          minDepth = Math.min(minDepth, source[sourceIndex])
          maxDepth = Math.max(maxDepth, source[sourceIndex + 1])
        }
      }

      const outputIndex = (y * width + x) * 2
      data[outputIndex] = minDepth
      data[outputIndex + 1] = maxDepth
    }
  }

  return { width, height, data }
}

export function createDepthBoundsHierarchy(depthMap: ImageData, channels: number[] = [0]) {
  if (channels.length === 0 || channels.some(channel => channel < 0 || channel > 3))
    throw new Error("Depth bounds channels must contain RGBA channel indexes")

  const rawLevels = [createBaseLevel(depthMap, channels)]

  while (rawLevels[rawLevels.length - 1].width > 1 || rawLevels[rawLevels.length - 1].height > 1)
    rawLevels.push(createNextLevel(rawLevels[rawLevels.length - 1]))

  // Keep raw levels independent, then add a one-cell 3x3 halo to each. With a
  // single midpoint lookup this guarantees a covered radius of 2^L texels, so
  // the shader's L=ceil(log2(rayHalfSpanTexels)) is the minimum safe LOD. Do not
  // build the next level from haloed data: halos would accumulate and loosen
  // the bounds, increasing ray-march work.
  return rawLevels.map(addCellHalo)
}

export function createDepthBoundsTexture(
  gl: WebGL2RenderingContext,
  levels: DepthBoundsLevel[],
) {
  const texture = gl.createTexture()
  if (!texture)
    throw new Error("Failed to create depth bounds texture")

  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texStorage2D(
    gl.TEXTURE_2D,
    levels.length,
    gl.RG8,
    levels[0].width,
    levels[0].height,
  )

  const previousFlipY = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL) as boolean
  const previousAlignment = gl.getParameter(gl.UNPACK_ALIGNMENT) as number
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  for (const [level, bounds] of levels.entries()) {
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      level,
      0,
      0,
      bounds.width,
      bounds.height,
      gl.RG,
      gl.UNSIGNED_BYTE,
      bounds.data,
    )
  }
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, previousFlipY)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, previousAlignment)

  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, 0)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, levels.length - 1)
  gl.bindTexture(gl.TEXTURE_2D, null)

  return texture
}
