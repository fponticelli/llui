import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // E2E test mounts a real component via mountApp which needs DOM globals.
    // Other tests don't depend on DOM but jsdom is harmless for them.
    environment: 'jsdom',
    // All MCP test files share the active marker file at the workspace root
    // (node_modules/.cache/llui-mcp/active.json). Running them in parallel
    // would race over the file path, so force sequential execution.
    fileParallelism: false,
  },
})
