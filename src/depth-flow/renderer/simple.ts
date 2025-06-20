import type { FlowSimple } from "../types"
import { dilateImageData, getImageData, loadImageFromBlob } from "../image/utils"
import { calculateZoomScale, createFrameTimeCounter, createPlaneShaderProgram } from "./common"
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
    createTexture
  } = createPlaneShaderProgram(canvas, fragSrc)

  const { width, height } = flow

  const originalImage = await loadImageFromBlob(flow.originalImage)
  const originalDepthMap = await loadImageFromBlob(flow.originalDepthMap)

  const originalDepthMapData = getImageData(originalDepthMap)

  let depthMapDilateRadius = 4

  let imageTexture = createTexture(originalImage)
  let depthMapTexture = createTexture(await dilateImageData(originalDepthMapData, depthMapDilateRadius))


  const frameTimeCounter = createFrameTimeCounter()

  function render(args: FlowSimpleRendererArgs) {
    const start = performance.now()

    beforeFrameRender()
    renderWithUniforms({
      camera_position: args.origin,
      camera_target_center: args.target,
      camera_zoom_scale: calculateZoomScale(canvas.width, canvas.height, width, height, args.zoomScale),
      image_size: [width, height],
      image: imageTexture,
      depth_map: depthMapTexture,
      forward_steps: 200,
      backward_steps: 20,
    })

    const end = performance.now()
    const duration = end - start
    frameTimeCounter.render(duration)
    return duration
  }


  async function updateDepthMapDilate(dilateRadius: number) {
    depthMapDilateRadius = dilateRadius
    const dilatedDepthMap = await dilateImageData(originalDepthMapData, dilateRadius)
    depthMapTexture = createTexture(dilatedDepthMap)
  }


  return {
    render,
    getDepthMapDilateRadius: () => depthMapDilateRadius,
    updateDepthMapDilate,
    frameTimeCounter,
  }
}
