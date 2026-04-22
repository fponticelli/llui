import { defineConfig } from 'vite'
import llui from '@llui/vite-plugin'
import lintIdiomatic from '@llui/lint-idiomatic/vite'

export default defineConfig({
  plugins: [llui(), lintIdiomatic({ exclude: ['agent-nonextractable-handler'] })],
  build: {
    target: 'es2022',
    modulePreload: { polyfill: false },
  },
})
