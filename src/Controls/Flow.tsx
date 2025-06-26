import clsx from "clsx"
import { useEffect } from "react"
import { motion } from "motion/react"
import { signal } from "@preact/signals-react"
import { useDropzone } from "react-dropzone"
import { asyncState } from "./utils"
import { setBackground } from "../Canvas/Background"
import { createFlowSimpleRenderer } from "../depth-flow/renderer/simple"
import { loadFlowZip } from "../depth-flow/flow-file"
import { setRenderer } from "../Canvas/Renderer"
import { createFlowMultilayerRenderer } from "../depth-flow/renderer/multilayer"
import { clearCache, getCachedFile, saveCachedFile } from "../depth-flow/file-cache"


const flowFile = signal<File | string | null>(null)


const flowFileCacheUrl = "file://depth-flow-cache/last-flow.zip"


const flowFileFromUrl = async (url: string) => {
  const response = await fetch(url)
  if (!response.ok)
    throw new Error(`Failed to fetch flow file from ${url}`)
  const blob = await response.blob()
  return new File([blob], "flow.zip", { type: "application/zip" })
}


const {
  data: renderer,
  loading: creatingRenderer,
  fetch: createRenderer,
  reset: resetRenderer,
  error: creatingRendererError,
} = asyncState(async (flowFile: Blob | string) => {

  if (typeof flowFile === "string") {
    flowFile = await flowFileFromUrl(flowFile)
  }

  const flow = await loadFlowZip(flowFile)

  saveCachedFile(flowFileCacheUrl, flowFile)

  const canvas = document.createElement("canvas")
  canvas.width = 800
  canvas.height = 600

  // const renderer = await createFlowSimpleRenderer(canvas, flow)

  const renderer = "layers" in flow
    ? await createFlowMultilayerRenderer(canvas, flow)
    : await createFlowSimpleRenderer(canvas, flow)

  setBackground(null)
  setRenderer({
    key: Math.random().toString(36).slice(2),
    render: renderer.render,
    frameCounter: renderer.frameTimeCounter,
    canvas,
  })

  return renderer
})

const reset = () => {
  flowFile.value = null
  resetRenderer()
}

export { createRenderer }

export function useLastFlowFileWhenInit() {
  useEffect(() => {
    getCachedFile(flowFileCacheUrl).then((file) => {
      if (file) {
        flowFile.value = new File([file], "last-flow.zip", { type: "application/zip" })
        createRenderer(flowFile.value)
      }
    })
  }, [])
}

export function clearLastFlowFileCache() {
  clearCache([flowFileCacheUrl])
}



const getSharedFlowUrlFromSearchParams = () => {
  const url = new URL(window.location.href)
  const search = url.searchParams.get("flow-file")
  if (!search)
    return null
  try {
    return new URL(search).toString()
  } catch (error) {
    return null
  }
}

const sharedFlowUrl = getSharedFlowUrlFromSearchParams()

function CreateFlowRenderer() {

  const { getRootProps, getInputProps, isDragAccept, isDragReject } = useDropzone({
    accept: {
      "application/zip": [".zip"],
    },
    onDrop: (files) => {
      if (!files.length)
        return
      flowFile.value = files[0]
      createRenderer(flowFile.value)
    },
  })

  if (creatingRendererError.value) {
    return <>
      <div className="alert alert-soft alert-error">
        {creatingRendererError.value.message}
      </div>
      <div
        className="btn btn-soft btn-primary w-full"
        onClick={reset}
      >
        Try another flow
      </div>
    </>
  }

  if (creatingRenderer.value) {
    return <>
      <div className="alert alert-soft alert-primary">
        Creating renderer...
      </div>
      <progress className="progress progress-info w-full"></progress>
    </>
  }

  if (renderer.value) {
    return <>
      <div className="text-sm opacity-70">
        Renderer ({renderer.value.type}) created successfully.
        <br />
        Move your mouse around and zoom in/out with the mouse wheel to see the flow effect.
      </div>
      <div
        className="btn btn-soft btn-primary w-full"
        onClick={reset}
      >
        Use another flow file
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
      Drop or select a flow file
      <input
        className="hidden"
        {...getInputProps()}
      />
    </div>
    {sharedFlowUrl && (
      <div className="btn btn-soft btn-primary w-full"
        onClick={() => {
          flowFile.value = sharedFlowUrl
          createRenderer(sharedFlowUrl)
        }}
      >
        Use the flow file from shared link
      </div>
    )}
    <div className="text-sm opacity-70">
      A new flow file can be created using an image under the Create tab
    </div>
  </>
}



export function Flow() {
  return (
    <motion.div
      className="absolute inset-0 p-4 overflow-y-auto flex flex-col gap-4 justify-center text-center"
      initial={{ filter: "blur(4px)", opacity: 0 }}
      animate={{ filter: "blur(0px)", opacity: 1 }}
      exit={{ filter: "blur(4px)", opacity: 0, z: -1 }}
    >
      <CreateFlowRenderer />
    </motion.div>
  )
}
