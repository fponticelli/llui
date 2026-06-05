import { defineConfig } from 'vite'
import llui from '@llui/vite-plugin'
import vike from 'vike/plugin'

export default defineConfig({
  // Vike's CLI wrapper rejects Vite's `--base`/`--outDir` flags, so the site's
  // build-examples step passes the embed sub-path + an out-of-tree output dir
  // via env vars instead (keeps the normal `dist/` build untouched).
  base: process.env.LLUI_BASE ?? '/',
  plugins: [llui(), vike()],
  build: {
    target: 'es2022',
    outDir: process.env.LLUI_OUT ?? 'dist',
  },
})
