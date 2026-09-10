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
      description="Circular max-pool radius in native depth-model pixels."
    />
    <RangeFieldset
      label="Depth Blur Sigma"
      signal={slideBlurSigma}
      min={0} max={6} step={0.25}
      description="Gaussian sigma in native depth pixels; directly controls transparency-band width."
    />
    <RangeFieldset
      label="Visibility Step Beta"
      signal={slideBetaStep}
      min={5} max={300} step={5}
      description="Controls which normalized disparity step heights become transparent."
    />
    <RangeFieldset
      label="Disocclusion Rho"
      signal={slideDisocclusionRho}
      min={3} max={24} step={0.25}
      description="Controls disocclusion width; larger values produce narrower repair bands."
    />
    <RangeFieldset
      label="Disocclusion Gamma"
      signal={slideDisocclusionGamma}
      min={5} max={100} step={1}
      description="Controls soft disocclusion response steepness."
    />
    <RangeFieldset
      label="Repair Threshold"
      signal={slideRepairThreshold}
      min={0.05} max={0.95} step={0.05}
      description="Converts soft disocclusion into binary LaMa repair mask."
    />
    <RangeFieldset
      label="Repair Dilate Radius"
      signal={slideRepairDilateRadius}
      min={0} max={16} step={1}
      description="Circular safety dilation in native depth-model pixels."
    />
    <RangeFieldset
      label="Bottom Depth Epsilon"
      signal={slideBottomDepthEpsilon}
      min={0} max={0.1} step={0.005}
      description="Minimum normalized disparity gap placing Bottom behind Top."
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
      description="Moves the depth edge outward to keep the border at the same depth with the object."
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
