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
  const drawCallTimer = createGpuDrawCallTimer(gl)

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

  function beforeFrameRender() {
    twgl.resizeCanvasToDisplaySize(canvas, window.devicePixelRatio || 1)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clear(gl.COLOR_BUFFER_BIT)
    return [canvas.width, canvas.height] as const
  }


  function renderWithUniforms(uniforms: Record<string, any>) {
    gl.useProgram(program.program)
    twgl.setUniforms(program, uniforms)
    drawCallTimer.begin()
    twgl.drawBufferInfo(gl, buffers)
    drawCallTimer.end()
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


  return {
    gl,
    program,
    buffers,
    beforeFrameRender,
    renderWithUniforms,
    createTexture,
    drawCallTimer,
  }
}


export interface FrameCounter {
  poll: () => void
  reset: () => void
  supported: boolean
  totalTime: number
  totalRenders: number
  averageTime: number
  p95Time: number
  p99Time: number
}

interface DisjointTimerQueryWebGL2 {
  readonly TIME_ELAPSED_EXT: number
  readonly GPU_DISJOINT_EXT: number
}

interface PendingGpuQuery {
  query: WebGLQuery
  generation: number
}

export function createGpuDrawCallTimer(gl: WebGL2RenderingContext): FrameCounter & {
  begin: () => void
  end: () => void
} {
  const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2") as DisjointTimerQueryWebGL2 | null
  if (!ext)
    console.warn("EXT_disjoint_timer_query_webgl2 is unavailable; GPU draw-call timing is disabled")

  const maxPendingQueries = 64
  const pendingQueries: PendingGpuQuery[] = []
  let activeQuery: WebGLQuery | null = null
  let samples: number[] = []
  let totalTime = 0
  let generation = 0

  function discardPendingQueries() {
    if (activeQuery) {
      gl.endQuery(ext!.TIME_ELAPSED_EXT)
      gl.deleteQuery(activeQuery)
      activeQuery = null
    }
    for (const { query } of pendingQueries)
      gl.deleteQuery(query)
    pendingQueries.length = 0
  }

  function poll() {
    if (!ext)
      return

    if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
      discardPendingQueries()
      return
    }

    while (pendingQueries.length > 0) {
      const pending = pendingQueries[0]
      const available = gl.getQueryParameter(pending.query, gl.QUERY_RESULT_AVAILABLE) as boolean
      if (!available)
        break

      const elapsedNanoseconds = gl.getQueryParameter(pending.query, gl.QUERY_RESULT) as number
      gl.deleteQuery(pending.query)
      pendingQueries.shift()

      if (pending.generation !== generation)
        continue

      const elapsedMilliseconds = elapsedNanoseconds / 1_000_000
      samples.push(elapsedMilliseconds)
      totalTime += elapsedMilliseconds
    }
  }

  function percentile(percent: number) {
    if (samples.length === 0)
      return 0
    const sorted = [...samples].sort((a, b) => a - b)
    const index = Math.ceil(percent * sorted.length) - 1
    return sorted[Math.max(0, index)]
  }

  return {
    supported: ext !== null,
    begin: () => {
      poll()
      if (!ext || activeQuery || pendingQueries.length >= maxPendingQueries)
        return

      const query = gl.createQuery()
      if (!query)
        return

      gl.beginQuery(ext.TIME_ELAPSED_EXT, query)
      activeQuery = query
    },
    end: () => {
      if (!ext || !activeQuery)
        return

      gl.endQuery(ext.TIME_ELAPSED_EXT)
      pendingQueries.push({ query: activeQuery, generation })
      activeQuery = null
    },
    reset: () => {
      generation += 1
      samples = []
      totalTime = 0
    },
    poll,
    get totalTime() { return totalTime },
    get totalRenders() { return samples.length },
    get averageTime() { return samples.length > 0 ? totalTime / samples.length : 0 },
    get p95Time() { return percentile(0.95) },
    get p99Time() { return percentile(0.99) },
  }
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
