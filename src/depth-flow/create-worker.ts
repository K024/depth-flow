import { expose } from "comlink"
import {
  createSimpleFlow,
  createSlideFlow,
  type SimpleFlowArgs,
  type SlideFlowArgs,
} from "./create-flow"
import type { ProgressReporter } from "./utils"

export interface CreateWorkerApi {
  createSimpleFlow(
    image: Blob,
    suppliedDepthMap?: Blob,
    args?: SimpleFlowArgs,
    progress?: ProgressReporter,
  ): Promise<Blob>
  createSlideFlow(
    image: Blob,
    suppliedDepthMap: Blob | undefined,
    args: SlideFlowArgs,
    progress?: ProgressReporter,
  ): Promise<Blob>
}

let creating = false

async function runOne<T>(create: () => Promise<T>) {
  if (creating)
    throw new Error("A flow creation task is already in progress")

  creating = true
  try {
    return await create()
  } finally {
    creating = false
  }
}

const api: CreateWorkerApi = {
  createSimpleFlow(image, suppliedDepthMap, args, progress) {
    return runOne(() => createSimpleFlow(image, suppliedDepthMap, args, progress))
  },
  createSlideFlow(image, suppliedDepthMap, args, progress) {
    return runOne(() => createSlideFlow(image, suppliedDepthMap, args, progress))
  },
}

expose(api)
