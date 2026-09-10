import type { FlowSimple } from "../types"
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
  edgeBlurThreshold?: number
  blurMipmapSize?: number
  blurMipmapRadius?: number
  pixelRatio?: number
  timer?: RendererTimerMode
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
} as const satisfies Record<string, Pick<FlowSimpleRendererOptions, "forwardSteps" | "backwardSteps">>

export type FlowSimpleRendererPreset = keyof typeof flowSimpleRendererPresets

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function clampInteger(value: number, min: number, max: number) {
  return Math.round(clamp(value, min, max))
}

export async function createFlowSimpleRenderer(
  canvas: HTMLCanvasElement,
  flow: FlowSimple,
  options?: FlowSimpleRendererOptions | FlowSimpleRendererPreset,
) {
  if (typeof options === "string" && !(options in flowSimpleRendererPresets))
    throw new Error(`Unknown renderer preset: ${options}`)

  const resolvedOptions: FlowSimpleRendererOptions | undefined = typeof options === "string"
    ? flowSimpleRendererPresets[options]
    : options

  const normalizedOptions = {
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

  const originalImage = await getImageDataFromBlob(flow.originalImage)
  const originalDepthMap = await getImageDataFromBlob(flow.originalDepthMap)
  const blurMipmap = await createBlurMipmap(
    originalImage,
    normalizedOptions.blurMipmapSize,
    normalizedOptions.blurMipmapRadius,
  )
  const depthBoundsHierarchy = createDepthBoundsHierarchy(originalDepthMap)

  const imageTexture = createTexture(originalImage)
  const depthMapTexture = createTexture(originalDepthMap)
  const blurMipmapTexture = createTexture(blurMipmap)
  const depthBoundsTexture = createDepthBoundsTexture(gl, depthBoundsHierarchy)
  let disposed = false

  function render(args: FlowSimpleRendererArgs) {
    if (disposed)
      throw new Error("Renderer has been disposed")

    beforeFrameRender(normalizedOptions.pixelRatio)
    renderWithUniforms({
      camera_position: args.origin,
      camera_target_center: args.target,
      camera_zoom_scale: calculateZoomScale(canvas.width, canvas.height, width, height, args.zoomScale),
      image_size: [width, height],
      // camera_size: cameraSize,
      image: imageTexture,
      depth_map: depthMapTexture,
      blur_mipmap: blurMipmapTexture,
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
    gl.deleteTexture(imageTexture)
    gl.deleteTexture(depthMapTexture)
    gl.deleteTexture(blurMipmapTexture)
    gl.deleteTexture(depthBoundsTexture)
    disposeProgram()
  }


  return {
    type: "simple" as const,
    render,
    timer,
    options: normalizedOptions,
    dispose,
  }
}
