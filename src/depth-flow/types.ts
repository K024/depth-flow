

export interface FlowSimpleConfig {
  originalImage: string
  originalDepthMap: string
  width: number
  height: number

  processedBy: string
  processArgs: Record<string, any>
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
  }[]

  processedBy: string
  processArgs: Record<string, any>
}

export type FlowConfig = FlowSimpleConfig | FlowMultilayerConfig


export interface FlowSimple {
  originalImage: Blob
  originalDepthMap: Blob
  width: number
  height: number

  processedBy: string
  processArgs: Record<string, any>
}


export interface FlowMultilayer {
  originalImage: Blob
  originalDepthMap: Blob
  width: number
  height: number

  inpaintLayers: number
  inpaintDivisionPoints: number[]

  layers: {
    image: Blob
    depthMap: Blob
  }[]

  processedBy: string
  processArgs: Record<string, any>
}

export type Flow = FlowSimple | FlowMultilayer

