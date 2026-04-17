import { WebSocketServer, type WebSocket } from 'ws'
import { randomUUID } from 'node:crypto'
import type { LluiDebugAPI } from '@llui/dom'
import type { RelayTransport } from '../tool-registry.js'

export interface RelayTransportOptions {
  port: number
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
  private readonly port: number
  private readonly onConnect?: () => void
  private readonly onDisconnect?: () => void

  constructor(opts: RelayTransportOptions) {
    this.port = opts.port
    this.onConnect = opts.onBrowserConnect
    this.onDisconnect = opts.onBrowserDisconnect
  }

  connectDirect(api: LluiDebugAPI): void {
    this.directApi = api
  }

  start(): void {
    if (this.wsServer) return
    this.wsServer = new WebSocketServer({ port: this.port, host: '127.0.0.1' })
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

  async call(method: string, args: unknown[]): Promise<unknown> {
    if (this.directApi) {
      const fn = (this.directApi as unknown as Record<string, unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`unknown method: ${method}`)
      return (fn as (...a: unknown[]) => unknown).apply(this.directApi, args)
    }
    if (!this.browserWs) {
      throw new Error('No browser connected to the MCP bridge. Start your dev server.')
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
