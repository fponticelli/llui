import { defineConfig } from 'vite'
import llui from '@llui/vite-plugin'

export default defineConfig({
  plugins: [llui()],
  build: {
    target: 'es2022',
    minify: true,
    modulePreload: { polyfill: false },
    outDir: 'dist',
    rollupOptions: {
      input: 'src/main.ts',
      output: {
        format: 'es',
        entryFileNames: 'main.js',
        chunkFileNames: '[name].js',
        inlineDynamicImports: true,
      },
      // Do NOT externalize devtools — `installSignalDebug` is DEV-gated, so with
      // @llui/dom's `sideEffects: false` it tree-shakes out of this prod build.
      // Externalizing instead leaves a runtime `import '.../devtools.js'` that
      // 404s in a browser served from the bench root → nothing renders.
    },
  },
})
