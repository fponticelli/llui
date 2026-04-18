import { WebSocketServer, type WebSocket } from 'ws'
import type { Server as HttpServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { LluiDebugAPI } from '@llui/dom'
import type { RelayTransport } from '../tool-registry.js'

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
  private readonly onConnect?: () => void
  private readonly onDisconnect?: () => void

  constructor(opts: RelayTransportOptions) {
    this.port = opts.port
    this.attachTo = opts.attachTo
    this.markerPath = opts.markerPath ?? ''
    this.onConnect = opts.onBrowserConnect
    this.onDisconnect = opts.onBrowserDisconnect
  }

  connectDirect(api: LluiDebugAPI): void {
    this.directApi = api
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
        if (req.url !== '/bridge') return
        this.wsServer!.handleUpgrade(req, socket, head, (ws) => {
          this.wsServer!.emit('connection', ws, req)
        })
      })
    } else if (this.port !== undefined) {
      this.wsServer = new WebSocketServer({ port: this.port, host: '127.0.0.1' })
    } else {
      throw new Error('WebSocketRelayTransport: provide either `port` or `attachTo`.')
    }
    this.wsServer.on('connection', (ws) => {
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
    this.wsServer?.close()
    this.wsServer = null
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
      this.pending.set(id, { resolve, reject })
      this.browserWs!.send(JSON.stringify({ id, method, args }))
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`timeout: ${method}`))
      }, 5000)
    })
  }
}
