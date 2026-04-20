import { defineConfig } from 'vite'
import llui from '@llui/vite-plugin'
import lintIdiomatic from '@llui/lint-idiomatic/vite'

export default defineConfig({
  plugins: [llui({ agent: true }), lintIdiomatic()],
  build: {
    target: 'es2022',
    minify: true,
    modulePreload: { polyfill: false },
  },
})
