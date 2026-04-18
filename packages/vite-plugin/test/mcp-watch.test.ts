import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import llui from '../src/index'

/**
 * Tests the configureServer hook that exposes /__llui_mcp_status (middleware
 * served from the active marker file written by `@llui/mcp`) and dispatches
 * `llui:mcp-ready` HMR events on connection / file watch fire.
 *
 * The marker file lives at the workspace root — same logic the plugin uses —
 * so the test resolves it the same way.
 */

function findWorkspaceRoot(start: string = process.cwd()): string {
  let dir = resolve(start)
  let lastPackageJson: string | null = null
  while (true) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return dir
    if (existsSync(resolve(dir, '.git'))) return dir
    if (existsSync(resolve(dir, 'package.json'))) lastPackageJson = dir
    const parent = dirname(dir)
    if (parent === dir) return lastPackageJson ?? start
    dir = parent
  }
}

const ACTIVE_PATH = resolve(findWorkspaceRoot(), 'node_modules/.cache/llui-mcp/active.json')

interface SentEvent {
  type: string
  event?: string
  data?: unknown
}

type MiddlewareHandler = (
  req: { url?: string },
  res: {
    statusCode: number
    setHeader: (k: string, v: string) => void
    end: (body?: string) => void
  },
) => void

interface FakeServer {
  ws: {
    send: (msg: SentEvent) => void
    on: (event: string, cb: () => void) => void
    onConnection: (() => void) | null
  }
  middlewares: {
    use: (path: string, handler: MiddlewareHandler) => void
    handlers: Map<string, MiddlewareHandler>
  }
  httpServer: {
    on: (event: string, cb: () => void) => void
    once: (event: string, cb: () => void) => void
    address: () => { address: string; port: number; family: string } | null
    closeHandlers: Array<() => void>
    listeningHandlers: Array<() => void>
  } | null
  sent: SentEvent[]
}

function makeFakeServer(): FakeServer {
  const sent: SentEvent[] = []
  const handlers = new Map<string, MiddlewareHandler>()
  const closeHandlers: Array<() => void> = []
  const listeningHandlers: Array<() => void> = []
  const server: FakeServer = {
    sent,
    ws: {
      send: (msg) => sent.push(msg),
      on: (event, cb) => {
        if (event === 'connection') server.ws.onConnection = cb
      },
      onConnection: null,
    },
    middlewares: {
      handlers,
      use: (path, handler) => {
        handlers.set(path, handler)
      },
    },
    httpServer: {
      closeHandlers,
      listeningHandlers,
      on: (event, cb) => {
        if (event === 'close') closeHandlers.push(cb)
      },
      once: (event, cb) => {
        if (event === 'listening') listeningHandlers.push(cb)
      },
      // Default fake address — tests that care override via a separate helper.
      address: () => ({ address: '127.0.0.1', port: 5173, family: 'IPv4' }),
    },
  }
  return server
}

// Fire the fake httpServer's close handlers so the plugin's registered
// cleanup (fs.watch close, poll interval clear) actually runs. Without
// this, each test would leak a directory watcher and eventually hit
// EMFILE on macOS.
function closeFakeServer(server: FakeServer): void {
  const handlers = server.httpServer?.closeHandlers ?? []
  for (const cb of handlers) cb()
}

interface MockResponse {
  statusCode: number
  body: string
  headers: Map<string, string>
}

function callMiddleware(server: FakeServer, path: string): MockResponse {
  const handler = server.middlewares.handlers.get(path)
  if (!handler) throw new Error(`no middleware registered for ${path}`)
  const res: MockResponse = { statusCode: 0, body: '', headers: new Map() }
  handler(
    { url: path },
    {
      get statusCode() {
        return res.statusCode
      },
      set statusCode(v: number) {
        res.statusCode = v
      },
      setHeader: (k, v) => res.headers.set(k.toLowerCase(), v),
      end: (body) => {
        res.body = body ?? ''
      },
    },
  )
  return res
}

function ensureMarkerDir(): void {
  mkdirSync(dirname(ACTIVE_PATH), { recursive: true })
}

function removeMarker(): void {
  if (existsSync(ACTIVE_PATH)) unlinkSync(ACTIVE_PATH)
}

describe('vite-plugin: /__llui_mcp_status middleware', () => {
  const activeServers: FakeServer[] = []

  beforeEach(() => {
    removeMarker()
    ensureMarkerDir()
  })

  afterEach(() => {
    // Drain any servers created this test — fires the close handlers
    // so the plugin's fs.watch watchers and poll intervals are released.
    // Leaking these causes EMFILE on macOS when the full suite runs.
    for (const s of activeServers) closeFakeServer(s)
    activeServers.length = 0
    removeMarker()
  })

  function setup(opts: { mcpPort?: number | false } = { mcpPort: 5200 }): FakeServer {
    const plugin = llui(opts)
    // configResolved now resolves mcpPort (explicit value wins; undefined
    // auto-detects). Must run before configureServer so the port is set.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(plugin as any).configResolved?.call(plugin, { root: process.cwd(), command: 'serve' })
    const fake = makeFakeServer()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(plugin as any).configureServer?.call(plugin, fake)
    activeServers.push(fake)
    return fake
  }

  it('returns 200 + port when the marker file exists (mcpPort set)', () => {
    writeFileSync(ACTIVE_PATH, JSON.stringify({ port: 5200, pid: 1 }))

    const fake = setup({ mcpPort: 5200 })
    const res = callMiddleware(fake, '/__llui_mcp_status')
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ port: 5200 })
    expect(res.headers.get('content-type')).toBe('application/json')
  })

  it('returns 404 when the marker file does not exist', () => {
    const fake = setup({ mcpPort: 5200 })
    const res = callMiddleware(fake, '/__llui_mcp_status')
    expect(res.statusCode).toBe(404)
  })

  it('reads the port dynamically — picks up changes after configureServer', () => {
    const fake = setup({ mcpPort: 5200 })
    // Initially absent → 404
    expect(callMiddleware(fake, '/__llui_mcp_status').statusCode).toBe(404)

    // Marker appears (MCP started after Vite)
    writeFileSync(ACTIVE_PATH, JSON.stringify({ port: 5310, pid: 9999 }))
    const res = callMiddleware(fake, '/__llui_mcp_status')
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ port: 5310 })

    // Marker removed (MCP stopped)
    removeMarker()
    expect(callMiddleware(fake, '/__llui_mcp_status').statusCode).toBe(404)
  })

  it('does not register the middleware when mcpPort: false', () => {
    writeFileSync(ACTIVE_PATH, JSON.stringify({ port: 5200, pid: 1 }))
    const fake = setup({ mcpPort: false })
    expect(fake.middlewares.handlers.has('/__llui_mcp_status')).toBe(false)
  })

  it('does not register the middleware by default (opt-in)', () => {
    writeFileSync(ACTIVE_PATH, JSON.stringify({ port: 5200, pid: 1 }))
    // No explicit mcpPort — should default to disabled
    const plugin = llui()
    const fake = makeFakeServer()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(plugin as any).configureServer?.call(plugin, fake)
    expect(fake.middlewares.handlers.has('/__llui_mcp_status')).toBe(false)
  })

  it('handles a malformed marker file gracefully (treats as missing)', () => {
    writeFileSync(ACTIVE_PATH, 'not json at all')

    const fake = setup({ mcpPort: 5200 })
    const res = callMiddleware(fake, '/__llui_mcp_status')
    expect(res.statusCode).toBe(404)
  })

  it('sends llui:mcp-ready HMR event when a client connects after the marker exists', () => {
    writeFileSync(ACTIVE_PATH, JSON.stringify({ port: 5200, pid: 1 }))

    const fake = setup({ mcpPort: 5200 })
    expect(fake.sent).toHaveLength(0)

    // Simulate the HMR client connecting
    fake.ws.onConnection?.()

    const ready = fake.sent.find((m) => m.event === 'llui:mcp-ready')
    expect(ready).toBeDefined()
    expect(ready?.data).toEqual({ port: 5200 })
  })

  it('does not send llui:mcp-ready on connection when marker is absent', () => {
    const fake = setup({ mcpPort: 5200 })
    fake.ws.onConnection?.()

    const ready = fake.sent.find((m) => m.event === 'llui:mcp-ready')
    expect(ready).toBeUndefined()
  })

  it('stamps devUrl into an existing marker file when the httpServer emits listening', () => {
    // MCP started first (marker present without devUrl). Vite then begins
    // listening: the listening-hook must read, mutate, and persist the
    // marker so downstream consumers can navigate Playwright to the URL.
    writeFileSync(ACTIVE_PATH, JSON.stringify({ port: 5200, pid: 123 }))

    const fake = setup({ mcpPort: 5200 })
    expect(fake.httpServer?.listeningHandlers.length).toBe(1)

    // Fire the listening handlers registered by the plugin.
    for (const cb of fake.httpServer?.listeningHandlers ?? []) cb()

    const marker = JSON.parse(readFileSync(ACTIVE_PATH, 'utf8')) as {
      port: number
      pid: number
      devUrl?: string
    }
    // Fake `address()` returns 127.0.0.1:5173; plugin preserves non-wildcard
    // hosts verbatim, so we expect that exact URL.
    expect(marker.port).toBe(5200)
    expect(marker.pid).toBe(123)
    expect(marker.devUrl).toBe('http://127.0.0.1:5173')
  })

  it('stamps devUrl into the marker when it appears after the listening event (MCP starts after Vite)', () => {
    // Marker does NOT exist when Vite begins listening. The plugin should
    // cache the URL, then — when the marker later appears via the watcher
    // firing — stamp devUrl into it. Without this, the MCP-after-Vite
    // workflow leaves devUrl permanently unset.
    const fake = setup({ mcpPort: 5200 })
    expect(fake.httpServer?.listeningHandlers.length).toBe(1)

    // Fire the listening handlers BEFORE the marker exists.
    for (const cb of fake.httpServer?.listeningHandlers ?? []) cb()

    // Marker is still absent — the listening hook must be a no-op on the
    // filesystem when no marker exists (it only caches the URL internally).
    expect(existsSync(ACTIVE_PATH)).toBe(false)
  })

  it('broadcasts devUrl via HMR after stamping from the listening hook (no reliance on fs.watch)', () => {
    // Issue 2 fix: once the listening hook has stamped devUrl into an
    // existing marker, the plugin must call notifyMcpReady() so the
    // browser learns the URL through the HMR channel — don't rely on an
    // incidental fs.watch tick (which can miss on NFS/SMB).
    writeFileSync(ACTIVE_PATH, JSON.stringify({ port: 5200, pid: 1 }))

    const fake = setup({ mcpPort: 5200 })
    // Drop any ready events that might have been sent during setup so we
    // can assert the listening-hook broadcast in isolation.
    fake.sent.length = 0

    for (const cb of fake.httpServer?.listeningHandlers ?? []) cb()

    const ready = fake.sent.find((m) => m.event === 'llui:mcp-ready')
    expect(ready).toBeDefined()
    expect(ready?.data).toEqual({ port: 5200, devUrl: 'http://127.0.0.1:5173' })
  })

  it('stamps devUrl when the marker is created after listening fires (dirWatcher path)', async () => {
    // Full MCP-after-Vite integration: listening fires with no marker,
    // the plugin caches the URL, then MCP later writes the marker. The
    // parent-directory watcher must detect the creation, call
    // stampDevUrl(), and notify HMR with the devUrl attached.
    const fake = setup({ mcpPort: 5200 })
    // Fire listening first, while marker absent.
    for (const cb of fake.httpServer?.listeningHandlers ?? []) cb()
    expect(existsSync(ACTIVE_PATH)).toBe(false)
    fake.sent.length = 0

    // MCP now writes the marker without devUrl.
    writeFileSync(ACTIVE_PATH, JSON.stringify({ port: 5200, pid: 42 }))

    // Wait for fs.watch to fire — poll up to ~500ms.
    const deadline = Date.now() + 500
    while (Date.now() < deadline) {
      const marker = JSON.parse(readFileSync(ACTIVE_PATH, 'utf8')) as { devUrl?: string }
      if (marker.devUrl === 'http://127.0.0.1:5173') break
      await new Promise((r) => setTimeout(r, 20))
    }

    const marker = JSON.parse(readFileSync(ACTIVE_PATH, 'utf8')) as {
      port: number
      pid: number
      devUrl?: string
    }
    expect(marker.devUrl).toBe('http://127.0.0.1:5173')
    expect(marker.port).toBe(5200)
    expect(marker.pid).toBe(42)

    // The dirWatcher-triggered notification should carry the stamped devUrl.
    const ready = fake.sent.find((m) => m.event === 'llui:mcp-ready')
    expect(ready).toBeDefined()
    expect(ready?.data).toEqual({ port: 5200, devUrl: 'http://127.0.0.1:5173' })
  })
})
