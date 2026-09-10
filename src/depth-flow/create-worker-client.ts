import { proxy, wrap } from "comlink"
import type { CreateWorkerApi } from "./create-worker"
import type { SimpleFlowArgs, SlideFlowArgs } from "./create-flow"
import type { ProgressReporter } from "./utils"

let workerApi: CreateWorkerApi | undefined
let creating = false

function getWorkerApi() {
  if (!workerApi) {
    const worker = new Worker(
      new URL("./create-worker.ts", import.meta.url),
      { type: "module", name: "depth-flow-create" },
    )
    workerApi = wrap<CreateWorkerApi>(worker)
  }
  return workerApi
}

export function createSimpleFlowInWorker(
  image: Blob,
  suppliedDepthMap?: Blob,
  args?: SimpleFlowArgs,
  progress?: ProgressReporter,
) {
  return runOne("Simple Flow", () => getWorkerApi().createSimpleFlow(
    image,
    suppliedDepthMap,
    args,
    progress && proxy(progress),
  ))
}

export function createSlideFlowInWorker(
  image: Blob,
  suppliedDepthMap: Blob | undefined,
  args: SlideFlowArgs,
  progress?: ProgressReporter,
) {
  return runOne("SLIDE Flow", () => getWorkerApi().createSlideFlow(
    image,
    suppliedDepthMap,
    args,
    progress && proxy(progress),
  ))
}

async function runOne<T>(name: string, create: () => Promise<T>) {
  if (creating)
    throw new Error("A flow creation task is already in progress")

  creating = true
  console.group(`${name} creation`)
  try {
    return await create()
  } finally {
    console.groupEnd()
    creating = false
  }
}
