import type { FlowSimple } from "../types"
import { getImageData, loadImageFromBlob } from "../image/utils"
import { calculateZoomScale, createBlurMipmap, createFrameTimeCounter, createPlaneShaderProgram } from "./common"
import fragSrc from "./shaders/simple-frag.glsl?raw"


export type Vec2 = [number, number]
export type Vec3 = [number, number, number]

export interface FlowSimpleRendererArgs {
  origin: Vec3
  target: Vec3
  zoomScale: number
}


export async function createFlowSimpleRenderer(canvas: HTMLCanvasElement, flow: FlowSimple) {

  const {
    beforeFrameRender,
    renderWithUniforms,
    createTexture,
  } = createPlaneShaderProgram(canvas, fragSrc)

  const { width, height } = flow

  const originalImage = await loadImageFromBlob(flow.originalImage)
  const originalDepthMap = await loadImageFromBlob(flow.originalDepthMap)
  const blurMipmap = await createBlurMipmap(getImageData(originalImage))

  const imageTexture = createTexture(originalImage)
  const depthMapTexture = createTexture(originalDepthMap)
  const blurMipmapTexture = createTexture(blurMipmap)

  const frameTimeCounter = createFrameTimeCounter()

  function render(args: FlowSimpleRendererArgs) {
    const start = performance.now()

    const cameraSize = beforeFrameRender()
    renderWithUniforms({
      camera_position: args.origin,
      camera_target_center: args.target,
      camera_zoom_scale: calculateZoomScale(canvas.width, canvas.height, width, height, args.zoomScale),
      image_size: [width, height],
      camera_size: cameraSize,
      image: imageTexture,
      depth_map: depthMapTexture,
      blur_mipmap: blurMipmapTexture,
      forward_steps: 120,
      backward_steps: 8,
      edge_blur_threshold: 0.05,
    })

    const end = performance.now()
    const duration = end - start
    frameTimeCounter.render(duration)
    return duration
  }


  return {
    type: "simple" as const,
    render,
    frameTimeCounter,
  }
}
