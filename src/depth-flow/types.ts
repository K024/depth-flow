

export interface FlowSimpleConfig {
  originalImage: string
  originalDepthMap: string
  width: number
  height: number

  processedBy: string
  processArgs: Record<string, any>
}

export type FlowConfig = FlowSimpleConfig


export interface FlowSimple {
  originalImage: Blob
  originalDepthMap: Blob
  width: number
  height: number

  processedBy: string
  processArgs: Record<string, any>
}

export type Flow = FlowSimple
