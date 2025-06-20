
export type ProgressReporter = (step: string, /** 0 ~ 100 */ progress?: number) => void


export function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}


export function frame() {
  return new Promise(resolve => requestAnimationFrame(resolve))
}


export function never() {
  return new Promise(() => { })
}


export function lazy<T>(fn: () => T) {
  let created = false, value: T
  return () => {
    if (!created) {
      value = fn()
      created = true
    }
    return value
  }
}


export function lazyPromise<T>(fn: () => Promise<T>) {
  let created = false, value: Promise<T>
  return () => {
    if (!created) {
      value = fn()
      value.catch(() => {
        created = false
      })
      created = true
    }
    return value
  }
}


export function error(message: string): never {
  throw new Error(message)
}


export function selectFile(accept: string, multiple?: false): Promise<File>
export function selectFile(accept: string, multiple?: true): Promise<File[]>
export function selectFile(accept: string = "image/*", multiple: boolean = false) {
  return new Promise<File[] | File>((resolve) => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = accept
    input.multiple = multiple
    input.style.display = "none"
    input.onchange = (e) => {
      const files = (e.target as HTMLInputElement).files
      if (files && files.length > 0) {
        resolve(multiple ? Array.from(files) : files[0])
      }
    }
    document.body.appendChild(input)
    input.click()
    document.body.removeChild(input)
  })
}

export function downloadFile(blob: File | Blob | string, name?: string) {
  const url = typeof blob === "string" ? blob : URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name ?? (blob instanceof File ? blob.name : "download")
  a.style.display = "none"
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

