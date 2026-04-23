import { defineConfig } from 'vite'
import llui from '@llui/vite-plugin'

export default defineConfig({
  plugins: [llui()],
  build: { target: 'es2022', modulePreload: { polyfill: false } },
})
