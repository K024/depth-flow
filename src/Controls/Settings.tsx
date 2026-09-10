import clsx from "clsx"
import { signal } from "@preact/signals-react"
import type { Signal } from "@preact/signals-react"
import { motion } from "motion/react"
import { clearCache } from "../depth-flow/file-cache"
import { clearModelCache } from "../depth-flow/models/cache"
import { clearLastFlowFileCache, rendererPreset, setRendererPreset } from "./Flow"
import { flowSimpleRendererPresets } from "../depth-flow/renderer/simple"
import type { FlowSimpleRendererPreset } from "../depth-flow/renderer/simple"


// simple flow

export const depthMapDilateRadius = signal(4)

// slide flow

export const slidePoolRadius = signal(2)
export const slideBlurSigma = signal(2)
export const slideBetaStep = signal(50)
export const slideDisocclusionRho = signal(7)
export const slideDisocclusionGamma = signal(30)
export const slideRepairThreshold = signal(0.5)
export const slideRepairDilateRadius = signal(2)
export const slideBottomDepthEpsilon = signal(0.01)


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
  const value = signal.useValue()

  return (
    <fieldset className="fieldset text-left">
      <legend className="fieldset-legend">{label}</legend>
      <div className="flex items-center gap-2">
        <input
          type="range" min={min} max={max} step={step}
          className="range range-sm"
          value={value}
          onChange={(e) => {
            signal.value = Number(e.target.value)
          }}
        />
        <div className="text-sm w-12 text-right tabular-nums">
          {value}
        </div>
      </div>
      <p className="label whitespace-break-spaces">
        {description}
      </p>
    </fieldset>
  )
}

function SlideFlowSettings() {
  return <>
    <div className="divider opacity-60 mb-0">SLIDE Flow</div>

    <RangeFieldset
      label="Depth Pool Radius"
      signal={slidePoolRadius}
      min={0} max={8} step={1}
      description="Expands near-depth silhouettes with a circular max-pool, measured in native depth-model pixels. Increase it to protect object edges from stretching, but expect thicker foreground halos and a larger repair area; decrease it for tighter geometry, with more risk of edge tearing."
    />
    <RangeFieldset
      label="Depth Blur Sigma"
      signal={slideBlurSigma}
      min={0} max={6} step={0.25}
      description="Sets the Gaussian smoothing width in native depth pixels. Increase it for a wider, softer transparency transition with less stair-stepping; decrease it for a narrower, sharper edge. It should not materially change Bottom depth-repair statistics."
    />
    <RangeFieldset
      label="Visibility Step Beta"
      signal={slideBetaStep}
      min={5} max={300} step={5}
      description="Sets how strongly a normalized depth step reduces Top visibility. Increase it to make smaller depth edges more transparent and reveal more Bottom; decrease it to keep more edges opaque. Unlike Blur Sigma, it mainly changes opacity, not band width."
    />
    <RangeFieldset
      label="Disocclusion Rho"
      signal={slideDisocclusionRho}
      min={3} max={24} step={0.25}
      description="Sets how far a depth edge can expose background when the camera moves. Increase it for narrower repair bands and faster/smaller inpainting; decrease it for wider coverage of stronger camera motion, at the cost of modifying more pixels."
    />
    <RangeFieldset
      label="Disocclusion Gamma"
      signal={slideDisocclusionGamma}
      min={5} max={100} step={1}
      description="Controls how quickly the soft disocclusion score changes from black to white. Increase it for a steeper, more decisive mask and more feather weight near weak edges; decrease it for a gentler response. Together with Repair Threshold, it changes which weak depth steps enter the repair mask."
    />
    <RangeFieldset
      label="Repair Threshold"
      signal={slideRepairThreshold}
      min={0.05} max={0.95} step={0.05}
      description="Cuts the soft disocclusion map into the binary area sent to LaMa. Increase it to ignore weaker edges and shrink the repair area; decrease it to include weaker edges and grow the repair area, which may improve coverage but costs more and can overwrite valid content."
    />
    <RangeFieldset
      label="Repair Dilate Radius"
      signal={slideRepairDilateRadius}
      min={0} max={16} step={1}
      description="Adds a circular safety margin around the repair mask, measured in native depth-model pixels. Increase it to cover edge uncertainty and avoid leftover foreground pixels; decrease it to preserve more original image and reduce inpainting work."
    />
    <RangeFieldset
      label="Bottom Depth Epsilon"
      signal={slideBottomDepthEpsilon}
      min={0} max={0.1} step={0.005}
      description="Keeps repaired Bottom geometry at least this normalized-disparity distance behind Top. Increase it to enforce stronger layer separation and reduce overlap, but too much can push background unnaturally far back; decrease it for closer layers, with more risk of z-fighting or foreground-following artifacts."
    />
  </>
}


function SimpleFlowSettings() {
  return <>
    <div className="divider opacity-60 mb-0">Simple Flow</div>

    <RangeFieldset
      label="Depth Map Dilate Radius"
      signal={depthMapDilateRadius}
      min={0} max={20} step={1}
      description="Expands near-depth regions before Simple Flow rendering. Increase it to keep object borders attached and reduce edge stretching, but expect thicker halos; decrease it for tighter depth edges, with more risk of cracks during camera motion."
    />
  </>
}

function RendererSettings() {
  const preset = rendererPreset.useValue()

  return <>
    <div className="divider opacity-60 mb-0">Renderer</div>

    <fieldset className="fieldset text-left">
      <legend className="fieldset-legend">Quality Preset</legend>
      <div className="join grid grid-cols-3 w-full">
        {Object.entries(flowSimpleRendererPresets).map(([name, options]) => (
          <button
            key={name}
            type="button"
            className={clsx(
              "btn btn-sm join-item",
              preset === name ? "btn-primary" : "btn-soft",
            )}
            onClick={() => {
              setRendererPreset(name as FlowSimpleRendererPreset)
            }}
          >
            <span>{name[0].toUpperCase() + name.slice(1)}</span>
            <span className="badge badge-sm badge-ghost">
              {options.forwardSteps}/{options.backwardSteps}
            </span>
          </button>
        ))}
      </div>
      <p className="label whitespace-break-spaces">
        Recreates current renderer immediately. Higher quality uses more GPU time.
      </p>
    </fieldset>
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
        <SlideFlowSettings />
        <RendererSettings />
        <OtherSettings />
      </div>
    </motion.div>
  )
}
