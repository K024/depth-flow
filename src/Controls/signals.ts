import { Signal } from "@preact/signals-react"
import type { ReadonlySignal } from "@preact/signals-react"
import { useSyncExternalStore } from "react"


declare module "@preact/signals-core" {
  interface Signal<T> {
    useValue(): T
  }

  interface ReadonlySignal<T> {
    useValue(): T
  }
}

type SignalWithValue<T> = Signal<T> | ReadonlySignal<T>

Object.defineProperty(Signal.prototype, "useValue", {
  value: function <T>(this: SignalWithValue<T>) {
    return useSyncExternalStore(
      onChange => this.subscribe(() => onChange()),
      () => this.peek(),
      () => this.peek(),
    )
  },
  writable: true,
  enumerable: false,
  configurable: true,
})
