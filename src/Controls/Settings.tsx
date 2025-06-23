import { Signal, signal } from "@preact/signals-react"
import { motion } from "motion/react"
import { clearCache } from "../depth-flow/file-cache"
import { clearModelCache } from "../depth-flow/models/cache"
import { clearLastFlowFileCache } from "./Flow"


// simple flow

export const depthMapDilateRadius = signal(4)

// multilayer flow

export const depthMapDilateRadius_m = signal(1)

export const layerInpaintMaskDilateRadius = signal(8)
export const layerInpaintMaskBlurRadius = signal(2)

export const layerDepthMapDilateRadius = signal(6)
export const layerDepthMapBlurRadius = signal(2)

export const layerDisplayMaskBlurRadius = signal(2)
export const boundOverlap = signal(8)


function RangeFieldset({
  label, signal, min, max, step, description,
}: {
  label: string
  signal: Signal<number>
  min: number
  max: number
  step: number
  description: string
}) {
  return (
    <fieldset className="fieldset text-left">
      <legend className="fieldset-legend">{label}</legend>
      <div className="flex items-center gap-2">
        <input
          type="range" min={min} max={max} step={step}
          className="range range-sm"
          value={signal.value}
          onChange={(e) => {
            signal.value = parseInt(e.target.value)
          }}
        />
        <div className="text-sm w-6">
          {signal.value}
        </div>
      </div>
      <p className="label whitespace-break-spaces">
        {description}
      </p>
    </fieldset>
  )
}


function SimpleFlowSettings() {
  return <>
    <div className="divider opacity-60 mb-0">Simple Flow</div>

    <RangeFieldset
      label="Depth Map Dilate Radius"
      signal={depthMapDilateRadius}
      min={0} max={20} step={1}
      description="Moves the depth edge outward to keep the border at the same depth with the object."
    />
  </>
}

function MultilayerFlowSettings() {
  return <>
    <div className="divider opacity-60 mb-0">Multilayer Flow</div>

    <RangeFieldset
      label="Depth Map Dilate Radius"
      signal={depthMapDilateRadius_m}
      min={0} max={20} step={1}
      description="Same as above, but should be smaller as each layer will dilate its own depth map."
    />

    <RangeFieldset
      label="Inpaint Mask Dilate Radius"
      signal={layerInpaintMaskDilateRadius}
      min={0} max={30} step={1}
      description="Dilates the inpaint mask to fully cover the object when inpainting."
    />
    <RangeFieldset
      label="Inpaint Mask Blur Radius"
      signal={layerInpaintMaskBlurRadius}
      min={0} max={10} step={1}
      description="Blurs the inpaint mask to make the inpainting more natural."
    />

    <RangeFieldset
      label="Depth Map Dilate Radius"
      signal={layerDepthMapDilateRadius}
      min={0} max={20} step={1}
      description="Dilates on layer level to move the sharp edge outward the mask."
    />
    <RangeFieldset
      label="Depth Map Blur Radius"
      signal={layerDepthMapBlurRadius}
      min={0} max={10} step={1}
      description="Blurs the depth map on layer level."
    />

    <RangeFieldset
      label="Display Mask Blur Radius"
      signal={layerDisplayMaskBlurRadius}
      min={0} max={10} step={1}
      description="Blurs the display mask on layer level. This creates the transparent border between layers."
    />

    <RangeFieldset
      label="Bound Overlap"
      signal={boundOverlap}
      min={0} max={10} step={1}
      description="The overlap between the bounds of the layers for natural transition when the cut point is on a flat surface."
    />
  </>
}

function OtherSettings() {
  return <>
    <div className="divider opacity-60 mb-0">Others</div>
    <div
      className="btn btn-soft btn-secondary w-full"
      onClick={() => {
        clearModelCache()
      }}
    >
      Clear Model Cache
    </div>
    <div
      className="btn btn-soft btn-secondary w-full"
      onClick={() => {
        clearLastFlowFileCache()
      }}
    >
      Clear Last Flow File Cache
    </div>
    <div
      className="btn btn-soft btn-secondary w-full"
      onClick={() => {
        clearCache()
      }}
    >
      Clear All Caches
    </div>
  </>
}


export function InnerSettings() {
  return (
    <motion.div
      className="absolute inset-0 overflow-y-auto [scrollbar-width:thin]"
      initial={{ filter: "blur(4px)", opacity: 0 }}
      animate={{ filter: "blur(0px)", opacity: 1 }}
      exit={{ filter: "blur(4px)", opacity: 0, z: -1 }}
    >
      <div className="p-4 max-w-full flex flex-col gap-4 justify-center text-center">
        <div>
          DepthFlow (spatial scene)
          <br />
          implemented with web apis.
        </div>
        <a
          className="link text-sm opacity-70"
          href="https://github.com/K024/depth-flow"
          target="_blank"
        >
          Visit Github Page
        </a>
        <div className="text-sm">
          🚧 Still under development 🚧
        </div>
        <SimpleFlowSettings />
        <MultilayerFlowSettings />
        <OtherSettings />
      </div>
    </motion.div>
  )
}
