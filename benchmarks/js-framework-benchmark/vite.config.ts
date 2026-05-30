import { defineConfig } from 'vite'
import llui from '@llui/vite-plugin'

export default defineConfig({
  plugins: [llui()],
  build: {
    target: 'es2022',
    minify: true,
    modulePreload: { polyfill: false },
    outDir: 'dist',
    // App-mode build (NOT lib mode). Vite's `build.lib` preserves
    // whitespace + `//#region` comments even with `minify: true` —
    // intended for library bundles that will be re-bundled
    // downstream. The bench bundle is served directly to Chrome, so
    // we want a fully minified single-line output.
    rollupOptions: {
      input: 'src/main.ts',
      output: {
        format: 'es',
        entryFileNames: 'main.js',
        chunkFileNames: '[name].js',
        inlineDynamicImports: true,
      },
      // Do NOT externalize devtools. `installSignalDebug` is called only behind
      // `import.meta.env.DEV` (false in this prod build), so with @llui/dom's
      // `sideEffects: false` it tree-shakes away entirely. Marking it `external`
      // instead LEAVES a runtime `import '../../../packages/dom/dist/.../devtools.js'`
      // in the bundle — a path that resolves on the FS (Node) but 404s in a browser
      // served from the bench root, so the module never loads and nothing renders.
    },
  },
})
