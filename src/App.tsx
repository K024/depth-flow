import { MotionConfig } from "motion/react"
import { Canvas } from "./Canvas"
import { Settings } from "./Settings"


export function App() {
  return (
    <MotionConfig transition={{ duration: 0.3 }}>
      <Canvas />
      <Settings />
    </MotionConfig>
  )
}
