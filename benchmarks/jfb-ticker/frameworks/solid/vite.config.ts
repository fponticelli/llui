import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

export default defineConfig({
  plugins: [solid()],
  build: {
    target: 'es2022',
    minify: true,
    modulePreload: { polyfill: false },
    outDir: 'dist',
    rollupOptions: {
      input: 'src/main.tsx',
      output: {
        format: 'es',
        entryFileNames: 'main.js',
        chunkFileNames: '[name].js',
        inlineDynamicImports: true,
      },
    },
  },
})
