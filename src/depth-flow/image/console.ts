import { getCanvas } from "./utils"

export async function drawImageData(imageData: ImageData, longSideLength = 480) {

  let width, height
  const originalWidth = imageData.width
  const originalHeight = imageData.height

  if (originalWidth > originalHeight) {
    width = longSideLength
    height = Math.round(originalHeight * longSideLength / originalWidth)
  } else {
    height = longSideLength
    width = Math.round(originalWidth * longSideLength / originalHeight)
  }

  const { canvas, ctx } = getCanvas(width, height)
  ctx.drawImage(
    await createImageBitmap(imageData),
    0, 0, imageData.width, imageData.height,
    0, 0, width, height
  )

  return canvas
}


export async function consoleLogCanvas(canvas: HTMLCanvasElement) {
  const style = [
    'font-size: 1px;',
    `padding: ${canvas.height}px ${canvas.width}px 0 0;`,
    `background: url('${canvas.toDataURL("image/png")}') no-repeat center / contain;`,
  ].join(' ')
  console.log('%c ', style)
}

export async function consoleLogImageData(
  imageData: ImageData,
  longSideLength?: number,
) {
  if (typeof document === "undefined") {
    const canvas = await drawImageData(imageData, longSideLength)
    if (!(canvas instanceof OffscreenCanvas))
      throw new Error("Worker image preview requires an offscreen canvas")
    const blob = await canvas.convertToBlob({ type: "image/png" })
    const reader = new FileReader()
    const dataUrl = await new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(reader.error ?? new Error("Failed to encode image preview"))
      reader.readAsDataURL(blob)
    })
    console.log("%c ", [
      "font-size: 1px;",
      `padding: ${canvas.height}px ${canvas.width}px 0 0;`,
      `background: url('${dataUrl}') no-repeat center / contain;`,
    ].join(" "))
    return
  }
  const canvas = await drawImageData(imageData, longSideLength)
  if (canvas instanceof OffscreenCanvas)
    throw new Error("Image console preview requires an HTML canvas")
  consoleLogCanvas(canvas)
}
