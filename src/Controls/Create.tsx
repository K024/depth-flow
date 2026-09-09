import clsx from "clsx"
import { useEffect } from "react"
import { motion } from "motion/react"
import { signal } from "@preact/signals-react"
import { useDropzone } from "react-dropzone"
import { setBackground } from "../Canvas/Background"
import { setRenderer } from "../Canvas/Renderer"
import {
  depthMapDilateRadius,
  slideAnalysisResolution,
  slideBottomDepthEpsilon,
  slideDisocclusionGamma,
  slideDisocclusionRadius,
  slideDisocclusionRho,
  slideRepairDilateRadius,
  slideRepairThreshold,
  slideVisibilityBeta,
} from "./Settings"
import { humanSize, asyncState } from "./utils"
import { checkAllModelsCached, downloadAllModels } from "../depth-flow/models/cache"
import { downloadFile, lazy } from "../depth-flow/utils"
import { createRenderer } from "./Flow"


const createFlowModule = lazy(() => import("../depth-flow/create-flow"))


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

const createProgress = signal<[string, number | undefined]>()

const {
  data: flowFile,
  fetch: createDepthFlow,
  loading: creatingFlow,
  error: createError,
  reset: resetCreate,
} = asyncState(async (file: File) => {
  const { createSimpleFlow } = await createFlowModule()
  const flowFile = await createSimpleFlow(
    file,
    {
      depthMapDilateRadius: depthMapDilateRadius.value,
    },
    (message, p) => createProgress.value = [message, p]
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
} = asyncState(async (file: File) => {
  const { createSlideFlow } = await createFlowModule()
  const flowFile = await createSlideFlow(
    file,
    {
      analysisResolution: slideAnalysisResolution.value,
      visibilityBeta: slideVisibilityBeta.value,
      disocclusionRho: slideDisocclusionRho.value,
      disocclusionGamma: slideDisocclusionGamma.value,
      disocclusionRadius: slideDisocclusionRadius.value,
      repairThreshold: slideRepairThreshold.value,
      repairDilateRadius: slideRepairDilateRadius.value,
      depthMapDilateRadius: depthMapDilateRadius.value,
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



function CreateFlow() {
  const flow = flowFile.useValue()
  const error = createError.useValue()
  const slideError = createSlideError.useValue()
  const isCreatingFlow = creatingFlow.useValue()
  const isCreatingSlideFlow = creatingSlideFlow.useValue()
  const slideFlow = slideFlowFile.useValue()
  const progress = createProgress.useValue()
  const image = selectedImage.useValue()

  const { getRootProps, getInputProps, isDragAccept, isDragReject } = useDropzone({
    accept: {
      "image/*": [".png", ".jpg", ".jpeg", ".webp"],
    },
    onDrop: (files) => {
      if (!files.length)
        return
      selectedImage.value = files[0]
      setBackground(files[0])
      setRenderer(undefined)
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
        Creating a new flow requires heavy computation, and may cause page to temporarily freeze.
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
        {image.name} ({humanSize(image.size)})
      </div>
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
      Drop or select an image
      <input
        className="hidden"
        {...getInputProps()}
      />
    </div>
    <div className="hidden md:block text-sm opacity-70">
      Suggest 1080P images
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
      {modelsCached === false && <Download />}
      {modelsCached === true && <CreateFlow />}
    </motion.div>
  )
}
