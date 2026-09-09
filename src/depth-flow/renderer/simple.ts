import type { FlowSimple } from "../types"
import { getImageData, loadImageFromBlob } from "../image/utils"
import { calculateZoomScale, createBlurMipmap, createPlaneShaderProgram } from "./common"
import { createDepthBoundsHierarchy, createDepthBoundsTexture } from "./depth-bounds-hierarchy"
import fragSrc from "./shaders/simple-frag.glsl?raw"


export type Vec2 = [number, number]
export type Vec3 = [number, number, number]

export interface FlowSimpleRendererArgs {
  origin: Vec3
  target: Vec3
  zoomScale: number
}

export interface FlowSimpleRendererOptions {
  forwardSteps?: number
  backwardSteps?: number
}

export const flowSimpleRendererPresets = {
  performance: {
    forwardSteps: 64,
    backwardSteps: 4,
  },
  balanced: {
    forwardSteps: 120,
    backwardSteps: 8,
  },
  quality: {
    forwardSteps: 180,
    backwardSteps: 12,
  },
} as const satisfies Record<string, Required<FlowSimpleRendererOptions>>

export type FlowSimpleRendererPreset = keyof typeof flowSimpleRendererPresets

function clampInteger(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)))
}

export async function createFlowSimpleRenderer(
  canvas: HTMLCanvasElement,
  flow: FlowSimple,
  options?: FlowSimpleRendererOptions | FlowSimpleRendererPreset,
) {
  if (typeof options === "string" && !(options in flowSimpleRendererPresets))
    throw new Error(`Unknown renderer preset: ${options}`)

  const resolvedOptions = typeof options === "string"
    ? flowSimpleRendererPresets[options]
    : options

  const normalizedOptions: Required<FlowSimpleRendererOptions> = {
    forwardSteps: clampInteger(
      resolvedOptions?.forwardSteps ?? flowSimpleRendererPresets.balanced.forwardSteps,
      16,
      256,
    ),
    backwardSteps: clampInteger(
      resolvedOptions?.backwardSteps ?? flowSimpleRendererPresets.balanced.backwardSteps,
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

  const originalImage = await loadImageFromBlob(flow.originalImage)
  const originalDepthMap = await loadImageFromBlob(flow.originalDepthMap)
  const originalDepthMapData = getImageData(originalDepthMap)
  const blurMipmap = await createBlurMipmap(getImageData(originalImage))
  const depthBoundsHierarchy = createDepthBoundsHierarchy(originalDepthMapData)

  const imageTexture = createTexture(originalImage)
  const depthMapTexture = createTexture(originalDepthMap)
  const blurMipmapTexture = createTexture(blurMipmap)
  const depthBoundsTexture = createDepthBoundsTexture(gl, depthBoundsHierarchy)

  function render(args: FlowSimpleRendererArgs) {
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
      depth_bounds: depthBoundsTexture,
      depth_bounds_max_lod: depthBoundsHierarchy.length - 1,
      forward_steps: normalizedOptions.forwardSteps,
      backward_steps: normalizedOptions.backwardSteps,
      edge_blur_threshold: 0.05,
    })
  }


  return {
    type: "simple" as const,
    render,
    frameTimeCounter: drawCallTimer,
    options: normalizedOptions,
  }
}
