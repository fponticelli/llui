import { defineConfig } from 'vite'
import llui from '@llui/vite-plugin'

export default defineConfig({
  plugins: [llui()],
  build: {
    target: 'es2022',
    minify: true,
    modulePreload: { polyfill: false },
    lib: {
      entry: 'src/main.ts',
      formats: ['es'],
      fileName: () => 'main.js',
    },
    outDir: 'dist',
  },
})
