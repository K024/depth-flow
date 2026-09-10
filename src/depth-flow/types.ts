

export interface FlowBaseConfig {
  originalImage: string
  originalDepthMap: string
  width: number
  height: number

  processedBy: string
  processArgs: Record<string, any>
}

export interface FlowSimpleConfig extends FlowBaseConfig {
  type?: "simple"
  version?: 1
}

export interface FlowSlideConfig extends FlowBaseConfig {
  type: "slide"
  version: 1
  bottomImage: string
  layerMap: string
}

export type FlowConfig = FlowSimpleConfig | FlowSlideConfig


export interface FlowBase {
  originalImage: Blob
  originalDepthMap: Blob
  width: number
  height: number

  processedBy: string
  processArgs: Record<string, any>
}

export interface FlowSimple extends FlowBase {
  type: "simple"
  version: 1
}

export interface FlowSlide extends FlowBase {
  type: "slide"
  version: 1
  bottomImage: Blob
  /**
   * RGB packed data:
   * R = top depth/disparity
   * G = top visibility
   * B = bottom depth/disparity
   * A = 255
   *
   * The serialized SLIDE config points both layerMap and originalDepthMap to
   * this image. Its R channel is directly usable by the Simple shader.
   */
  layerMap: Blob
}

export type Flow = FlowSimple | FlowSlide
