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

export const slidePoolRadius = signal(3)
export const slideBlurSigma = signal(1.5)
export const slideVisibilityKnee = signal(0.03)
export const slideVisibilityCutoff = signal(0.08)
export const slideDisocclusionRho = signal(11)
// atanh(0.5)/30 = 0.01831 is the exact equivalent of the retired
// (Disocclusion Gamma 30, Repair Threshold 0.5) pair; 0.018 is the nearest
// slider step and lands within 0.5% of the same repair ratio.
export const slideRepairScoreThreshold = signal(0.018)
export const slideRepairDilateRadius = signal(2)
export const slideBottomDepthEpsilon = signal(0.01)


// Snapshot defaults from live signals. Keep signal declarations as source of
// initial values; UI reset actions read this immutable snapshot.
export const flowSettingsDefaults = Object.freeze({
  depthMapDilateRadius: depthMapDilateRadius.value,
  slidePoolRadius: slidePoolRadius.value,
  slideBlurSigma: slideBlurSigma.value,
  slideVisibilityKnee: slideVisibilityKnee.value,
  slideVisibilityCutoff: slideVisibilityCutoff.value,
  slideDisocclusionRho: slideDisocclusionRho.value,
  slideRepairScoreThreshold: slideRepairScoreThreshold.value,
  slideRepairDilateRadius: slideRepairDilateRadius.value,
  slideBottomDepthEpsilon: slideBottomDepthEpsilon.value,
})


function RangeFieldset({
  label, signal, min, max, step, description, defaultValue,
}: {
  label: string
  signal: Signal<number>
  min: number
  max: number
  step: number
  description: string
  defaultValue: number
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
        <span>
          {description}{" "}
          <span
            role="button"
            tabIndex={0}
            className="link link-hover cursor-pointer"
            title={`Reset ${label} to ${defaultValue}`}
            onClick={() => {
              signal.value = defaultValue
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                signal.value = defaultValue
              }
            }}
          >
            Default to {defaultValue}.
          </span>
        </span>
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
      min={0} max={8} step={0.5}
      defaultValue={flowSettingsDefaults.slidePoolRadius}
      description="Expands near-depth silhouettes with a circular max-pool, measured in reference pixels on the 518-short-edge analysis grid and rescaled if that grid changes. Half steps are real: the lattice disk grows 5, 9, 13, 21 pixels across radius 1, 1.5, 2, 2.5. Increase it to protect object edges from stretching, but expect thicker foreground halos and a larger repair area; decrease it for tighter geometry, with more risk of edge tearing. Below 1 it does nothing."
    />
    <RangeFieldset
      label="Depth Blur Sigma"
      signal={slideBlurSigma}
      min={0} max={6} step={0.25}
      defaultValue={flowSettingsDefaults.slideBlurSigma}
      description="Sets the Gaussian smoothing width in reference pixels on the 518-short-edge analysis grid. It is rescaled with that grid, which is what keeps Visibility Knee meaning the same thing at any analysis resolution. Increase it for a wider, softer transparency transition with less stair-stepping; decrease it for a narrower, sharper edge. It should not materially change Bottom depth-repair statistics."
    />
    <RangeFieldset
      label="Visibility Knee"
      signal={slideVisibilityKnee}
      min={0.005} max={0.06} step={0.0025}
      defaultValue={flowSettingsDefaults.slideVisibilityKnee}
      description="Depth steps below this normalized-disparity height keep Top fully opaque. Measured gradients put p90 near 0.015 and p99 near 0.12, so the useful range ends around 0.06. Increase it to ignore more depth-map noise and to shrink the partially transparent band, which is what the renderer pays for; decrease it to start fading Top at weaker edges."
    />
    <RangeFieldset
      label="Visibility Cutoff"
      signal={slideVisibilityCutoff}
      min={0.02} max={0.3} step={0.005}
      defaultValue={flowSettingsDefaults.slideVisibilityCutoff}
      description="Depth steps at or above this normalized-disparity height make Top fully transparent, so Bottom shows through with no residue. Recovered steps top out near 0.30, so a larger value would never reach full transparency. Decrease it to erase the stretched rubber band on weaker edges; increase it to keep more of the original edge, at the risk of translucent smearing. It only ever applies inside the repair mask, so it cannot punch holes in solid foreground. Must stay above Visibility Knee; the gap between the two is the width of the soft transition."
    />
    <RangeFieldset
      label="Disocclusion Rho"
      signal={slideDisocclusionRho}
      min={3} max={24} step={0.25}
      defaultValue={flowSettingsDefaults.slideDisocclusionRho}
      description="Sets how far a depth edge can expose background when the camera moves, as a disparity drop per unit of normalized image axis — the same space the renderer's camera moves in, so it is independent of both image size and analysis resolution. This is the primary control of repair-band width. Increase it for narrower repair bands and faster/smaller inpainting; decrease it for wider coverage of stronger camera motion, at the cost of modifying more pixels."
    />
    <RangeFieldset
      label="Repair Score Threshold"
      signal={slideRepairScoreThreshold}
      min={0.004} max={0.06} step={0.001}
      defaultValue={flowSettingsDefaults.slideRepairScoreThreshold}
      description="The smallest disparity step that counts as a real disocclusion, in the same normalized units as Visibility Cutoff and Bottom Depth Epsilon. Replaces the old Disocclusion Gamma and Repair Threshold pair, which only ever affected the mask through one combined quantity. Increase it to ignore weaker edges and shrink the repair area; decrease it to include weaker edges, which may improve coverage but costs more and can overwrite valid content. Measured at Rho 11: 0.004 marks 5.5% of the frame for repair, 0.06 marks 2.9%."
    />
    <RangeFieldset
      label="Repair Dilate Radius"
      signal={slideRepairDilateRadius}
      min={0} max={8} step={0.5}
      defaultValue={flowSettingsDefaults.slideRepairDilateRadius}
      description="Adds a circular safety margin around the repair mask, in reference pixels on the 518-short-edge analysis grid, which works out to a fixed fraction of the output short edge. Half steps are real. Increase it to cover edge uncertainty and avoid leftover foreground pixels; decrease it to preserve more original image and reduce inpainting work. The ring is not free: it is 34% of the mask at 2, 52% at 4 and 68% at 8, and Bottom depth repair loses its far boundary values inside it."
    />
    <RangeFieldset
      label="Bottom Depth Epsilon"
      signal={slideBottomDepthEpsilon}
      min={0} max={0.1} step={0.005}
      defaultValue={flowSettingsDefaults.slideBottomDepthEpsilon}
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
      min={0} max={20} step={0.5}
      defaultValue={flowSettingsDefaults.depthMapDilateRadius}
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
      <div className="flex flex-col gap-2">
        {Object.entries(flowSimpleRendererPresets).map(([name, options]) => (
          <button
            key={name}
            type="button"
            className={clsx(
              "w-full rounded-box border p-3 text-left transition-colors",
              preset === name
                ? "border-primary bg-primary text-primary-content"
                : "border-base-300 bg-base-100/40 hover:border-primary/50 hover:bg-base-200/60",
            )}
            onClick={() => {
              setRendererPreset(name as FlowSimpleRendererPreset)
            }}
          >
            <span className="flex items-center justify-between gap-3">
              <span className="font-medium">
                {name[0].toUpperCase() + name.slice(1)}
              </span>
              <span className={clsx(
                "badge badge-sm shrink-0",
                preset === name ? "badge-ghost" : "badge-outline",
              )}>
                {options.forwardSteps}/{options.backwardSteps}
              </span>
            </span>
            <span className="mt-1 block text-xs opacity-70">
              {options.forwardSteps} forward · {options.backwardSteps} backward ray steps
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
