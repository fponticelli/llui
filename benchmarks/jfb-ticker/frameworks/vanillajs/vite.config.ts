import { defineConfig } from 'vite'

export default defineConfig({
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
    },
  },
})
