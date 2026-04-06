import { defineConfig } from 'vite'
import llui from '@llui/vite-plugin'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [llui(), tailwindcss()],
  build: {
    target: 'es2022',
    minify: true,
    modulePreload: { polyfill: false },
  },
})
