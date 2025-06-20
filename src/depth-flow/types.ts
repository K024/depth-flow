

export interface FlowSimpleConfig {
  originalImage: string
  originalDepthMap: string
  width: number
  height: number
}


export interface FlowMultilayerConfig {
  originalImage: string
  originalDepthMap: string
  width: number
  height: number

  inpaintLayers: number
  inpaintBreakpoints: number[]

  layers: {
    image: string
    depthMap: string
    depth: number
  }[]
}

export type FlowConfig = FlowSimpleConfig | FlowMultilayerConfig


export interface FlowSimple {
  originalImage: Blob
  originalDepthMap: Blob
  width: number
  height: number
}


export interface FlowMultilayer {
  originalImage: Blob
  originalDepthMap: Blob
  width: number
  height: number

  inpaintLayers: number
  inpaintBreakpoints: number[]

  layers: {
    image: Blob
    depthMap: Blob
    depth: number
  }[]
}

export type Flow = FlowSimple | FlowMultilayer

