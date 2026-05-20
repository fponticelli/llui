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
      // Exclude devtools — it's behind import.meta.env.DEV which is false in prod
      external: [/devtools/],
    },
  },
})
