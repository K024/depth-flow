import { openDB, type DBSchema } from "idb"
import { lazy } from "./utils"


const dbName = "depth-flow-web"

const storeName = "file-cache"


type ProgressCallback = (progress: number) => void

export async function downloadWithProgress(url: string, callback?: ProgressCallback) {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`)
  }

  const contentLength = response.headers.get('content-length')
  const total = contentLength ? parseInt(contentLength) : 0
  let loaded = 0

  const reader = response.body!.getReader()
  const chunks: Uint8Array[] = []

  while (true) {
    const { done, value } = await reader.read()

    if (done) break

    chunks.push(value)
    loaded += value.length

    if (callback && total) {
      callback(loaded / total)
    }
  }

  const blob = new Blob(chunks)

  return blob
}



interface ModelCache {
  url: string
  size: number
  blob: Blob
}

interface CacheDbSchema extends DBSchema {
  [storeName]: {
    key: string
    value: ModelCache
  }
}


const getDb = lazy(() => openDB<CacheDbSchema>(dbName))


export async function listAllKeys() {
  const db = await getDb()
  const keys = await db.getAllKeys(storeName)
  return keys
}


export async function getCachedFile(url: string) {
  const db = await getDb()
  const cache = await db.get(storeName, url)
  if (!cache) return null
  return cache.blob
}


export async function saveCachedFile(url: string, blob: Blob) {
  const db = await getDb()
  await db.put(storeName, {
    url,
    size: blob.size,
    blob
  })
}


export async function clearCache(keys?: string[]) {
  const db = await getDb()
  if (keys) {
    for (const key of keys) {
      await db.delete(storeName, key)
    }
  } else {
    await db.clear(storeName)
  }
}
