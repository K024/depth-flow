import type { FlowSlide } from "../types"
import { getImageDataFromBlob } from "../image/utils"
import {
  calculateZoomScale,
  createBlurMipmap,
  createPlaneShaderProgram,
  createRendererTimer,
  defaultRendererPixelRatio,
  type RendererTimer,
  type RendererTimerMode,
} from "./common"
import { createDepthBoundsHierarchy, createDepthBoundsTexture } from "./depth-bounds-hierarchy"
import { flowSimpleRendererPresets, type FlowSimpleRendererArgs } from "./simple"
import fragSrc from "./shaders/slide-frag.glsl?raw"


export type FlowSlideRendererArgs = FlowSimpleRendererArgs
export interface FlowSlideRendererOptions {
  forwardSteps?: number
  backwardSteps?: number
  edgeBlurThreshold?: number
  blurMipmapSize?: number
  blurMipmapRadius?: number
  pixelRatio?: number
  timer?: RendererTimerMode
}

export type FlowSlideRendererPreset = keyof typeof flowSlideRendererPresets
export const flowSlideRendererPresets = flowSimpleRendererPresets

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function clampInteger(value: number, min: number, max: number) {
  return Math.round(clamp(value, min, max))
}

export async function createFlowSlideRenderer(
  canvas: HTMLCanvasElement,
  flow: FlowSlide,
  options?: FlowSlideRendererOptions | FlowSlideRendererPreset,
) {
  if (typeof options === "string" && !(options in flowSlideRendererPresets))
    throw new Error(`Unknown renderer preset: ${options}`)

  const resolvedOptions: FlowSlideRendererOptions | undefined = typeof options === "string"
    ? flowSlideRendererPresets[options]
    : options
  const normalizedOptions = {
    forwardSteps: clampInteger(
      resolvedOptions?.forwardSteps ?? flowSlideRendererPresets.balanced.forwardSteps,
      16,
      256,
    ),
    backwardSteps: clampInteger(
      resolvedOptions?.backwardSteps ?? flowSlideRendererPresets.balanced.backwardSteps,
      1,
      16,
    ),
    edgeBlurThreshold: clamp(resolvedOptions?.edgeBlurThreshold ?? 0.05, 0, 0.25),
    blurMipmapSize: clampInteger(resolvedOptions?.blurMipmapSize ?? 200, 1, 4096),
    blurMipmapRadius: clamp(resolvedOptions?.blurMipmapRadius ?? 10, 0, 100),
    pixelRatio: clamp(resolvedOptions?.pixelRatio ?? defaultRendererPixelRatio(), 0.25, 4),
    timer: resolvedOptions?.timer ?? "noop",
  }

  const {
    gl,
    beforeFrameRender,
    renderWithUniforms,
    createTexture,
    dispose: disposeProgram,
  } = createPlaneShaderProgram(canvas, fragSrc)
  const internalTimer = createRendererTimer(normalizedOptions.timer, gl)
  const timer: RendererTimer = internalTimer.timer

  const { width, height } = flow
  const topImage = await getImageDataFromBlob(flow.originalImage)
  const bottomImage = await getImageDataFromBlob(flow.bottomImage)
  const layerMap = await getImageDataFromBlob(flow.layerMap)
  const topBlurMipmap = await createBlurMipmap(
    topImage,
    normalizedOptions.blurMipmapSize,
    normalizedOptions.blurMipmapRadius,
  )
  const bottomBlurMipmap = await createBlurMipmap(
    bottomImage,
    normalizedOptions.blurMipmapSize,
    normalizedOptions.blurMipmapRadius,
  )
  const depthBoundsHierarchy = createDepthBoundsHierarchy(layerMap, [0, 2])

  const topImageTexture = createTexture(topImage)
  const bottomImageTexture = createTexture(bottomImage)
  const layerMapTexture = createTexture(layerMap)
  const topBlurMipmapTexture = createTexture(topBlurMipmap)
  const bottomBlurMipmapTexture = createTexture(bottomBlurMipmap)
  const depthBoundsTexture = createDepthBoundsTexture(gl, depthBoundsHierarchy)
  let disposed = false

  function render(args: FlowSlideRendererArgs) {
    if (disposed)
      throw new Error("Renderer has been disposed")

    beforeFrameRender(normalizedOptions.pixelRatio)
    renderWithUniforms({
      camera_position: args.origin,
      camera_target_center: args.target,
      camera_zoom_scale: calculateZoomScale(canvas.width, canvas.height, width, height, args.zoomScale),
      image_size: [width, height],
      // camera_size: cameraSize,
      top_image: topImageTexture,
      bottom_image: bottomImageTexture,
      layer_map: layerMapTexture,
      top_blur_mipmap: topBlurMipmapTexture,
      bottom_blur_mipmap: bottomBlurMipmapTexture,
      depth_bounds: depthBoundsTexture,
      depth_bounds_max_lod: depthBoundsHierarchy.length - 1,
      forward_steps: normalizedOptions.forwardSteps,
      backward_steps: normalizedOptions.backwardSteps,
      edge_blur_threshold: normalizedOptions.edgeBlurThreshold,
    }, internalTimer)
  }

  function dispose() {
    if (disposed)
      return
    disposed = true
    internalTimer.dispose()
    gl.deleteTexture(topImageTexture)
    gl.deleteTexture(bottomImageTexture)
    gl.deleteTexture(layerMapTexture)
    gl.deleteTexture(topBlurMipmapTexture)
    gl.deleteTexture(bottomBlurMipmapTexture)
    gl.deleteTexture(depthBoundsTexture)
    disposeProgram()
  }

  return {
    type: "slide" as const,
    render,
    timer,
    options: normalizedOptions,
    dispose,
  }
}
