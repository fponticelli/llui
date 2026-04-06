import { defineConfig } from 'vite'
import llui from '@llui/vite-plugin'
import vike from 'vike/plugin'

export default defineConfig({
  plugins: [llui(), vike({ prerender: true })],
})
