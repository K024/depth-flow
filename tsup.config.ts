import path from 'path'
import { readFile } from 'fs/promises'
import type { Plugin } from 'esbuild'
import { defineConfig } from 'tsup'


export default defineConfig({
  entry: ['package/index.ts'],
  outDir: 'package/dist',
  format: ['esm', 'cjs'],
  dts: true,
  esbuildPlugins: [rawPlugin()],
})


/**
 * MIT License
 * Copyright (c) 2021 Hannoeru <me@hanlee.co>
 * https://github.com/hannoeru/esbuild-plugin-raw
 */
function rawPlugin(): Plugin {
  return {
    name: 'raw',
    setup(build) {
      build.onResolve({ filter: /\?raw$/ }, (args) => {
        return {
          namespace: 'raw-loader',
          path: args.path,
          pluginData: {
            isAbsolute: path.isAbsolute(args.path),
            resolveDir: args.resolveDir,
          },
        }
      })
      build.onLoad({ filter: /\?raw$/, namespace: 'raw-loader' }, async (args) => {
        const fullPath = args.pluginData.isAbsolute ? args.path : path.join(args.pluginData.resolveDir, args.path)
        return {
          loader: 'text',
          contents: await readFile(fullPath.replace(/\?raw$/, ''), 'utf8'),
        }
      })
    },
  }
}
