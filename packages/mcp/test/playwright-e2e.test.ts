import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { resolve, dirname } from 'node:path'
import { existsSync } from 'node:fs'
import type { Browser, Page } from 'playwright'
import type { ViteDevServer } from 'vite'
import { LluiMcpServer } from '../src/index'
import { useHermeticBrowser } from '../../../scripts/lib/hermetic-browser.mjs'

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
const hermetic = useHermeticBrowser()

interface Harness {
  mcp: LluiMcpServer
  vite: ViteDevServer
  browser: Browser
  page: Page
  viteUrl: string
  /** The bridge port the page's relay reported connecting to. */
  relayPort: number
  /** LIVE: every console error / page error the harness page has logged. */
  consoleErrors: string[]
  /** LIVE: every console line mentioning `WebSocket` the page has logged. */
  wsMessages: string[]
}

/** The line `startRelay`'s `onopen` logs (`packages/dom/src/signals/devtools.ts`). */
const RELAY_CONNECTED = /^\[LLui MCP\] connected to ws:\/\/127\.0\.0\.1:(\d+)$/

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

/**
 * Everything a harness has started, in start order. `teardownHarness` stops it
 * in reverse — including after a setup that failed PARTWAY, which is the case
 * that matters: a `beforeAll` that times out waiting for the relay abandons
 * `setupHarness` mid-flight, and a Vite server, a bridge and a Chromium that
 * nobody closes keep the worker alive long after the file has failed.
 */
type Owned = Array<() => Promise<void> | void>

async function setupHarness(owned: Owned): Promise<Harness> {
  if (!playwright) throw new Error('playwright unavailable')

  // 1. Start the MCP server on an OS-assigned port. This used to draw
  //    from a 100-wide random window behind a probe-then-bind retry loop,
  //    which is a race by construction: parallel runs (the monorepo's
  //    `pnpm verify` fans out 6+ vitest processes) still lost the port
  //    between the probe and the bind. `bridgePort: 0` cannot collide,
  //    and `startBridge()` resolves once the port is knowable — which is
  //    also what the browser must learn, via the marker file the Vite
  //    plugin serves from `/__llui_mcp_status`.
  const mcp = new LluiMcpServer({ bridgePort: 0 })
  owned.push(() => mcp.stopBridge())
  await mcp.startBridge()

  // 2. Start vite dev server programmatically (no file watcher)
  const { vite, viteUrl } = await startViteServer()
  owned.push(() => vite.close())

  // 3. Launch Chromium and capture console messages
  const browser = await hermetic.launch()
  owned.push(() => browser.close())
  const page = await browser.newPage()
  const consoleErrors: string[] = []
  const wsMessages: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
    if (msg.text().includes('WebSocket')) wsMessages.push(msg.text())
  })
  page.on('pageerror', (e) => consoleErrors.push(e.message))

  // 4. Navigate and wait for the auto-connect to COMPLETE — observed as the
  //    relay's own `onopen` line, armed before `goto` so it cannot be missed.
  //    The bridge's `ws` server registers the client in the same synchronous
  //    step that writes the 101, so by the time the page has seen `open` the
  //    server has the client and every tool call below is served.
  //
  //    This used to be a flat `delay(1500)` after `load`, under a describe-level
  //    `retry: 2`: a guess at how long the post-load status fetch + WS
  //    handshake takes, and the error counters were SNAPSHOTS taken at the end
  //    of it, so anything the page logged later was never checked.
  //
  //    No Playwright deadline of its own (`timeout: 0`): the wait is bounded by
  //    the `beforeAll`'s `hookTimeout`, the one budget for this fixture.
  //    `waitUntil: 'load'` (not 'networkidle') because dev-mode Vite keeps a
  //    long-lived `/_llui/events` SSE channel open for the auto-injected
  //    `@llui/devmode-annotate` HUD — the network is never idle.
  const connected = page.waitForEvent('console', {
    predicate: (msg) => RELAY_CONNECTED.test(msg.text()),
    timeout: 0,
  })
  await page.goto(viteUrl, { waitUntil: 'load' })
  const relayPort = Number(RELAY_CONNECTED.exec((await connected).text())![1])

  return { mcp, vite, browser, page, viteUrl, relayPort, consoleErrors, wsMessages }
}

async function teardownHarness(owned: Owned): Promise<void> {
  // Reverse start order: browser, then Vite, then the bridge (whose stop
  // removes the marker synchronously; its port was OS-assigned, so nothing can
  // collide with it later and there is nothing to wait out). Every step runs
  // even if an earlier one throws.
  const errors: unknown[] = []
  for (const stop of owned.splice(0).reverse()) {
    try {
      await stop()
    } catch (err) {
      errors.push(err)
    }
  }
  if (errors.length > 0) throw new AggregateError(errors, 'harness teardown failed')
}

describe.skipIf(!playwright)('MCP auto-connect — real browser + real Vite', () => {
  let h: Harness
  const owned: Owned = []
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

    h = await setupHarness(owned)
  })

  afterAll(async () => {
    await teardownHarness(owned)
    if (uncaughtHandler) {
      process.off('uncaughtException', uncaughtHandler)
      uncaughtHandler = null
    }
  })

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
    expect(h.relayPort).toBe(h.mcp.boundPort())
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

  it('does not advertise the legacy mask-introspection tools', () => {
    // decodeMask/getMaskLegend were legacy mask-legend introspection. The signal
    // runtime uses chunked masks and does not implement that surface, so the
    // tools backed by it are no longer registered (rather than advertised and
    // failing with an unknown-method error at call time).
    const names = h.mcp.getTools().map((t) => t.name)
    expect(names).not.toContain('llui_decode_mask')
    expect(names).not.toContain('llui_mask_legend')
    expect(names).not.toContain('llui_explain_mask')
  })

  it('does not produce WebSocket retry spam (≤1 error)', () => {
    // The on-demand relay should attempt the connection once and stop.
    // Anything more would be a regression to the old retry-loop behavior.
    // Read LIVE, at the end of the suite — not a snapshot from setup.
    expect(h.wsMessages.length).toBeLessThanOrEqual(1)
  })

  it('does not log uncaught page errors', () => {
    expect(h.consoleErrors.filter((e) => !e.includes('WebSocket'))).toEqual([])
  })
})

describe.skipIf(!playwright)('CDP tools via Playwright harness', () => {
  let h: Harness
  const owned: Owned = []

  beforeAll(async () => {
    h = await setupHarness(owned)
    h.mcp.setDevUrl(h.viteUrl)
  })

  afterAll(async () => {
    await teardownHarness(owned)
  })

  it('llui_screenshot returns base64 PNG', async () => {
    const result = (await h.mcp.handleToolCall('llui_screenshot', {})) as {
      data: string
      format: string
    }
    expect(result.format).toBe('png')
    expect(result.data.length).toBeGreaterThan(100)
  })

  it('llui_a11y_tree returns a truthy tree', async () => {
    const result = await h.mcp.handleToolCall('llui_a11y_tree', {})
    expect(result).toBeTruthy()
  })

  it('llui_console_tail returns array', async () => {
    const result = (await h.mcp.handleToolCall('llui_console_tail', {})) as {
      entries: unknown[]
    }
    expect(Array.isArray(result.entries)).toBe(true)
  })

  // The only test in the workspace that needs more than the shared 30 s
  // testTimeout, and for a reason no cheaper test can dodge: its whole body is
  // one `browser.close()`, and on a saturated machine that is a flat 30 s —
  // Chromium never finishes a graceful shutdown, so playwright waits out its
  // non-configurable `DEFAULT_PLAYWRIGHT_TIMEOUT` and SIGKILLs the process
  // group (measured 30.01 s, reproducible on a bare launch/close with no LLui
  // code in it). The shared budget is exactly at that floor, so state this one
  // explicitly rather than leave it sitting on the line.
  it('llui_browser_close tears down playwright browser', async () => {
    const result = (await h.mcp.handleToolCall('llui_browser_close', {})) as {
      closed: boolean
    }
    expect(result.closed).toBe(true)
  }, 45_000)
})
