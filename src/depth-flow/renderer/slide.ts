import type { FlowSlide } from "../types"
import { getImageDataFromBlob } from "../image/utils"
import { calculateZoomScale, createBlurMipmap, createPlaneShaderProgram } from "./common"
import { createDepthBoundsHierarchy, createDepthBoundsTexture } from "./depth-bounds-hierarchy"
import {
  flowSimpleRendererPresets,
  type FlowSimpleRendererArgs,
  type FlowSimpleRendererOptions,
  type FlowSimpleRendererPreset,
} from "./simple"
import fragSrc from "./shaders/slide-frag.glsl?raw"


export type FlowSlideRendererArgs = FlowSimpleRendererArgs
export type FlowSlideRendererOptions = FlowSimpleRendererOptions
export type FlowSlideRendererPreset = FlowSimpleRendererPreset
export const flowSlideRendererPresets = flowSimpleRendererPresets

function clampInteger(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)))
}

export async function createFlowSlideRenderer(
  canvas: HTMLCanvasElement,
  flow: FlowSlide,
  options?: FlowSlideRendererOptions | FlowSlideRendererPreset,
) {
  if (typeof options === "string" && !(options in flowSlideRendererPresets))
    throw new Error(`Unknown renderer preset: ${options}`)

  const resolvedOptions = typeof options === "string"
    ? flowSlideRendererPresets[options]
    : options
  const normalizedOptions: Required<FlowSlideRendererOptions> = {
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
  }

  const {
    gl,
    beforeFrameRender,
    renderWithUniforms,
    createTexture,
    drawCallTimer,
  } = createPlaneShaderProgram(canvas, fragSrc)

  const { width, height } = flow
  const topImage = await getImageDataFromBlob(flow.originalImage)
  const bottomImage = await getImageDataFromBlob(flow.bottomImage)
  const layerMap = await getImageDataFromBlob(flow.layerMap)
  const topBlurMipmap = await createBlurMipmap(topImage)
  const bottomBlurMipmap = await createBlurMipmap(bottomImage)
  const depthBoundsHierarchy = createDepthBoundsHierarchy(layerMap, [0, 2])

  const topImageTexture = createTexture(topImage)
  const bottomImageTexture = createTexture(bottomImage)
  const layerMapTexture = createTexture(layerMap)
  const topBlurMipmapTexture = createTexture(topBlurMipmap)
  const bottomBlurMipmapTexture = createTexture(bottomBlurMipmap)
  const depthBoundsTexture = createDepthBoundsTexture(gl, depthBoundsHierarchy)

  function render(args: FlowSlideRendererArgs) {
    const _cameraSize = beforeFrameRender()
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
      edge_blur_threshold: 0.05,
    })
  }

  return {
    type: "slide" as const,
    render,
    frameTimeCounter: drawCallTimer,
    options: normalizedOptions,
  }
}
