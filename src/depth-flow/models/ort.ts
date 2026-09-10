import * as ort from "onnxruntime-web/wasm"
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url"
import wasmJsUrl from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url"

ort.env.wasm.wasmPaths = {
  wasm: wasmUrl,
  mjs: wasmJsUrl,
}

export { ort }
