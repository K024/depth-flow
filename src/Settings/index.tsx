import clsx from "clsx"
import { AnimatePresence, motion } from "motion/react"
import { signal } from "@preact/signals-react"
import { Create } from "./Create"
import { Flow } from "./Flow"
import { InnerSettings } from "./Settings"


const tabs = ["Flow", "Create", "Settings"] as const

const currentTab = signal<typeof tabs[number]>(tabs[0])


function Tabs() {
  return (
    <div role="tablist" className="relative tabs tabs-border">
      {tabs.map((tab) => (
        <a
          key={tab}
          role="tab"
          aria-label={tab}
          className={clsx(
            "tab flex-1",
            currentTab.value === tab && "tab-active"
          )}
          onClick={() => currentTab.value = tab}
        >
          {tab}
        </a>
      ))}
    </div>
  )
}


function TabContent() {
  return (
    <AnimatePresence>
      {currentTab.value === "Flow" && <Flow key="flow" />}
      {currentTab.value === "Create" && <Create key="create" />}
      {currentTab.value === "Settings" && <InnerSettings key="settings" />}
    </AnimatePresence>
  )
}


export function Settings() {
  return (
    <motion.div
      className={clsx(
        "fixed top-1/2 right-8 w-[20rem] h-full max-h-[32rem]",
        "flex flex-col glass bg-white/50 rounded"
      )}
      initial={{ x: "120%", y: "-50%" }}
      animate={{ x: "0%", y: "-50%" }}
      exit={{ x: "120%", y: "-50%" }}
      transition={{ duration: 0.8, type: "spring" }}
    >
      <Tabs />
      <div className="flex-1 relative overflow-hidden z-0">
        <TabContent />
      </div>
    </motion.div>
  )
}
