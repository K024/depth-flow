import * as twgl from "twgl.js"
import vertSrc from "./shaders/vert.glsl?raw"
import { gaussianBlurImageData, scaleImageData } from "../image/utils"


export function createPlaneShaderProgram(canvas: HTMLCanvasElement, fragSrc: string) {

  const context = canvas.getContext("webgl2", {
    alpha: true,
    antialias: true,
  })
  if (!context)
    throw new Error("WebGL2 is not supported")
  const gl: WebGL2RenderingContext = context

  const program = twgl.createProgramInfo(gl, [vertSrc, fragSrc])
  const plane = new Float32Array([
    -1, -1, -1, 1, 1, 1,
    -1, -1, 1, 1, 1, -1,
  ])
  const buffers = twgl.createBufferInfoFromArrays(gl, {
    a_position: {
      numComponents: 2,
      data: plane,
    },
  })

  gl.useProgram(program.program)
  twgl.setBuffersAndAttributes(gl, program, buffers)


  // functions

  function beforeFrameRender(pixelRatio: number) {
    twgl.resizeCanvasToDisplaySize(canvas, pixelRatio)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clear(gl.COLOR_BUFFER_BIT)
    return [canvas.width, canvas.height] as const
  }


  function renderWithUniforms(uniforms: Record<string, any>, timer: InternalRendererTimer) {
    gl.useProgram(program.program)
    twgl.setUniforms(program, uniforms)
    timer.begin()
    twgl.drawBufferInfo(gl, buffers)
    timer.end()
  }


  function createTexture(src: ImageData) {
    return twgl.createTexture(gl, {
      src,
      wrap: gl.CLAMP_TO_EDGE,
      flipY: gl.UNPACK_FLIP_Y_WEBGL,
      min: gl.LINEAR,
      mag: gl.LINEAR,
    })
  }

  function dispose() {
    const deletedBuffers = new Set<WebGLBuffer>()
    for (const attribute of Object.values(buffers.attribs ?? {})) {
      if (attribute.buffer && !deletedBuffers.has(attribute.buffer)) {
        gl.deleteBuffer(attribute.buffer)
        deletedBuffers.add(attribute.buffer)
      }
    }
    if (buffers.indices && !deletedBuffers.has(buffers.indices)) {
      gl.deleteBuffer(buffers.indices)
      deletedBuffers.add(buffers.indices)
    }
    gl.deleteProgram(program.program)
  }


  return {
    gl,
    program,
    buffers,
    beforeFrameRender,
    renderWithUniforms,
    createTexture,
    dispose,
  }
}


export type RendererTimerMode = "noop" | "performance" | "gl"

/**
 * Read-only statistics for the renderer's draw calls.
 *
 * `performance` timers measure CPU wall-clock time around the draw call.
 * `gl` timers measure GPU elapsed time when
 * EXT_disjoint_timer_query_webgl2 is available. `noop` records nothing.
 */
export interface RendererTimer {
  readonly kind: RendererTimerMode
  readonly supported: boolean
  poll: () => void
  reset: () => void
  readonly totalTime: number
  readonly sampleCount: number
  readonly averageTime: number
  readonly p95Time: number
  readonly p99Time: number
}

interface InternalRendererTimer {
  readonly timer: RendererTimer
  begin: () => void
  end: () => void
  dispose: () => void
}

interface DisjointTimerQueryWebGL2 {
  readonly TIME_ELAPSED_EXT: number
  readonly GPU_DISJOINT_EXT: number
}

function percentile(samples: readonly number[], percent: number) {
  if (samples.length === 0)
    return 0
  const sorted = [...samples].sort((a, b) => a - b)
  const index = Math.ceil(percent * sorted.length) - 1
  return sorted[Math.max(0, index)]
}

function createTimerStats(kind: RendererTimerMode, supported: boolean, samples: () => readonly number[], totalTime: () => number, poll: () => void, reset: () => void): RendererTimer {
  return {
    kind,
    supported,
    poll,
    reset,
    get totalTime() { return totalTime() },
    get sampleCount() { return samples().length },
    get averageTime() {
      const values = samples()
      return values.length > 0 ? totalTime() / values.length : 0
    },
    get p95Time() { return percentile(samples(), 0.95) },
    get p99Time() { return percentile(samples(), 0.99) },
  }
}

const maxTimerSamples = 240

function addSample(samples: number[], value: number) {
  samples.push(value)
  return samples.length > maxTimerSamples ? samples.shift() : undefined
}

function createNoopTimer(): InternalRendererTimer {
  const timer = createTimerStats("noop", false, () => [], () => 0, () => {}, () => {})
  return { timer, begin: () => {}, end: () => {}, dispose: () => {} }
}

function createPerformanceTimer(): InternalRendererTimer {
  const samples: number[] = []
  let totalTime = 0
  let startTime: number | undefined

  function reset() {
    samples.length = 0
    totalTime = 0
    startTime = undefined
  }

  const timer = createTimerStats("performance", true, () => samples, () => totalTime, () => {}, reset)
  return {
    timer,
    begin: () => {
      startTime = performance.now()
    },
    end: () => {
      if (startTime === undefined)
        return
      const elapsed = performance.now() - startTime
      startTime = undefined
      const evicted = addSample(samples, elapsed)
      totalTime += elapsed
      if (evicted !== undefined)
        totalTime -= evicted
    },
    dispose: reset,
  }
}

function createGlTimer(gl: WebGL2RenderingContext): InternalRendererTimer {
  const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2") as DisjointTimerQueryWebGL2 | null
  if (!ext)
    return createNoopTimer()
  const timerExtension = ext

  const maxPendingQueries = 64
  const pendingQueries: WebGLQuery[] = []
  let activeQuery: WebGLQuery | null = null
  const samples: number[] = []
  let totalTime = 0

  function discardPendingQueries() {
    if (activeQuery) {
      gl.endQuery(timerExtension.TIME_ELAPSED_EXT)
      gl.deleteQuery(activeQuery)
      activeQuery = null
    }
    for (const query of pendingQueries)
      gl.deleteQuery(query)
    pendingQueries.length = 0
  }

  function poll() {
    if (!ext)
      return

    if (gl.getParameter(timerExtension.GPU_DISJOINT_EXT)) {
      discardPendingQueries()
      return
    }

    while (pendingQueries.length > 0) {
      const query = pendingQueries[0]
      const available = gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE) as boolean
      if (!available)
        break

      const elapsedNanoseconds = gl.getQueryParameter(query, gl.QUERY_RESULT) as number
      gl.deleteQuery(query)
      pendingQueries.shift()

      const elapsedMilliseconds = elapsedNanoseconds / 1_000_000
      const evicted = addSample(samples, elapsedMilliseconds)
      totalTime += elapsedMilliseconds
      if (evicted !== undefined)
        totalTime -= evicted
    }
  }

  function reset() {
    discardPendingQueries()
    samples.length = 0
    totalTime = 0
  }

  const timer = createTimerStats("gl", true, () => samples, () => totalTime, poll, reset)
  return {
    timer,
    begin: () => {
      poll()
      if (activeQuery || pendingQueries.length >= maxPendingQueries)
        return

      const query = gl.createQuery()
      if (!query)
        return

      gl.beginQuery(timerExtension.TIME_ELAPSED_EXT, query)
      activeQuery = query
    },
    end: () => {
      if (!activeQuery)
        return

      gl.endQuery(timerExtension.TIME_ELAPSED_EXT)
      pendingQueries.push(activeQuery)
      activeQuery = null
    },
    dispose: reset,
  }
}

export function createRendererTimer(mode: RendererTimerMode, gl: WebGL2RenderingContext): InternalRendererTimer {
  switch (mode) {
    case "performance":
      return createPerformanceTimer()
    case "gl":
      return createGlTimer(gl)
    case "noop":
      return createNoopTimer()
  }
}

export function defaultRendererPixelRatio() {
  return typeof window === "undefined" ? 1 : window.devicePixelRatio || 1
}

export async function createBlurMipmap(image: ImageData, size = 200, blurRadius = 10) {
  const resized = await scaleImageData(image, size, size)
  const blurred = await gaussianBlurImageData(resized, blurRadius)
  return blurred
}


export function calculateZoomScale(cameraWidth: number, cameraHeight: number, imageWidth: number, imageHeight: number, boundary = 0.8): [number, number] {
  const cameraRatio = cameraWidth / cameraHeight
  const imageRatio = imageWidth / imageHeight
  const ratio = cameraRatio / imageRatio

  if (ratio > 1) {
    const width = 1
    const height = width / ratio
    return [width * boundary, height * boundary]
  } else {
    const height = 1
    const width = height * ratio
    return [width * boundary, height * boundary]
  }
}
