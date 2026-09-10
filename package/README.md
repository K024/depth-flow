
# depth-flow

Render DepthFlow zip files as WebGL2 3D parallax scenes.

Create a flow file at [depth-flow.pages.dev](https://depth-flow.pages.dev/), then load it with `loadFlowZip()` and create either a Simple or Slide renderer.

```ts
const flow = await loadFlowZip(flowZip)
const renderer = await createFlowSimpleRenderer(canvas, flow, {
  forwardSteps: 120,
  backwardSteps: 8,
  timer: "noop",
})

renderer.render({
  origin: [0, 0, -20],
  target: [0, 0, 0],
  zoomScale: 1,
})

renderer.dispose()
```

The package requires a browser with WebGL2. Use `timer: "performance"` for CPU timing or `timer: "gl"` for GPU draw-call timing where supported. Call `renderer.timer.poll()` regularly when timing is enabled.

See the [project README](https://github.com/K024/depth-flow) for the full example and option details.
