import { zip, unzip, type Unzipped, type AsyncZippable } from "fflate"
import type { Flow, FlowConfig, FlowSimpleConfig, FlowSlideConfig } from "./types"


const configFileName = "depth-flow.json"


export async function loadFlowZip(zipFile: Blob): Promise<Flow> {

  const blobs = await unzipBlob(zipFile)

  if (!blobs[configFileName])
    throw new Error(`${configFileName} not found in zip file`)

  const parsedConfig = JSON.parse(await blobs[configFileName].text()) as Record<string, unknown>
  if ("layers" in parsedConfig)
    throw new Error("Legacy multilayer flow is no longer supported")

  if (parsedConfig.type === "slide" && parsedConfig.version !== 1)
    throw new Error(`Unsupported SLIDE flow version: ${String(parsedConfig.version)}`)

  const config = parsedConfig as unknown as FlowConfig
  if (config.type === "slide") {
    return {
      type: "slide",
      version: 1,
      originalImage: ensureBlob(blobs, config.originalImage),
      originalDepthMap: ensureBlob(blobs, config.originalDepthMap),
      bottomImage: ensureBlob(blobs, config.bottomImage),
      layerMap: ensureBlob(blobs, config.layerMap),
      width: config.width,
      height: config.height,
      processedBy: config.processedBy,
      processArgs: config.processArgs,
    }
  }

  return {
    type: "simple",
    version: 1,
    originalImage: ensureBlob(blobs, config.originalImage),
    originalDepthMap: ensureBlob(blobs, config.originalDepthMap),
    width: config.width,
    height: config.height,

    processedBy: config.processedBy,
    processArgs: config.processArgs,
  }
}


export async function saveFlowZip(flow: Flow): Promise<File> {
  if (flow.type === "slide") {
    const config: FlowSlideConfig = {
      type: "slide",
      version: 1,
      originalImage: `image.${getBlobNameExtension(flow.originalImage, "png")}`,
      // SLIDE's packed layer map is also a valid single-layer depth map because
      // its R channel stores Top depth. Both fields intentionally reference the
      // same archive entry to avoid shipping a redundant depth-map.png.
      originalDepthMap: "layer-map.png",
      bottomImage: "bottom-image.png",
      layerMap: "layer-map.png",
      width: flow.width,
      height: flow.height,
      processedBy: flow.processedBy,
      processArgs: flow.processArgs,
    }
    const configBlob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" })
    const filesToZip: Record<string, Blob> = {
      [config.originalImage]: flow.originalImage,
      [config.bottomImage]: flow.bottomImage,
      [config.layerMap]: flow.layerMap,
      [configFileName]: configBlob,
    }
    return zipBlobs(filesToZip, "slide-flow.zip")
  }

  const config: FlowSimpleConfig = {
    type: "simple",
    version: 1,
    originalImage: `image.${getBlobNameExtension(flow.originalImage, "png")}`,
    originalDepthMap: `depth-map.png`,
    width: flow.width,
    height: flow.height,

    processedBy: flow.processedBy,
    processArgs: flow.processArgs,
  }

  const configBlob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" })

  const filesToZip: Record<string, Blob> = {
    [config.originalImage]: flow.originalImage,
    [config.originalDepthMap]: flow.originalDepthMap,
    [configFileName]: configBlob,
  }

  return zipBlobs(filesToZip, "depth-flow.zip")
}


// utils

function ensureBlob(blobs: Record<string, Blob>, key: string) {
  if (!blobs[key])
    throw new Error(`${key} not found in zip file`)
  return blobs[key]
}

function getBlobNameExtension(blob: Blob, fallback: string) {
  if (blob instanceof File) {
    const ext = blob.name.split(".").pop()!.toLowerCase()
    if (["png", "jpg", "jpeg"].includes(ext))
      return ext
  }

  return fallback
}

async function zipBlobs(blobs: Record<string, Blob>, fileName: string): Promise<File> {
  const zipEntries: AsyncZippable = {}

  for (const [key, value] of Object.entries(blobs)) {
    zipEntries[key] = new Uint8Array(await value.arrayBuffer())
  }

  const zipData = await new Promise<Uint8Array<ArrayBuffer>>((res, rej) => {
    zip(zipEntries, (err, data) => {
      if (err) rej(err)
      else res(data)
    })
  })

  return new File([zipData], fileName)
}

async function unzipBlob(blob: Blob) {
  const arrayBuffer = await blob.arrayBuffer()

  const zipEntries = await new Promise<Unzipped>((res, rej) => {
    unzip(new Uint8Array(arrayBuffer), (err, data) => {
      if (err) rej(err)
      else res(data)
    })
  })

  const blobs: Record<string, Blob> = {}

  for (const [key, value] of Object.entries(zipEntries)) {
    blobs[key] = new Blob([value as Uint8Array<ArrayBuffer>])
  }

  return blobs
}
