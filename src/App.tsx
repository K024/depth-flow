import { MotionConfig } from "motion/react"
import { Canvas } from "./Canvas"
import { Controls } from "./Controls"


export function App() {
  return (
    <MotionConfig transition={{ duration: 0.3 }}>
      <Canvas />
      <Controls />
    </MotionConfig>
  )
}
