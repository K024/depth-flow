import { zip, unzip, type Unzipped, type AsyncZippable } from "fflate"
import type { Flow, FlowConfig, FlowMultilayer, FlowSimple } from "./types"


const configFileName = "depth-flow.json"


export async function loadFlowZip(zipFile: Blob): Promise<Flow> {

  const blobs = await unzipBlob(zipFile)

  if (!blobs[configFileName])
    throw new Error(`${configFileName} not found in zip file`)

  const config = JSON.parse(await blobs[configFileName].text()) as FlowConfig

  if ("layers" in config) {

    const flow: FlowMultilayer = {
      originalImage: ensureBlob(blobs, config.originalImage),
      originalDepthMap: ensureBlob(blobs, config.originalDepthMap),
      width: config.width,
      height: config.height,

      inpaintLayers: config.inpaintLayers,
      inpaintDivisionPoints: config.inpaintBreakpoints,

      layers: config.layers.map(layer => ({
        image: ensureBlob(blobs, layer.image),
        depthMap: ensureBlob(blobs, layer.depthMap),
      })),

      processedBy: config.processedBy,
      processArgs: config.processArgs,
    }

    return flow

  } else {

    const flow: FlowSimple = {
      originalImage: ensureBlob(blobs, config.originalImage),
      originalDepthMap: ensureBlob(blobs, config.originalDepthMap),
      width: config.width,
      height: config.height,

      processedBy: config.processedBy,
      processArgs: config.processArgs,
    }

    return flow
  }
}


export async function saveFlowZip(flow: Flow): Promise<File> {

  let config: FlowConfig

  if ("layers" in flow) {
    config = {
      originalImage: `image.${getBlobNameExtension(flow.originalImage, "png")}`,
      originalDepthMap: `depth-map.png`,
      width: flow.width,
      height: flow.height,

      inpaintLayers: flow.inpaintLayers,
      inpaintBreakpoints: flow.inpaintDivisionPoints,

      layers: flow.layers.map((layer, index) => ({
        image: `layer-${index + 1}.png`,
        depthMap: `layer-${index + 1}-depth-map.png`,
      })),

      processedBy: flow.processedBy,
      processArgs: flow.processArgs,
    }
  } else {
    config = {
      originalImage: `image.${getBlobNameExtension(flow.originalImage, "png")}`,
      originalDepthMap: `depth-map.png`,
      width: flow.width,
      height: flow.height,

      processedBy: flow.processedBy,
      processArgs: flow.processArgs,
    }
  }

  const configBlob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" })

  const filesToZip: Record<string, Blob> = {
    [config.originalImage]: flow.originalImage,
    [config.originalDepthMap]: flow.originalDepthMap,
    [configFileName]: configBlob,
  }

  if ("layers" in config && "layers" in flow) {
    for (const [index, layer] of config.layers.entries()) {
      filesToZip[layer.image] = flow.layers[index].image
      filesToZip[layer.depthMap] = flow.layers[index].depthMap
    }
  }

  return zipBlobs(filesToZip)
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

async function zipBlobs(blobs: Record<string, Blob>): Promise<File> {
  const zipEntries: AsyncZippable = {}

  for (const [key, value] of Object.entries(blobs)) {
    zipEntries[key] = new Uint8Array(await value.arrayBuffer())
  }

  const zipData = await new Promise<Uint8Array>((res, rej) => {
    zip(zipEntries, (err, data) => {
      if (err) rej(err)
      else res(data)
    })
  })

  return new File([zipData], "depth-flow.zip")
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
    blobs[key] = new Blob([value])
  }

  return blobs
}
