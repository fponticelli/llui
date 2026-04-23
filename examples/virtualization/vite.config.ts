import { defineConfig } from 'vite'
import llui from '@llui/vite-plugin'

export default defineConfig({
  // Enable MCP opt-in for the playwright e2e test that validates the
  // browser-side auto-connect.
  plugins: [llui({ mcpPort: 5200 })],
  build: { target: 'es2022', modulePreload: { polyfill: false } },
})
