import clsx from "clsx"
import { motion } from "motion/react"
import { signal, useSignal } from "@preact/signals-react"
import { useDropzone } from "react-dropzone"
import { humanSize, useAsyncState } from "./utils"
import { checkAllModelsCached, downloadAllModels } from "../depth-flow/models/cache"
import { setBackground } from "../Canvas"
import { createMultilayerFlow, createSimpleFlow } from "../depth-flow/create-flow"
import { downloadFile } from "../depth-flow/utils"



function Download({ checkAgain }: { checkAgain: () => void }) {
  const progress = useSignal<[string, number | undefined]>()

  const { run: downloadModels, loading: downloading, error } = useAsyncState(downloadAllModels)

  const confirmDownload = () => {
    if (!downloading) {
      downloadModels((message, value) => progress.value = [message, value])
        .then(checkAgain)
    }
  }

  if (error) {
    return (
      <div className="alert alert-soft alert-error">
        {error.message}
      </div>
    )
  }

  if (progress.value) {
    const [message, value] = progress.value
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



const image = signal<File | null>(null)

function CreateFlow() {

  const progress = useSignal<[string, number | undefined]>()

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      "image/*": [".png", ".jpg", ".jpeg", ".webp"],
    },
    onDrop: (files) => {
      image.value = files[0]
      setBackground(files[0])
    },
  })

  const { data: flow, run: createDepthFlow, loading: creating, error: createError, reset: resetCreate } = useAsyncState(
    (isSimple: boolean, file: File) => {
      if (isSimple)
        return createSimpleFlow(file, (message, p) => progress.value = [message, p])
      return createMultilayerFlow(file, (message, p) => progress.value = [message, p])
    }
  )

  const reset = () => {
    resetCreate()
    progress.value = undefined
    image.value = null
  }

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

  if (createError) {
    return <>
      <div className="alert alert-soft alert-error">
        {createError.message}
      </div>
      <div
        className="btn btn-soft btn-primary w-full"
        onClick={reset}
      >
        Try again
      </div>
    </>
  }


  if (creating || progress.value) {
    const [message, value] = progress.value || ["Creating flow", undefined]
    return <>
      <div className="alert alert-soft alert-primary">
        {message}
      </div>
      <progress className="progress progress-info w-full" value={value} max="100"></progress>
    </>
  }


  if (image.value) {
    return <>
      {/* TODO: show image */}
      <div className="alert alert-soft alert-primary text-center break-all">
        {image.value.name} ({humanSize(image.value.size)})
      </div>
      <div
        className="btn btn-soft btn-primary w-full"
        onClick={() => {
          if (!image.value) return
          createDepthFlow(true, image.value)
        }}
      >
        Create Simple Depth Flow
      </div>
      <div
        className="btn btn-soft btn-primary w-full"
        onClick={() => {
          if (!image.value) return
          createDepthFlow(false, image.value)
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
        isDragActive && "bg-primary/20"
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

  const { data: allModelsCached, run: checkAgain } = useAsyncState(checkAllModelsCached, [])

  return (
    <motion.div
      className="absolute inset-0 p-4 overflow-y-auto flex flex-col gap-4 justify-center text-center"
      initial={{ filter: "blur(4px)", opacity: 0 }}
      animate={{ filter: "blur(0px)", opacity: 1 }}
      exit={{ filter: "blur(4px)", opacity: 0, z: -1 }}
    >
      {allModelsCached === false && <Download checkAgain={checkAgain} />}
      {allModelsCached === true && <CreateFlow />}
    </motion.div>
  )
}
