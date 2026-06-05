import { defineConfig } from 'vite'

// This demo composes precompiled LLui library components (the editor and its
// plugins ship already-lowered in their dist) and authors none of its own, so
// the @llui/vite-plugin compiler is not needed here. Apps that author their own
// `component()` views with reactive bindings should add it (see other examples).
export default defineConfig({
  build: {
    target: 'es2022',
    minify: true,
    modulePreload: { polyfill: false },
  },
})
