import { useCallback, useEffect, useRef, useState } from "react"


export function useEventCallback<T extends (...args: any[]) => any>(callback: T): T {
  const cbRef = useRef<T>(callback)
  cbRef.current = callback
  return useCallback((...args: Parameters<T>) => cbRef.current(...args), []) as T
}


export function useLatestValue<T>(value: T, enabled = true) {
  const ref = useRef(value)
  if (enabled)
    ref.current = value
  return ref
}


export function useAsyncState<T, TArgs extends any[] = any[]>(
  fetcher: (...args: TArgs) => Promise<T>,
  deps?: TArgs
) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(false)

  const id = useRef(0)

  const run = useEventCallback(async (...args: TArgs) => {
    setError(null)
    setLoading(true)
    const _id = ++id.current
    try {
      const result = await fetcher(...args)
      if (_id === id.current)
        setData(result)
      return result
    } catch (e) {
      if (_id === id.current)
        setError(e as Error)
      throw e
    } finally {
      if (_id === id.current)
        setLoading(false)
    }
  })

  const reset = useEventCallback(() => {
    setData(null)
    setError(null)
    setLoading(false)
    ++id.current
  })

  useEffect(() => {
    if (deps !== undefined) {
      run(...deps).catch(() => { })
    }
  }, deps || [])

  return { data, loading, error, run, reset }
}


export function humanSize(size: number, precision = 2) {
  const units = ["B", "KB", "MB", "GB"]
  const index = Math.floor(Math.log(size) / Math.log(1024))
  return (size / Math.pow(1024, index)).toFixed(precision) + " " + units[index]
}
