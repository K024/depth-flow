import path from "node:path"
import { rm } from "node:fs/promises"
import { defineConfig } from "vite"
import dts from "unplugin-dts/vite"


export default defineConfig({
  publicDir: false,
  plugins: [
    cleanPackageDist(),
    dts({
      include: [
        "package/index.ts",
        "src/depth-flow/**/*.ts",
        "src/vite-env.d.ts",
      ],
      entryRoot: ".",
      outDirs: "package/dist/types",
    }),
  ],
  build: {
    outDir: "package/dist",
    emptyOutDir: false,
    minify: false,
    sourcemap: true,
    lib: {
      entry: path.resolve(import.meta.dirname, "package/index.ts"),
    },
    rolldownOptions: {
      external: ["fflate", "twgl.js"],
      output: [
        {
          dir: "package/dist/esm",
          format: "es",
          preserveModules: true,
          preserveModulesRoot: ".",
          entryFileNames: "[name].mjs",
        },
        {
          dir: "package/dist/cjs",
          format: "cjs",
          preserveModules: true,
          preserveModulesRoot: ".",
          entryFileNames: "[name].cjs",
        },
      ],
    },
  },
})


function cleanPackageDist() {
  return {
    name: "clean-package-dist",
    async configResolved() {
      await rm(path.resolve(import.meta.dirname, "package/dist"), {
        recursive: true,
        force: true,
      })
    },
  }
}
