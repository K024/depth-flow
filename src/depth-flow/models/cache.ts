import type { ProgressReporter } from "../utils"
import { listAllKeys, downloadWithProgress, saveCachedFile, clearCache } from "../file-cache"
import { humanSize } from "../../Controls/utils"


export const depthModelUrl = `https://huggingface.co/onnx-community/depth-anything-v2-base/resolve/d13a228/onnx/model_fp16.onnx?download=true`

export const inpaintModelUrl = `https://huggingface.co/Carve/LaMa-ONNX/resolve/c3c0c9e/lama_fp32.onnx?download=true`


const allModels = [
  depthModelUrl,
  inpaintModelUrl,
]


export async function checkAllModelsCached() {
  const keys = await listAllKeys()
  return allModels.every(url => keys.includes(url))
}

export async function clearModelCache() {
  return clearCache(allModels)
}


function getModelFileName(url: string) {
  const urlObj = new URL(url)
  const pathname = urlObj.pathname
  const fileName = pathname.split("/").pop()!
  return fileName
}


let anyDownloading = false

export async function downloadAllModels(progress?: ProgressReporter) {
  if (anyDownloading) {
    throw new Error("Downloading models is already in progress")
  }
  anyDownloading = true

  try {
    const cachedKeys = await listAllKeys()
    const missingModels = allModels.filter(url => !cachedKeys.includes(url))

    for (const [index, url] of missingModels.entries()) {
      const fileName = getModelFileName(url)

      progress?.(`Downloading ${fileName} (${index + 1}/${missingModels.length})`)

      const blob = await downloadWithProgress(url, p => {
        progress?.(`Downloading ${fileName} ${humanSize(p.loaded)}/${humanSize(p.total)} (${index + 1}/${missingModels.length})`, p.percent)
      })

      progress?.(`Saving ${fileName} to indexedDB...`)

      await saveCachedFile(url, blob)
    }

    progress?.(`Downloading models completed`)

  } finally {
    anyDownloading = false
  }
}
