import clsx from "clsx"
import { useEffect } from "react"
import { motion } from "motion/react"
import { signal } from "@preact/signals-react"
import { useDropzone } from "react-dropzone"
import { setBackground } from "../Canvas/Background"
import { setRenderer } from "../Canvas/Renderer"
import { depthMapDilateRadius, layerDepthMapDilateRadius } from "./Settings"
import { humanSize, asyncState } from "./utils"
import { checkAllModelsCached, downloadAllModels } from "../depth-flow/models/cache"
// import { createMultilayerFlow, createSimpleFlow } from "../depth-flow/create-flow"
import { downloadFile, lazy } from "../depth-flow/utils"


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
} = asyncState(async (isSimple: boolean, file: File) => {
  const { createSimpleFlow, createMultilayerFlow } = await createFlowModule()
  if (isSimple) {
    return createSimpleFlow(
      file,
      {
        depthMapDilateRadius: depthMapDilateRadius.value,
      },
      (message, p) => createProgress.value = [message, p]
    )
  }
  return createMultilayerFlow(
    file,
    {
      depthMapDilateRadius: depthMapDilateRadius.value,
      layerDepthMapDilateRadius: layerDepthMapDilateRadius.value,
    },
    (message, p) => createProgress.value = [message, p]
  )
})

const reset = () => {
  resetCreate()
  createProgress.value = undefined
  selectedImage.value = null
}


// components

function Download() {
  const confirmDownload = () => {
    if (!downloading.value) {
      downloadModels((message, value) => downloadProgress.value = [message, value])
        .then(checkModelsAgain)
    }
  }
  if (downloadError.value) {
    return <>
      <div className="alert alert-soft alert-error">
        {downloadError.value.message}
      </div>
      <div
        className="btn btn-soft btn-secondary w-full"
        onClick={resetDownload}
      >
        Retry
      </div>
    </>
  }
  if (downloading.value) {
    const [message, value] = downloadProgress.value || ["Downloading models", undefined]
    return <>
      <div className="alert alert-soft alert-primary">
        {message}
      </div>
      <progress className="progress progress-info w-full" value={value} max="100"></progress>
    </>
  }
  return <>
    <p>
      Create a new depth flow requires downloading and caching several AI models (~400MB).
      This process will only be performed once.
    </p>
    <div className="btn btn-soft btn-primary w-full" onClick={confirmDownload}>
      Download Models
    </div>
  </>
}



function CreateFlow() {

  const { getRootProps, getInputProps, isDragAccept, isDragReject } = useDropzone({
    accept: {
      "image/*": [".png", ".jpg", ".jpeg", ".webp"],
    },
    onDrop: (files) => {
      selectedImage.value = files[0] || null
      setBackground(selectedImage.value)
      setRenderer(undefined)
    },
  })

  const flow = flowFile.value
  if (flow) {
    return <>
      <div className="alert alert-soft alert-primary">
        Flow created successfully
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
  if (createError.value) {
    return <>
      <div className="alert alert-soft alert-error">
        {createError.value.message}
      </div>
      <div
        className="btn btn-soft btn-primary w-full"
        onClick={reset}
      >
        Try again
      </div>
    </>
  }
  if (creatingFlow.value) {
    const [message, value] = createProgress.value || ["Creating flow", undefined]
    return <>
      <div className="alert alert-soft alert-primary">
        {message}
      </div>
      <progress className="progress progress-info w-full" value={value} max="100"></progress>
    </>
  }
  if (selectedImage.value) {
    return <>
      <div className="alert alert-soft alert-primary text-center break-all">
        {selectedImage.value.name} ({humanSize(selectedImage.value.size)})
      </div>
      <div
        className="btn btn-soft btn-primary w-full"
        onClick={() => {
          if (!selectedImage.value) return
          createDepthFlow(true, selectedImage.value)
        }}
      >
        Create Simple Depth Flow
      </div>
      <div
        className="btn btn-soft btn-primary w-full"
        onClick={() => {
          if (!selectedImage.value) return
          createDepthFlow(false, selectedImage.value)
        }}
      >
        Create Multilayer Depth Flow
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
  </>
}



export function Create() {

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
      {allModelsCached.value === false && <Download />}
      {allModelsCached.value === true && <CreateFlow />}
    </motion.div>
  )
}
