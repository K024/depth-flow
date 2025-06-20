import type { ProgressReporter } from "../utils"
import { listAllKeys, downloadWithProgress, saveCachedFile } from "../file-cache"
import { depthModelUrl } from "./depth"
import { inpaintModelUrl } from "./inpaint"


const allModels = [
  depthModelUrl,
  inpaintModelUrl,
]


export async function checkAllModelsCached() {
  const keys = await listAllKeys()
  return allModels.every(url => keys.includes(url))
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

    for (const url of missingModels) {
      const fileName = getModelFileName(url)

      progress?.(`Downloading ${fileName}...`)

      const blob = await downloadWithProgress(url, p => {
        progress?.(`Downloading ${fileName}...`, p * 100)
      })

      progress?.(`Saving ${fileName} to indexedDB...`)

      await saveCachedFile(url, blob)
    }

    progress?.(`Downloading models completed`)

  } finally {
    anyDownloading = false
  }
}
