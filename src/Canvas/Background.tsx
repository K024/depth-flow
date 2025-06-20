import { signal } from "@preact/signals-react"
import { AnimatePresence, motion } from "motion/react"
import { selectFile } from "../depth-flow/utils"


const currentBackground = signal<string>()


export async function selectBackground() {
  const file = await selectFile("image/*")
  if (currentBackground.value) {
    URL.revokeObjectURL(currentBackground.value)
    currentBackground.value = undefined
  }
  currentBackground.value = URL.createObjectURL(file)
  return currentBackground.value
}

export function setBackground(file: Blob | null) {
  if (currentBackground.value) {
    URL.revokeObjectURL(currentBackground.value)
    currentBackground.value = undefined
  }
  if (file) {
    currentBackground.value = URL.createObjectURL(file)
  } else {
    currentBackground.value = undefined
  }
}


export function Background() {
  const bg = currentBackground.value
  return (
    <AnimatePresence>
      {bg && (
        <motion.div
          key={bg}
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          initial={{ opacity: 0, scale: 1.1, z: 1 }}
          animate={{ opacity: 1, scale: 1, z: 0 }}
          exit={{ opacity: 0, scale: 0.9, z: -1 }}
          transition={{
            duration: 1.2,
            type: "spring",
            bounce: 0.2,
          }}
          style={{
            backgroundImage: `url(${bg})`
          }}
        />
      )}
    </AnimatePresence>
  )
}
