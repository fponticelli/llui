import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    target: 'es2022',
    minify: true,
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].js',
      },
    },
  },
})
