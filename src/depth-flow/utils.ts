
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

