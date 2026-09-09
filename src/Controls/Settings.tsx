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

export const slideAnalysisResolution = signal(512)
export const slideVisibilityBeta = signal(300)
export const slideDisocclusionRho = signal(1)
export const slideDisocclusionGamma = signal(10)
export const slideDisocclusionRadius = signal(64)
export const slideRepairThreshold = signal(0.5)
export const slideRepairDilateRadius = signal(4)
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
        <div className="text-sm w-6">
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
      label="Depth Map Dilate Radius"
      signal={depthMapDilateRadius}
      min={0} max={20} step={1}
      description="Moves the Top depth edge outward before visibility and disocclusion analysis."
    />
    <RangeFieldset
      label="Analysis Resolution"
      signal={slideAnalysisResolution}
      min={64} max={512} step={32}
      description="Long-side resolution used for soft-layering diagnostics."
    />
    <RangeFieldset
      label="Visibility Beta"
      signal={slideVisibilityBeta}
      min={0} max={500} step={5}
      description="Controls transparency near disparity discontinuities."
    />
    <RangeFieldset
      label="Disocclusion Rho"
      signal={slideDisocclusionRho}
      min={0} max={5} step={0.05}
      description="Penalizes distant scan-line candidates in normalized image coordinates."
    />
    <RangeFieldset
      label="Disocclusion Gamma"
      signal={slideDisocclusionGamma}
      min={0} max={50} step={0.5}
      description="Controls soft disocclusion response steepness."
    />
    <RangeFieldset
      label="Disocclusion Radius"
      signal={slideDisocclusionRadius}
      min={1} max={128} step={1}
      description="Horizontal and vertical scan radius at analysis resolution."
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
      min={0} max={32} step={1}
      description="Safety dilation in analysis-resolution pixels."
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
