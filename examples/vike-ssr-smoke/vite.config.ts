import { defineConfig } from 'vite'
import llui from '@llui/vite-plugin'
import vike from 'vike/plugin'

// Force `@llui/dom` (and its `/internal` subpath) to stay external in
// the server build. This is the codepath that produced issue #5's
// MISSING_EXPORT regression: the server chunk retains
// `import { … } from '@llui/dom'`, and any post-bundle rename of a
// name inside that specifier must match a real export. Vike's defaults
// inline workspace dependencies, which would hide the bug — this
// override forces the externalized path we need to exercise.
export default defineConfig({
  plugins: [llui(), vike()],
  build: {
    target: 'es2022',
  },
  ssr: {
    noExternal: [],
    external: ['@llui/dom', '@llui/dom/internal'],
  },
})
