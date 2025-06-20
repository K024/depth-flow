import { effect, signal } from "@preact/signals-react"
import { useCallback, useRef } from "react"


export function useEventCallback<T extends (...args: any[]) => any>(callback: T): T {
  const cbRef = useRef<T>(callback)
  cbRef.current = callback
  return useCallback((...args: Parameters<T>) => cbRef.current(...args), []) as T
}


export function asyncState<T, TArgs extends any[] = any[]>(
  fetcher: (...args: TArgs) => Promise<T>,
  defaultArgs?: TArgs
) {
  const data = signal<T>()
  const error = signal<Error>()
  const loading = signal(false)

  let id = 0

  async function fetch(...args: TArgs) {
    error.value = undefined
    loading.value = true
    const _id = ++id
    try {
      const result = await fetcher(...args)
      if (_id === id)
        data.value = result
      return result
    } catch (err) {
      if (_id === id)
        error.value = err as Error
      throw err
    } finally {
      if (_id === id)
        loading.value = false
    }
  }

  const reset = () => {
    data.value = undefined
    error.value = undefined
    loading.value = false
    ++id
  }

  if (defaultArgs !== undefined) {
    effect(() => {
      fetch(...defaultArgs).catch(() => { })
    })
  }

  return {
    data,
    error,
    loading,
    fetch,
    reset,
  }
}


export function humanSize(size: number, precision = 2) {
  const units = ["B", "KB", "MB", "GB"]
  const index = Math.floor(Math.log(size) / Math.log(1024))
  return (size / Math.pow(1024, index)).toFixed(precision) + " " + units[index]
}
