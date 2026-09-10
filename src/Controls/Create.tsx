import clsx from "clsx"
import { useEffect } from "react"
import { motion } from "motion/react"
import { signal } from "@preact/signals-react"
import { useDropzone } from "react-dropzone"
import { setBackground } from "../Canvas/Background"
import { setRenderer } from "../Canvas/Renderer"
import {
  depthMapDilateRadius,
  slideBlurSigma,
  slideBottomDepthEpsilon,
  slideDisocclusionRho,
  slidePoolRadius,
  slideRepairDilateRadius,
  slideRepairScoreThreshold,
  slideVisibilityCutoff,
  slideVisibilityKnee,
} from "./Settings"
import { humanSize, asyncState } from "./utils"
import { checkAllModelsCached, downloadAllModels } from "../depth-flow/models/cache"
import { downloadFile } from "../depth-flow/utils"
import { createRenderer } from "./Flow"
import {
  createSimpleFlowInWorker,
  createSlideFlowInWorker,
} from "../depth-flow/create-worker-client"
const imageAccept = {
  "image/*": [".png", ".jpg", ".jpeg", ".webp"],
}


// model cache state

const {
  data: allModelsCached,
  fetch: checkModelsAgain,
} = asyncState(checkAllModelsCached)


// download state

const downloadProgress = signal<[string, number | undefined]>()

const {
  fetch: downloadModels,
  loading: downloading,
  error: downloadError,
  reset: resetDownload,
} = asyncState(downloadAllModels)


// create flow state

const selectedImage = signal<File | null>(null)
const selectedDepthMap = signal<File | null>(null)
const selectionError = signal<string>()

const createProgress = signal<[string, number | undefined]>()

const {
  data: flowFile,
  fetch: createDepthFlow,
  loading: creatingFlow,
  error: createError,
  reset: resetCreate,
} = asyncState(async (file: File, depthMap?: File) => {
  const flowFile = await createSimpleFlowInWorker(
    file,
    depthMap,
    {
      depthMapDilateRadius: depthMapDilateRadius.value,
    },
    (message, p) => createProgress.value = [message, p],
  )
  createRenderer(flowFile)
  return flowFile
})

const {
  data: slideFlowFile,
  fetch: createSlideFlow,
  loading: creatingSlideFlow,
  error: createSlideError,
  reset: resetCreateSlide,
} = asyncState(async (file: File, depthMap?: File) => {
  const flowFile = await createSlideFlowInWorker(
    file,
    depthMap,
    {
      poolRadius: slidePoolRadius.value,
      blurSigma: slideBlurSigma.value,
      visibilityKnee: slideVisibilityKnee.value,
      visibilityCutoff: slideVisibilityCutoff.value,
      disocclusionRho: slideDisocclusionRho.value,
      repairScoreThreshold: slideRepairScoreThreshold.value,
      repairDilateRadius: slideRepairDilateRadius.value,
      bottomDepthEpsilon: slideBottomDepthEpsilon.value,
    },
    (message, p) => createProgress.value = [message, p],
  )
  createRenderer(flowFile)
  return flowFile
})

const reset = () => {
  resetCreate()
  resetCreateSlide()
  createProgress.value = undefined
  selectedImage.value = null
  selectedDepthMap.value = null
  selectionError.value = undefined
}

async function imageSize(file: Blob) {
  const image = await createImageBitmap(file)
  try {
    return { width: image.width, height: image.height }
  } finally {
    image.close()
  }
}

function hasDepthName(file: File) {
  return /(?:^|[\s._-])(depth|depthmap|depth-map|disparity)(?:[\s._-]|$)/i.test(file.name)
}

async function selectSourceFiles(files: File[]) {
  selectionError.value = undefined

  if (files.length === 1) {
    selectedImage.value = files[0]
    selectedDepthMap.value = null
    setBackground(files[0])
    setRenderer(undefined)
    return
  }

  if (files.length !== 2) {
    selectionError.value = "Select one source image, or exactly two images: one source and one depth map."
    return
  }

  const depthNamedFiles = files.filter(hasDepthName)
  if (depthNamedFiles.length !== 1) {
    selectionError.value = "Could not identify depth map. Name it with “depth” or “disparity”, or select source image first and add depth map below."
    return
  }

  const depthMap = depthNamedFiles[0]
  const image = files.find(file => file !== depthMap)!
  const [imageDimensions, depthDimensions] = await Promise.all([
    imageSize(image),
    imageSize(depthMap),
  ])
  if (
    imageDimensions.width !== depthDimensions.width
    || imageDimensions.height !== depthDimensions.height
  ) {
    selectionError.value = `Source and depth map must have same size. Source: ${imageDimensions.width}×${imageDimensions.height}; depth: ${depthDimensions.width}×${depthDimensions.height}.`
    return
  }

  selectedImage.value = image
  selectedDepthMap.value = depthMap
  setBackground(image)
  setRenderer(undefined)
}


// components

function Download() {
  const isDownloading = downloading.useValue()
  const error = downloadError.useValue()
  const progress = downloadProgress.useValue()

  const confirmDownload = () => {
    if (!isDownloading) {
      downloadModels((message, value) => downloadProgress.value = [message, value])
        .then(checkModelsAgain)
    }
  }
  if (error) {
    return <>
      <div className="alert alert-soft alert-error">
        {error.message}
      </div>
      <div
        className="btn btn-soft btn-secondary w-full"
        onClick={resetDownload}
      >
        Retry
      </div>
    </>
  }
  if (isDownloading) {
    const [message, value] = progress || ["Downloading models", undefined]
    return <>
      <div className="alert alert-soft alert-primary">
        {message}
      </div>
      <progress className="progress progress-info w-full" value={value} max="100"></progress>
    </>
  }
  return <>
    <div className="text-sm opacity-70">
      Creating a new depth flow requires downloading and caching AI models.
      This process will only be performed once.
    </div>
    <div className="btn btn-soft btn-primary w-full" onClick={confirmDownload}>
      Download Models
    </div>
    <div className="md:hidden text-secondary text-sm opacity-70">
      Running AI models on mobile devices is strongly discouraged. Try on desktop instead.
    </div>
  </>
}



function CreateFlow({ modelsCached }: { modelsCached: boolean | undefined }) {
  const flow = flowFile.useValue()
  const error = createError.useValue()
  const slideError = createSlideError.useValue()
  const isCreatingFlow = creatingFlow.useValue()
  const isCreatingSlideFlow = creatingSlideFlow.useValue()
  const slideFlow = slideFlowFile.useValue()
  const progress = createProgress.useValue()
  const image = selectedImage.useValue()
  const depthMap = selectedDepthMap.useValue()
  const fileSelectionError = selectionError.useValue()

  const { getRootProps, getInputProps, isDragAccept, isDragReject } = useDropzone({
    accept: imageAccept,
    maxFiles: 2,
    onDrop: (files) => {
      selectSourceFiles(files).catch((error) => {
        selectionError.value = error instanceof Error ? error.message : "Failed to read selected images."
      })
    },
  })
  const depthDropzone = useDropzone({
    accept: imageAccept,
    maxFiles: 1,
    onDrop: async (files) => {
      if (!files.length || !image)
        return
      try {
        const [imageDimensions, depthDimensions] = await Promise.all([
          imageSize(image),
          imageSize(files[0]),
        ])
        if (
          imageDimensions.width !== depthDimensions.width
          || imageDimensions.height !== depthDimensions.height
        ) {
          selectionError.value = `Depth map must match source size (${imageDimensions.width}×${imageDimensions.height}); received ${depthDimensions.width}×${depthDimensions.height}.`
          return
        }
        selectionError.value = undefined
        selectedDepthMap.value = files[0]
      } catch (error) {
        selectionError.value = error instanceof Error ? error.message : "Failed to read depth map."
      }
    },
  })

  if (flow) {
    return <>
      <div className="text-sm opacity-70">
        Flow created successfully.
        <br />
        Download the flow file to use it next time.
      </div>
      <div
        className="btn btn-soft btn-primary w-full"
        onClick={() => {
          downloadFile(flow)
        }}
      >
        Download ({humanSize(flow.size)})
      </div>
      <div
        className="btn btn-soft btn-secondary w-full"
        onClick={reset}
      >
        Create another flow
      </div>
    </>
  }
  if (slideFlow) {
    return <>
      <div className="alert alert-soft alert-success">
        SLIDE Flow created. Processing artifacts remain available in browser console.
      </div>
      <div
        className="btn btn-soft btn-accent w-full"
        onClick={() => {
          downloadFile(slideFlow)
        }}
      >
        Download SLIDE Flow ({humanSize(slideFlow.size)})
      </div>
      <div
        className="btn btn-soft btn-secondary w-full"
        onClick={reset}
      >
        Create another flow
      </div>
    </>
  }
  if (error || slideError) {
    return <>
      <div className="alert alert-soft alert-error">
        {(error || slideError)?.message}
      </div>
      <div
        className="btn btn-soft btn-primary w-full"
        onClick={reset}
      >
        Try again
      </div>
    </>
  }
  if (isCreatingFlow || isCreatingSlideFlow) {
    const [message, value] = progress || ["Creating flow", undefined]
    return <>
      <div className="text-sm opacity-70">
        Creating a new flow runs heavy computation in a background worker.
      </div>
      <div className="alert alert-soft alert-primary">
        {message}
      </div>
      <progress className="progress progress-info w-full" value={value} max="100"></progress>
    </>
  }
  if (image) {
    return <>
      <div className="alert alert-soft alert-primary text-center break-all">
        Source: {image.name} ({humanSize(image.size)})
      </div>
      {depthMap ? (
        <div className="alert alert-soft alert-success text-center break-all">
          Supplied depth map: {depthMap.name} ({humanSize(depthMap.size)})
        </div>
      ) : (
        <div
          className={clsx(
            "btn btn-dash btn-secondary w-full min-h-24 h-auto whitespace-normal",
            depthDropzone.isDragAccept && "bg-secondary/20",
            depthDropzone.isDragReject && "bg-error/20",
          )}
          {...depthDropzone.getRootProps()}
        >
          Upload matching depth map (optional)
          <input className="hidden" {...depthDropzone.getInputProps()} />
        </div>
      )}
      {fileSelectionError && (
        <div className="alert alert-soft alert-error">{fileSelectionError}</div>
      )}
      {depthMap && <>
        <div className="text-sm opacity-70">
          Uses supplied map. Depth Anything model is skipped. Low-contrast maps are normalized only when their 1%–99% range is under 80% of 0–255.
        </div>
        <div
          className="btn btn-soft btn-primary w-full"
          onClick={() => {
            createDepthFlow(image, depthMap)
          }}
        >
          Create Simple Flow with Supplied Depth
        </div>
        <div
          className="btn btn-soft btn-accent w-full"
          onClick={() => {
            createSlideFlow(image, depthMap)
          }}
        >
          Create SLIDE Flow with Supplied Depth
        </div>
        <div
          className="btn btn-soft btn-secondary w-full"
          onClick={() => {
            selectedDepthMap.value = null
            selectionError.value = undefined
          }}
        >
          Remove Supplied Depth Map
        </div>
      </>}
      {!depthMap && modelsCached === true && <>
        <div
          className="btn btn-soft btn-primary w-full"
          onClick={() => {
            createDepthFlow(image)
          }}
        >
          Create Simple Flow
        </div>
        <div
          className="btn btn-soft btn-accent w-full"
          onClick={() => {
            createSlideFlow(image)
          }}
        >
          Create SLIDE Flow
        </div>
      </>}
      {!depthMap && modelsCached === false && <Download />}
      <div
        className="btn btn-soft btn-secondary w-full"
        onClick={reset}
      >
        Select another image
      </div>
    </>
  }

  return <>
    <div
      className={clsx(
        "btn btn-dash btn-primary w-full h-36 mx-auto",
        isDragAccept && "bg-primary/20",
        isDragReject && "bg-error/20",
      )}
      {...getRootProps()}
    >
      Drop source image, or source + named depth map
      <input
        className="hidden"
        {...getInputProps()}
      />
    </div>
    {fileSelectionError && (
      <div className="alert alert-soft alert-error">{fileSelectionError}</div>
    )}
    <div className="hidden md:block text-sm opacity-70">
      Two-file auto-pairing requires equal dimensions and exactly one filename containing “depth” or “disparity”.
    </div>
    <div className="md:hidden text-secondary text-sm opacity-70">
      Running AI models on mobile devices is strongly discouraged. Try on desktop instead.
    </div>
  </>
}



export function Create() {
  const modelsCached = allModelsCached.useValue()

  useEffect(() => {
    checkModelsAgain()
  }, [])

  return (
    <motion.div
      className="absolute inset-0 p-4 overflow-y-auto flex flex-col gap-4 justify-center text-center"
      initial={{ filter: "blur(4px)", opacity: 0 }}
      animate={{ filter: "blur(0px)", opacity: 1 }}
      exit={{ filter: "blur(4px)", opacity: 0, z: -1 }}
    >
      <CreateFlow modelsCached={modelsCached} />
    </motion.div>
  )
}
