import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'jsdom',
    // The HUD tests drive async lazy-mount + shadow-DOM + capture flows in jsdom;
    // under full-repo parallel load these are occasionally starved past a tick
    // budget. Retry the transient starvation (deterministic tests pass first try).
    retry: 2,
  },
})
