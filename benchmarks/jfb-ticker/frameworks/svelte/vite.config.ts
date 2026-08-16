import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  plugins: [svelte()],
  build: {
    target: 'es2022',
    minify: true,
    modulePreload: { polyfill: false },
    outDir: 'dist',
    rolldownOptions: {
      input: 'src/main.ts',
      output: {
        format: 'es',
        entryFileNames: 'main.js',
        chunkFileNames: '[name].js',
        codeSplitting: false,
      },
    },
  },
})
