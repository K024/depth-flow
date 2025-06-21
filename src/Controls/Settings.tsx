import { signal } from "@preact/signals-react"
import { motion } from "motion/react"


export const depthMapDilateRadius = signal(4)

export const layerDepthMapDilateRadius = signal(4)


export function InnerSettings() {
  return (
    <motion.div
      className="absolute inset-0 p-4 overflow-y-auto flex flex-col gap-4 justify-center text-center"
      initial={{ filter: "blur(4px)", opacity: 0 }}
      animate={{ filter: "blur(0px)", opacity: 1 }}
      exit={{ filter: "blur(4px)", opacity: 0, z: -1 }}
    >
      <div className="btn btn-soft btn-primary w-full">
        Clear Model Cache
      </div>
    </motion.div>
  )
}
