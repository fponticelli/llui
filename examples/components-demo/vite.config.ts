import { defineConfig } from 'vite'
import llui from '@llui/vite-plugin'
import lintIdiomatic from '@llui/lint-idiomatic/vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [llui(), lintIdiomatic(), tailwindcss()],
  build: {
    target: 'es2022',
    minify: true,
    modulePreload: { polyfill: false },
  },
})
