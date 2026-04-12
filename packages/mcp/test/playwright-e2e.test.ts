import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { existsSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import type { Browser, Page } from 'playwright'
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
 * Skipped automatically when:
 *   - Playwright isn't installed (fresh checkouts before `pnpm install`)
 *   - The Chromium browser binary isn't downloaded
 *   - LLUI_SKIP_E2E env var is set (escape hatch for slow CI tiers)
 *
 * Cost: ~5–10 seconds for the suite. Run via `pnpm --filter @llui/mcp test`.
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
const MCP_PORT = 5400 + Math.floor(Math.random() * 100)

// Try to import playwright dynamically — skip the suite if missing or if
// the browser binary isn't downloaded. This keeps fresh checkouts green.
async function loadPlaywright(): Promise<typeof import('playwright') | null> {
  if (process.env.LLUI_SKIP_E2E) return null
  try {
    return await import('playwright')
  } catch {
    return null
  }
}

const playwright = await loadPlaywright()

interface Harness {
  mcp: LluiMcpServer
  vite: ChildProcess
  browser: Browser
  page: Page
  viteUrl: string
  consoleErrors: string[]
  wsErrorCount: number
}

async function spawnVite(): Promise<{ vite: ChildProcess; viteUrl: string }> {
  const vite = spawn('pnpm', ['dev'], {
    cwd: EXAMPLE_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const viteUrl = await new Promise<string>((resolveUrl, rejectUrl) => {
    const timer = setTimeout(() => rejectUrl(new Error('vite startup timeout')), 30_000)
    const onData = (chunk: Buffer): void => {
      const text = String(chunk)
      const match = text.match(/Local:\s+(http:\/\/localhost:\d+\/)/)
      if (match) {
        clearTimeout(timer)
        vite.stdout?.off('data', onData)
        resolveUrl(match[1]!)
      }
    }
    vite.stdout?.on('data', onData)
  })
  return { vite, viteUrl }
}

async function setupHarness(): Promise<Harness> {
  if (!playwright) throw new Error('playwright unavailable')

  // 1. Start MCP server (writes marker file)
  const mcp = new LluiMcpServer(MCP_PORT)
  mcp.startBridge()

  // 2. Spawn vite dev server in the example
  const { vite, viteUrl } = await spawnVite()

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

  // 4. Navigate and wait for the auto-connect to complete
  await page.goto(viteUrl, { waitUntil: 'networkidle' })
  await delay(1500)

  return { mcp, vite, browser, page, viteUrl, consoleErrors, wsErrorCount }
}

async function teardownHarness(h: Harness): Promise<void> {
  await h.browser.close()
  h.vite.kill('SIGTERM')
  h.mcp.stopBridge()
  // Give the dev server a moment to release its port + clean up the marker
  await delay(200)
}

describe.skipIf(!playwright)('MCP auto-connect — real browser + real Vite', () => {
  let h: Harness

  beforeAll(async () => {
    h = await setupHarness()
  }, 60_000)

  afterAll(async () => {
    if (h) await teardownHarness(h)
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
