
# DepthFlow Web

Images to → 3D Parallax implemented with web apis. Enjoy iOS 26 Spatial scene on the web. Inspired by [DepthFlow](https://github.com/BrokenSource/DepthFlow).

<video src="https://github.com/user-attachments/assets/fdf0cd2f-c634-4b6c-8b6b-b91851745e10" muted controls></video>

Open [depth-flow.pages.dev](https://depth-flow.pages.dev/) to create a new 3D parallax flow.


## NPM package

To use the `depth-flow` npm package, first create a flow zip file `depth-flow.zip` on the site.


```ts
import { loadFlowZip, createFlowMultilayerRenderer, createFlowSimpleRenderer } from "depth-flow"
import flowZipUrl from "./depth-flow.zip?url"

async function main() {
  const canvas = document.createElement("canvas")
  const blob = await fetch(flowZipUrl).then(res => res.blob())
  const flow = await loadFlowZip(blob)

  const renderer = "layers" in flow
    ? await createFlowMultilayerRenderer(canvas, flow)
    : await createFlowSimpleRenderer(canvas, flow)

  const origin: [number, number, number] = [0, 0, -30]
  const target: [number, number, number] = [0, 0, 0]
  const zoomScale = 0.9

  let originChanged = false

  const renderLoop = () => {
    requestAnimationFrame(renderLoop)
    if (originChanged) {
      renderer.render({ origin, target, zoomScale })
    }
  }

  canvas.addEventListener("pointermove", event => {
    const rect = canvas.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width * -2 + 1
    const y = (event.clientY - rect.top) / rect.height * 2 - 1

    // or add spring animation here
    origin[0] = x
    origin[1] = y
    originChanged = true
  })

  requestAnimationFrame(renderLoop)

  canvas.style.position = "absolute"
  canvas.style.top = "0"
  canvas.style.left = "0"
  canvas.style.width = "100%"
  canvas.style.height = "100%"

  const root = document.querySelector<HTMLDivElement>("#app")!
  root.appendChild(canvas)
}

main()
```

Render params details:

| Parameter | Type | Description |
|-----------|------|-------------|
| `origin` | `[number, number, number]` | Camera position in 3D space. The x and y components can be controlled by pointer movement, and z can be controlled by mouse wheel |
| `target` | `[number, number, number]` | Look-at target point. Fixed at `[0,0,0]` to look at the center of the scene |
| `zoomScale` | `number` | Controls the zoom level/field of view. A value smaller than 1 to ensure the scene covers all the visible parts |


The whole scene is inside the box from `[-1,-1,-1]` to `[1,1,1]`, and the bottom sits on the plane at `[x,y,1]`. The camera is expected to locate at a position with negative `z` value and look down through the z axis.


## Community

Checkout [DepthFlow](https://github.com/BrokenSource/DepthFlow) if you want to create a video.
