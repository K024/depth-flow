import { signal } from "@preact/signals-react"
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

export function setBackground(file: Blob) {
  if (currentBackground.value) {
    URL.revokeObjectURL(currentBackground.value)
    currentBackground.value = undefined
  }
  currentBackground.value = URL.createObjectURL(file)
}


export function Canvas() {
  return (
    <div
      className="w-full h-full bg-cover bg-center bg-no-repeat"
      style={{
        backgroundImage: currentBackground.value ? `url(${currentBackground.value})` : "none"
      }}
    >
      {/* TODO */}
    </div>
  )
}
