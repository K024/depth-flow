import type { FlowMultilayer } from "../types"
import { getImageData, loadImageFromBlob } from "../image/utils"
import { calculateZoomScale, createBlurMipmap, createFrameTimeCounter, createPlaneShaderProgram } from "./common"
import fragSrc from "./shaders/multilayer-frag.glsl?raw"


export type Vec2 = [number, number]
export type Vec3 = [number, number, number]

export interface FlowMultilayerRendererArgs {
  origin: Vec3
  target: Vec3
  zoomScale: number
}


export async function createFlowMultilayerRenderer(canvas: HTMLCanvasElement, flow: FlowMultilayer) {

  const {
    beforeFrameRender,
    renderWithUniforms,
    createTexture,
  } = createPlaneShaderProgram(canvas, fragSrc)

  const { width, height } = flow

  const layers: { layer: WebGLTexture, depth_map: WebGLTexture }[] = []

  for (const layer of flow.layers) {
    const image = await loadImageFromBlob(layer.image)
    const depthMap = await loadImageFromBlob(layer.depthMap)
    layers.push({
      layer: createTexture(image),
      depth_map: createTexture(depthMap)
    })
  }

  const originalImage = await loadImageFromBlob(flow.originalImage)
  const blurMipmap = await createBlurMipmap(getImageData(originalImage))
  const blurMipmapTexture = createTexture(blurMipmap)

  const frameTimeCounter = createFrameTimeCounter()

  function render(args: FlowMultilayerRendererArgs) {
    const start = performance.now()

    const cameraSize = beforeFrameRender()
    renderWithUniforms({
      camera_position: args.origin,
      camera_target_center: args.target,
      camera_zoom_scale: calculateZoomScale(canvas.width, canvas.height, width, height, args.zoomScale),
      image_size: [width, height],
      camera_size: cameraSize,
      num_layers: layers.length,
      layers: layers.map(x => x.layer),
      depth_maps: layers.map(x => x.depth_map),
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
    type: "multilayer" as const,
    render,
    frameTimeCounter,
  }
}
