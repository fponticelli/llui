import { defineConfig } from 'vite'
import llui from '@llui/vite-plugin'
import lintIdiomatic from '@llui/lint-idiomatic/vite'
import vike from 'vike/plugin'

export default defineConfig({
  plugins: [llui(), lintIdiomatic(), vike()],
  build: {
    target: 'es2022',
  },
})
