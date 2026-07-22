import { defineConfig, devices } from '@playwright/test'

// E2E for @llui/markdown-editor behaviours that jsdom cannot exercise faithfully
// — focus/blur-driven overlay dismissal and live markdown-shortcut transforms.
// The example app mounts the full editor (link + floating-toolbar + wikilink +
// block-drag), so it doubles as the fixture. `test:e2e` rebuilds the package
// first; the dev server below serves that fresh dist.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  use: {
    baseURL: 'http://localhost:5173',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
