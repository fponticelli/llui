import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, unlinkSync, existsSync, rmSync } from 'node:fs'
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
    closeHandlers: Array<() => void>
  } | null
  sent: SentEvent[]
}

function makeFakeServer(): FakeServer {
  const sent: SentEvent[] = []
  const handlers = new Map<string, MiddlewareHandler>()
  const closeHandlers: Array<() => void> = []
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
      on: (event, cb) => {
        if (event === 'close') closeHandlers.push(cb)
      },
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
})
