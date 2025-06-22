import * as twgl from "twgl.js"
import vertSrc from "./shaders/vert.glsl?raw"


export function createPlaneShaderProgram(canvas: HTMLCanvasElement, fragSrc: string) {

  const gl = twgl.getContext(canvas, {
    alpha: true,
    antialias: true,
  })

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

  function setUniforms(uniforms: Record<string, any>) {
    gl.useProgram(program.program)
    twgl.setUniforms(program, uniforms)
  }


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
    twgl.drawBufferInfo(gl, buffers)
  }


  function createTexture(src: TexImageSource) {
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
    setUniforms,
  }
}


export interface FrameCounter {
  render: (time: number) => void
  reset: () => void
  totalTime: number
  totalRenders: number
  averageTime: number
}

export function createFrameTimeCounter(): FrameCounter {
  let totalTime = 0
  let totalRenders = 0

  return {
    render: (time: number) => {
      totalTime += time
      totalRenders += 1
    },
    reset: () => {
      totalTime = 0
      totalRenders = 0
    },
    get totalTime() { return totalTime },
    get totalRenders() { return totalRenders },
    get averageTime() { return totalTime / totalRenders },
  }
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
