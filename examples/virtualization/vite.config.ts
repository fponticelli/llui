import { defineConfig } from 'vite'
import llui from '@llui/vite-plugin'
import lintIdiomatic from '@llui/lint-idiomatic/vite'

export default defineConfig({
  // Enable MCP opt-in for the playwright e2e test that validates the
  // browser-side auto-connect.
  plugins: [llui({ mcpPort: 5200 }), lintIdiomatic()],
  build: { target: 'es2022', modulePreload: { polyfill: false } },
})
