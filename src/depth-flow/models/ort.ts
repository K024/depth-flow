import * as ort from "onnxruntime-web/webgpu"
import wasmUrl from "../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url"
import wasmJsUrl from "../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs?url"

ort.env.wasm.wasmPaths = {
  wasm: wasmUrl,
  mjs: wasmJsUrl,
}

export { ort }
