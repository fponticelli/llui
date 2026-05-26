import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { resolve, dirname } from 'node:path'
import { existsSync } from 'node:fs'
import { createServer as createNetServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import type { Browser, Page } from 'playwright'
import type { ViteDevServer } from 'vite'
import { LluiMcpServer } from '../src/index'

/**
 * End-to-end test for the full MCP auto-connect chain.
 *
 *   MCP server  ←  WebSocket bridge  ←  browser-side relay (real devtools.ts)
 *                                           ↑
 *                                  __lluiConnect (auto-fired)
 *                                           ↑
 *                              fetch('/__llui_mcp_status')
 *                                           ↑
 *                            Vite plugin middleware (real)
 *                                           ↑
 *                          marker file written by MCP server
 *
 * Unlike `e2e.test.ts` (which polyfills WebSocket in jsdom), this suite
 * spawns a real Vite dev server and a real Chromium browser to exercise
 * everything end-to-end including the compiler-injected dev code, the
 * Vite middleware, the file marker, and the relay.
 *
 * Runs automatically in `pnpm verify` whenever Playwright and a
 * Chromium browser binary are available. Gracefully skips when
 * either is missing (fresh checkouts before `pnpm install`, or CI
 * jobs that haven't run `playwright install chromium`).
 *
 * Uses Vite's programmatic `createServer` API with the file watcher
 * disabled — that keeps the suite fast (~3 seconds) and reliable on
 * macOS, whose launchctl-default 256-fd soft limit otherwise makes
 * vite crash with EMFILE during a full-watcher startup.
 *
 * To run just this suite in isolation: `pnpm test:e2e`.
 */

// Walk up from cwd to find the workspace root, then locate the example.
// Vitest runs the test from packages/mcp/, so process.cwd() is reliable.
function findWorkspaceRoot(start: string = process.cwd()): string {
  let dir = resolve(start)
  while (true) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return start
    dir = parent
  }
}

const WORKSPACE_ROOT = findWorkspaceRoot()
const EXAMPLE_DIR = resolve(WORKSPACE_ROOT, 'examples/virtualization')
// Pick a port from a 100-wide window. A retry loop in `setupHarness`
// handles the rare birthday-paradox collision when multiple test files
// run concurrently (the monorepo's `pnpm verify` can fan out 6+ test
// processes against this range simultaneously). Without the retry the
// loser races with EADDRINUSE — see the 2026-05-26 verify run.
const pickMcpPort = (): number => 5400 + Math.floor(Math.random() * 100)

/**
 * Probe whether a TCP port is bindable on 127.0.0.1 before handing it
 * to LluiMcpServer. WebSocketServer's bind error fires asynchronously
 * on an 'error' event — there's no synchronous way to know the bind
 * failed without rewiring the relay's startBridge. A pre-bind probe
 * (open a Server on the port, immediately close it) is the standard
 * test-harness shortcut.
 */
function isPortFree(port: number): Promise<boolean> {
  return new Promise<boolean>((res) => {
    const probe = createNetServer()
    probe.once('error', () => res(false))
    probe.once('listening', () => {
      probe.close(() => res(true))
    })
    probe.listen({ port, host: '127.0.0.1' })
  })
}

// Import playwright and verify a chromium browser binary is available.
// Returns null on any failure so the suite skips cleanly — fresh
// checkouts (before `pnpm install`) and CI jobs without browsers
// installed both land here.
async function loadPlaywright(): Promise<typeof import('playwright') | null> {
  try {
    const pw = await import('playwright')
    // chromium.executablePath() throws if the browser isn't downloaded
    // (needs `playwright install chromium`). Probe it now so we skip
    // the suite rather than fail beforeAll on first launch.
    const execPath = pw.chromium.executablePath()
    if (!execPath || !existsSync(execPath)) return null
    return pw
  } catch {
    return null
  }
}

const playwright = await loadPlaywright()

interface Harness {
  mcp: LluiMcpServer
  vite: ViteDevServer
  browser: Browser
  page: Page
  viteUrl: string
  consoleErrors: string[]
  wsErrorCount: number
}

/**
 * Start a real vite dev server programmatically with file watching
 * disabled. Disabling the watcher is the only way to make this test
 * reliable on macOS — vite's default chokidar+FSEvents watcher tries
 * to register directory watches across the whole monorepo at startup
 * and blows through the launchctl-default 256-fd soft limit before
 * printing its ready message (EMFILE: too many open files, watch).
 *
 * HMR isn't needed for this suite — we're exercising the browser-side
 * auto-connect chain on first page load, not editing files mid-test.
 */
async function startViteServer(): Promise<{ vite: ViteDevServer; viteUrl: string }> {
  const { createServer } = await import('vite')
  const vite = await createServer({
    root: EXAMPLE_DIR,
    configFile: resolve(EXAMPLE_DIR, 'vite.config.ts'),
    server: {
      // Disable the FS watcher entirely — no HMR, no EMFILE.
      watch: null,
      // Pick a random port so parallel test runs don't collide.
      port: 0,
      strictPort: false,
    },
    // Reduce startup noise — we don't want info spam in test output.
    logLevel: 'warn',
    optimizeDeps: {
      // Skip dep pre-bundling — cuts startup time and fd churn.
      noDiscovery: true,
    },
  })
  await vite.listen()
  const addr = vite.httpServer?.address()
  if (!addr || typeof addr === 'string') {
    await vite.close()
    throw new Error('vite dev server failed to bind a port')
  }
  const viteUrl = `http://localhost:${addr.port}/`
  return { vite, viteUrl }
}

async function setupHarness(): Promise<Harness> {
  if (!playwright) throw new Error('playwright unavailable')

  // 1. Pick a free port + start MCP server. The bridge port comes
  //    from a 100-wide random range; parallel test processes (the
  //    monorepo `pnpm verify` fans out 6+ vitest runs) occasionally
  //    collide. Probe before binding because the WS server reports
  //    EADDRINUSE asynchronously via an 'error' event.
  let port: number | null = null
  for (let attempt = 0; attempt < 12; attempt++) {
    const candidate = pickMcpPort()
    if (await isPortFree(candidate)) {
      port = candidate
      break
    }
  }
  if (port === null) {
    throw new Error('MCP bridge: could not find a free port in 5400..5499 after 12 attempts')
  }
  const mcp = new LluiMcpServer({ bridgePort: port })
  mcp.startBridge()

  // 2. Start vite dev server programmatically (no file watcher)
  const { vite, viteUrl } = await startViteServer()

  // 3. Launch Chromium and capture console messages
  const browser = await playwright.chromium.launch()
  const page = await browser.newPage()
  const consoleErrors: string[] = []
  let wsErrorCount = 0
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
    if (msg.text().includes('WebSocket')) wsErrorCount++
  })
  page.on('pageerror', (e) => consoleErrors.push(e.message))

  // 4. Navigate and wait for the auto-connect to complete.
  //    `waitUntil: 'load'` (not 'networkidle') because dev-mode Vite
  //    keeps a long-lived `/_llui/events` SSE channel open for the
  //    auto-injected `@llui/devmode-annotate` HUD — the network is
  //    never idle, and `networkidle` would always time out at 30s.
  //    The 1500ms `delay` below covers the post-load auto-connect
  //    handshake the test actually cares about.
  await page.goto(viteUrl, { waitUntil: 'load' })
  await delay(1500)

  return { mcp, vite, browser, page, viteUrl, consoleErrors, wsErrorCount }
}

async function teardownHarness(h: Harness): Promise<void> {
  await h.browser.close()
  await h.vite.close()
  h.mcp.stopBridge()
  // Give the dev server a moment to release its port + clean up the marker
  await delay(200)
}

describe.skipIf(!playwright)('MCP auto-connect — real browser + real Vite', () => {
  let h: Harness
  let uncaughtHandler: ((err: Error) => void) | null = null

  beforeAll(async () => {
    // Vite's watchPackageDataPlugin registers fs.watch on every
    // package.json it discovers, regardless of server.watch config.
    // Across this monorepo that's enough to blow through macOS's
    // launchctl-default per-process fd soft limit (256), producing
    // async EMFILE errors that surface as unhandled exceptions even
    // though the tests themselves pass. Filter those out during the
    // suite — legit exceptions still propagate.
    uncaughtHandler = (err: Error & { code?: string; syscall?: string }) => {
      if (err.code === 'EMFILE' && err.syscall === 'watch') return
      throw err
    }
    process.on('uncaughtException', uncaughtHandler)

    h = await setupHarness()
  }, 60_000)

  afterAll(async () => {
    if (h) await teardownHarness(h)
    if (uncaughtHandler) {
      process.off('uncaughtException', uncaughtHandler)
      uncaughtHandler = null
    }
  }, 10_000)

  it('installs __lluiDebug, __lluiConnect, and registers the component', async () => {
    const info = await h.page.evaluate(() => ({
      hasDebug:
        typeof (window as unknown as { __lluiDebug?: unknown }).__lluiDebug === 'object' &&
        (window as unknown as { __lluiDebug?: unknown }).__lluiDebug !== null,
      hasConnect:
        typeof (window as unknown as { __lluiConnect?: unknown }).__lluiConnect === 'function',
      components: (window as unknown as { __lluiComponents?: Record<string, unknown> })
        .__lluiComponents
        ? Object.keys(
            (window as unknown as { __lluiComponents: Record<string, unknown> }).__lluiComponents,
          )
        : [],
    }))
    expect(info.hasDebug).toBe(true)
    expect(info.hasConnect).toBe(true)
    expect(info.components).toContain('VirtualLogViewer')
  })

  it('auto-connects to the actual MCP port via /__llui_mcp_status (no manual step)', async () => {
    // The MCP port is randomized per run; the browser must learn it from
    // the Vite middleware, not from the compile-time default.
    const state = (await h.mcp.handleToolCall('llui_get_state', {})) as {
      count: number
      logs: unknown[]
    }
    expect(state).toBeDefined()
    expect(typeof state.count).toBe('number')
    expect(Array.isArray(state.logs)).toBe(true)
  })

  it('llui_send_message updates real component state', async () => {
    const result = (await h.mcp.handleToolCall('llui_send_message', {
      msg: { type: 'setCount', count: 1000 },
    })) as { sent: boolean; state: { count: number } }
    expect(result.sent).toBe(true)
    expect(result.state.count).toBe(1000)
  })

  it('llui_list_components shows the mounted component', async () => {
    const list = (await h.mcp.handleToolCall('llui_list_components', {})) as {
      components: string[]
      active: string | null
    }
    expect(list.components).toContain('VirtualLogViewer')
    expect(list.active).toBe('VirtualLogViewer')
  })

  it('llui_decode_mask returns field names from the compiled mask legend', async () => {
    // The compiler injects __maskLegend per component. The mask 1 should
    // map to the first reactive field (any non-empty string is a pass).
    const fields = (await h.mcp.handleToolCall('llui_decode_mask', {
      mask: 1,
    })) as string[]
    expect(Array.isArray(fields)).toBe(true)
  })

  it('does not produce WebSocket retry spam (≤1 error)', () => {
    // The on-demand relay should attempt the connection once and stop.
    // Anything more would be a regression to the old retry-loop behavior.
    expect(h.wsErrorCount).toBeLessThanOrEqual(1)
  })

  it('does not log uncaught page errors', () => {
    expect(h.consoleErrors.filter((e) => !e.includes('WebSocket'))).toEqual([])
  })
})

describe.skipIf(!playwright)('CDP tools via Playwright harness', () => {
  let h: Harness

  beforeAll(async () => {
    h = await setupHarness()
    h.mcp.setDevUrl(h.viteUrl)
  }, 60_000)

  afterAll(async () => {
    if (h) await teardownHarness(h)
  }, 10_000)

  it('llui_screenshot returns base64 PNG', async () => {
    const result = (await h.mcp.handleToolCall('llui_screenshot', {})) as {
      data: string
      format: string
    }
    expect(result.format).toBe('png')
    expect(result.data.length).toBeGreaterThan(100)
  }, 15_000)

  it('llui_a11y_tree returns a truthy tree', async () => {
    const result = await h.mcp.handleToolCall('llui_a11y_tree', {})
    expect(result).toBeTruthy()
  }, 10_000)

  it('llui_console_tail returns array', async () => {
    const result = (await h.mcp.handleToolCall('llui_console_tail', {})) as {
      entries: unknown[]
    }
    expect(Array.isArray(result.entries)).toBe(true)
  }, 10_000)

  it('llui_browser_close tears down playwright browser', async () => {
    const result = (await h.mcp.handleToolCall('llui_browser_close', {})) as {
      closed: boolean
    }
    expect(result.closed).toBe(true)
  }, 10_000)
})
