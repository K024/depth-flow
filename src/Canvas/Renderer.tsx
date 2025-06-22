import { signal } from "@preact/signals-react"
import { useEffect, useLayoutEffect, useRef } from "react"
import { AnimatePresence, motion, motionValue, springValue } from "motion/react"
import type { FlowSimpleRendererArgs, Vec3 } from "../depth-flow/renderer/simple"
import type { FrameCounter } from "../depth-flow/renderer/common"


// renderer

const currentRenderer = signal<{
  key: string
  render: (args: FlowSimpleRendererArgs) => number
  frameCounter: FrameCounter
  canvas: HTMLCanvasElement
}>()


export function setRenderer(renderer: typeof currentRenderer.value | null) {
  currentRenderer.value = renderer || undefined
}


// params

const defaultOrigin: Vec3 = [0, 0, -15]
const defaultTarget: Vec3 = [0, 0, 0]
const defaultZoomScale = 1

const centerMovementX = motionValue(0) // -1 ~ 1
const centerMovementY = motionValue(0) // -1 ~ 1
const centerMovementH = motionValue(0) // -1 ~ 1

const springMovementX = springValue(centerMovementX, { stiffness: 100, damping: 20, mass: 1 })
const springMovementY = springValue(centerMovementY, { stiffness: 100, damping: 20, mass: 1 })
const springMovementH = springValue(centerMovementH, { stiffness: 300, damping: 40, mass: 1 })

let shouldRender = true

springMovementX.on("change", () => shouldRender = true)
springMovementY.on("change", () => shouldRender = true)
springMovementH.on("change", () => shouldRender = true)


// components

function RendererContent({ renderer }: { renderer: typeof currentRenderer.value }) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!ref.current || !renderer) return
    const el = ref.current
    const canvas = renderer.canvas
    const render = renderer.render
    const frameCounter = renderer.frameCounter

    canvas.className = "absolute left-0 top-0 w-full h-full"
    el.appendChild(canvas)

    let animationFrame: number | null = null
    function frame() {
      animationFrame = requestAnimationFrame(frame)

      if (!shouldRender) return
      shouldRender = false
      render({
        origin: [
          defaultOrigin[0] - springMovementX.get(),
          defaultOrigin[1] + springMovementY.get(),
          20 / ((20 / defaultOrigin[2]) + springMovementH.get()),
        ],
        target: defaultTarget,
        zoomScale: defaultZoomScale,
      })
      if (frameCounter.totalRenders >= 1000) {
        console.log(`Frame average time: ${frameCounter.averageTime.toFixed(2)} ms`)
        frameCounter.reset()
      }
    }

    shouldRender = true
    frame()

    return () => {
      if (animationFrame) cancelAnimationFrame(animationFrame)
      el.removeChild(canvas)
    }
  }, [renderer?.key])

  return (
    <motion.div
      ref={ref}
      className="absolute inset-0"
      initial={{ opacity: 0, scale: 1.1, z: 1 }}
      animate={{ opacity: 1, scale: 1, z: 0 }}
      exit={{ opacity: 0, scale: 0.9, z: -1 }}
      transition={{
        duration: 1.2,
        type: "spring",
        bounce: 0.2,
      }}
    />
  )
}


export function Renderer() {
  const renderer = currentRenderer.value

  useEffect(() => {
    const mouseMove = (e: MouseEvent | PointerEvent) => {
      const { innerWidth, innerHeight } = window
      const { clientX, clientY } = e
      const x = (clientX / innerWidth) * 2 - 1
      const y = (clientY / innerHeight) * 2 - 1
      centerMovementX.set(x)
      centerMovementY.set(y)
    }

    const mouseWheel = (e: WheelEvent) => {
      const { deltaY } = e
      const value = centerMovementH.get()
      const newValue = Math.max(-1, Math.min(1, value + deltaY / 400))
      centerMovementH.set(newValue)
    }

    const resize = () => {
      shouldRender = true
    }


    window.addEventListener("pointermove", mouseMove)
    window.addEventListener("wheel", mouseWheel)
    window.addEventListener("resize", resize)
    return () => {
      window.removeEventListener("pointermove", mouseMove)
      window.removeEventListener("wheel", mouseWheel)
      window.removeEventListener("resize", resize)
    }
  }, [])

  return (
    <AnimatePresence>
      {renderer && (
        <RendererContent key={renderer.key} renderer={renderer} />
      )}
    </AnimatePresence>
  )
}
