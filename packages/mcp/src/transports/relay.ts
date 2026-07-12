import { WebSocketServer, WebSocket } from 'ws'
import type { Server as HttpServer, IncomingMessage } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { LluiDebugAPI } from '@llui/dom'
import type { RelayTransport } from '../tool-registry.js'
import { tokensMatch, isLoopbackOrigin } from '../util/loopback.js'

/** Collapse a possibly-multi-valued header to a single string. */
function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/**
 * Structured snapshot of the bridge state at a single point in time.
 * Returned by `RelayUnavailableError.diagnostic` so tool callers can
 * see WHY the browser isn't reachable without grepping plugin source.
 */
export interface BridgeDiagnostic {
  connected: boolean
  bridge: {
    /** Is the WS server bound and listening? */
    running: boolean
    port: number | null
  }
  browser: {
    /** Currently connected browser tabs (0 or 1 — the bridge is single-client today). */
    tabsConnected: number
  }
  mcpMarker: {
    present: boolean
    path: string
    /** Set by the Vite plugin once Vite's httpServer emits `listening`. */
    devUrl: string | null
  }
  suggestedFix: string
}

/**
 * Error thrown when a tool call needs the browser relay but no browser
 * is attached. Carries a `diagnostic` payload the MCP handler can
 * surface as `isError: true` tool content — no need for Claude (or any
 * MCP client) to grep plugin source to guess what's wrong.
 */
export class RelayUnavailableError extends Error {
  readonly diagnostic: BridgeDiagnostic
  constructor(diagnostic: BridgeDiagnostic) {
    super(diagnostic.suggestedFix)
    this.name = 'RelayUnavailableError'
    this.diagnostic = diagnostic
  }
}

function buildSuggestedFix(state: {
  bridgeRunning: boolean
  tabsConnected: number
  markerPresent: boolean
  devUrl: string | null
}): string {
  if (!state.bridgeRunning) {
    return (
      'The MCP bridge server is not running. Start @llui/mcp — either via the ' +
      'Vite plugin (install @llui/mcp as a dev dep and the plugin will auto-spawn ' +
      'it on `pnpm dev`) or manually with `npx llui-mcp`.'
    )
  }
  if (!state.markerPresent) {
    return (
      'The bridge is running but no active-marker file exists — internal ' +
      'state mismatch. Restart the MCP server and retry.'
    )
  }
  if (state.devUrl === null) {
    return (
      "The marker file exists but the Vite plugin hasn't stamped its dev URL " +
      "(so the plugin probably isn't opted in). Check vite.config.ts: ensure " +
      '`llui()` is in plugins and mcpPort is not set to false. Then restart ' +
      'Vite and load the app in a browser.'
    )
  }
  if (state.tabsConnected === 0) {
    return (
      `The bridge is running and the Vite plugin is opted in, but no browser ` +
      `tab is attached. Open ${state.devUrl} (or reload the tab if already open). ` +
      'The browser relay connects on page load.'
    )
  }
  return 'Unknown state — bridge running, browser attached, yet the call failed.'
}

export interface RelayTransportOptions {
  /**
   * Either `port` (stdio mode — relay owns its own WS server) or
   * `attachTo` (HTTP mode — relay upgrades on an existing http.Server so
   * the MCP HTTP endpoint and the browser bridge share a single port).
   */
  port?: number
  attachTo?: HttpServer
  /**
   * Filesystem path to the MCP active-marker file. Used by `diagnose()`
   * to check whether the Vite plugin has written the marker (indicating
   * it's opted in) and to read back the `devUrl` it stamped.
   */
  markerPath?: string
  /**
   * Path to the per-launch HTTP bearer-token file (`mcpHttpTokenPath()`).
   * Enforced ONLY for the shared-HTTP-port bridge (`attachTo` mode): when
   * this file exists, a `/bridge` upgrade must present the token (via the
   * `?token=` query param or a `Sec-WebSocket-Protocol` value) or be
   * rejected. In standalone (`port`) mode no token file is written, so the
   * bridge is gated by the loopback-origin + single-client checks alone.
   */
  authTokenPath?: string
  onBrowserConnect?: () => void
  onBrowserDisconnect?: () => void
}

interface PendingRequest {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
}

export class WebSocketRelayTransport implements RelayTransport {
  private wsServer: WebSocketServer | null = null
  private browserWs: WebSocket | null = null
  private pending = new Map<string, PendingRequest>()
  private directApi: LluiDebugAPI | null = null
  private readonly port: number | undefined
  private readonly attachTo: HttpServer | undefined
  private readonly markerPath: string
  private readonly authTokenPath: string | undefined
  private readonly onConnect?: () => void
  private readonly onDisconnect?: () => void

  constructor(opts: RelayTransportOptions) {
    this.port = opts.port
    this.attachTo = opts.attachTo
    this.markerPath = opts.markerPath ?? ''
    this.authTokenPath = opts.authTokenPath
    this.onConnect = opts.onBrowserConnect
    this.onDisconnect = opts.onBrowserDisconnect
  }

  /** Expected bridge token, or null when none is configured/written. */
  private expectedToken(): string | null {
    if (!this.authTokenPath) return null
    try {
      const t = readFileSync(this.authTokenPath, 'utf8').trim()
      return t.length > 0 ? t : null
    } catch {
      return null
    }
  }

  /** Token presented on the upgrade — from `?token=` or `Sec-WebSocket-Protocol`. */
  private presentedToken(req: IncomingMessage): string | null {
    try {
      const q = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('token')
      if (q) return q
    } catch {
      // malformed url — fall through to the subprotocol header
    }
    const proto = firstHeader(req.headers['sec-websocket-protocol'])
    if (proto) {
      for (const part of proto
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)) {
        if (part !== 'llui-bridge') return part
      }
    }
    return null
  }

  /** True when a live browser bridge client is already attached. */
  private hasLiveClient(): boolean {
    return this.browserWs !== null && this.browserWs.readyState === WebSocket.OPEN
  }

  /**
   * Validate a bridge WS upgrade before accepting it. Rejects cross-origin
   * hijack attempts, enforces the per-launch token on the shared HTTP port,
   * and refuses a second concurrent client so an attacker cannot supersede
   * the legitimately-attached browser.
   */
  private validateUpgrade(
    req: IncomingMessage,
  ): { ok: true } | { ok: false; code: number; reason: string } {
    if (!isLoopbackOrigin(firstHeader(req.headers.origin))) {
      return { ok: false, code: 403, reason: 'cross-origin bridge upgrade rejected' }
    }
    if (this.attachTo) {
      const expected = this.expectedToken()
      if (expected) {
        const presented = this.presentedToken(req)
        if (!presented || !tokensMatch(presented, expected)) {
          return { ok: false, code: 401, reason: 'missing or invalid bridge token' }
        }
      }
    }
    if (this.hasLiveClient()) {
      return { ok: false, code: 409, reason: 'a browser bridge client is already connected' }
    }
    return { ok: true }
  }

  connectDirect(api: LluiDebugAPI): void {
    this.directApi = api
  }

  /**
   * Resolve the component-registry pseudo-methods in direct (in-process)
   * mode against the global registry the runtime populates. Mirrors the
   * browser-side relay's `handleMessage` handling for `__listComponents`
   * / `__selectComponent`, so multi-mount listing and active-component
   * switching work without a WebSocket round-trip.
   */
  private callRegistry(method: string, args: unknown[]): unknown {
    const g = globalThis as {
      __lluiComponents?: Record<string, LluiDebugAPI>
      __lluiDebug?: LluiDebugAPI
    }
    const registry = g.__lluiComponents
    if (method === '__listComponents') {
      const components = registry ? Object.keys(registry) : []
      const active =
        registry && this.directApi
          ? (Object.entries(registry).find(([, v]) => v === this.directApi)?.[0] ?? null)
          : null
      return { components, active }
    }
    // __selectComponent
    const key = (args[0] as string | undefined) ?? ''
    const entry = registry?.[key]
    if (!entry) throw new Error(`unknown component: ${key}`)
    this.directApi = entry
    g.__lluiDebug = entry
    return { active: key }
  }

  start(): void {
    if (this.wsServer) return
    // Two modes:
    //   - standalone (stdio MCP transport): own server on `port`.
    //   - attached (HTTP MCP transport): share port with MCP's http.Server
    //     via upgrade routing on `/bridge`.
    if (this.attachTo) {
      this.wsServer = new WebSocketServer({ noServer: true })
      this.attachTo.on('upgrade', (req, socket, head) => {
        // Only `/bridge` upgrades are ours. Anything else on this server is
        // unexpected (the MCP Streamable-HTTP transport never upgrades) —
        // destroy the socket instead of leaving it dangling as a leaked
        // half-open handle.
        let pathname: string
        try {
          pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
        } catch {
          pathname = req.url ?? ''
        }
        if (pathname !== '/bridge') {
          socket.destroy()
          return
        }
        const check = this.validateUpgrade(req)
        if (!check.ok) {
          socket.write(`HTTP/1.1 ${check.code} ${check.reason}\r\nConnection: close\r\n\r\n`)
          socket.destroy()
          return
        }
        this.wsServer!.handleUpgrade(req, socket, head, (ws) => {
          this.wsServer!.emit('connection', ws, req)
        })
      })
    } else if (this.port !== undefined) {
      this.wsServer = new WebSocketServer({
        port: this.port,
        host: '127.0.0.1',
        // Reject cross-origin / superseding upgrades before the WS handshake
        // completes (token is not enforced in standalone mode — no token
        // file is written there).
        verifyClient: (info, cb) => {
          const check = this.validateUpgrade(info.req)
          if (check.ok) cb(true)
          else cb(false, check.code, check.reason)
        },
      })
    } else {
      throw new Error('WebSocketRelayTransport: provide either `port` or `attachTo`.')
    }
    this.wsServer.on('connection', (ws) => {
      // Single-client bridge, first-come-first-served: `validateUpgrade`
      // already rejected a second client, but a rare simultaneous race could
      // let two upgrades pass the pre-handshake check. Close the loser here so
      // the legitimately-attached browser is never superseded by a hijacker.
      if (this.browserWs !== null && this.browserWs !== ws && this.hasLiveClient()) {
        try {
          ws.close(1013, 'bridge busy')
        } catch {
          // already closing/closed; nothing to do
        }
        return
      }
      this.browserWs = ws
      this.onConnect?.()
      ws.on('message', (raw) => {
        let msg: { id: string; result?: unknown; error?: string }
        try {
          msg = JSON.parse(String(raw))
        } catch {
          return
        }
        const p = this.pending.get(msg.id)
        if (!p) return
        this.pending.delete(msg.id)
        if (msg.error) p.reject(new Error(msg.error))
        else p.resolve(msg.result)
      })
      ws.on('close', () => {
        if (this.browserWs === ws) {
          this.browserWs = null
          this.onDisconnect?.()
        }
      })
    })
  }

  stop(): void {
    if (this.wsServer) {
      // `WebSocketServer.close()` stops listening but does NOT close already-
      // connected clients — their TCP sockets stay open as live handles. Left
      // open they keep the process alive (a dev-server restart would leak them;
      // in CI it hung the whole test process after the suite finished).
      // Forcibly terminate every client so no socket outlives the relay.
      for (const client of this.wsServer.clients) {
        try {
          client.terminate()
        } catch {
          // already closing/closed; nothing to do
        }
      }
      this.wsServer.close()
      this.wsServer = null
    }
    this.browserWs = null
    for (const p of this.pending.values()) p.reject(new Error('relay closed'))
    this.pending.clear()
  }

  isAvailable(): boolean {
    return this.directApi !== null || this.browserWs !== null
  }

  isServerRunning(): boolean {
    return this.wsServer !== null
  }

  /**
   * Build a snapshot of the bridge state for diagnostics. Called when a
   * tool call fails because the browser isn't attached — the payload
   * goes straight into `RelayUnavailableError.diagnostic` for the
   * client to surface.
   */
  diagnose(markerPath: string): BridgeDiagnostic {
    const connected = this.isAvailable()
    const tabsConnected = this.browserWs !== null ? 1 : 0
    const markerPresent = existsSync(markerPath)
    let devUrl: string | null = null
    if (markerPresent) {
      try {
        const payload = JSON.parse(readFileSync(markerPath, 'utf8')) as { devUrl?: string }
        devUrl = typeof payload.devUrl === 'string' ? payload.devUrl : null
      } catch {
        // Ignore malformed markers — leaves devUrl null.
      }
    }
    const suggestedFix = buildSuggestedFix({
      bridgeRunning: this.wsServer !== null,
      tabsConnected,
      markerPresent,
      devUrl,
    })
    return {
      connected,
      bridge: { running: this.wsServer !== null, port: this.port ?? null },
      browser: { tabsConnected },
      mcpMarker: { present: markerPresent, path: markerPath, devUrl },
      suggestedFix,
    }
  }

  async call(method: string, args: unknown[]): Promise<unknown> {
    if (this.directApi) {
      // The component-registry pseudo-methods are not API methods — they
      // operate on the global registry the runtime populates
      // (globalThis.__lluiComponents / __lluiDebug). In WS mode the
      // browser-side relay handles these; in direct mode we resolve them
      // here against the same global registry.
      if (method === '__listComponents' || method === '__selectComponent') {
        return this.callRegistry(method, args)
      }
      const fn = (this.directApi as unknown as Record<string, unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`unknown method: ${method}`)
      return (fn as (...a: unknown[]) => unknown).apply(this.directApi, args)
    }
    if (!this.browserWs) {
      // Caller will typically catch + surface the diagnostic via the
      // MCP tool-call error path. Throwing the structured error keeps
      // the runtime contract simple — synchronous failure with context.
      throw new RelayUnavailableError(this.diagnose(this.markerPath || 'unknown'))
    }
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      // Clear the timeout when the request settles (reply arrives or the
      // relay is torn down) so a resolved call doesn't leave a 5s timer
      // pinning the event loop / keeping the process alive.
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`timeout: ${method}`))
      }, 5000)
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer)
          resolve(v)
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        },
      })
      this.browserWs!.send(JSON.stringify({ id, method, args }))
    })
  }
}
