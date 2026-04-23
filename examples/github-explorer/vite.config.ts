import { defineConfig } from 'vite'
import llui from '@llui/vite-plugin'

export default defineConfig({
  plugins: [llui({ agent: true })],
  build: {
    target: 'es2022',
    minify: true,
    modulePreload: { polyfill: false },
  },
})
