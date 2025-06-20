import { Background } from "./Background"
import { Renderer } from "./Renderer"

export function Canvas() {
  return (
    <div
      className="relative w-full h-full z-0"
    >
      <Background />
      <Renderer />
    </div>
  )
}
