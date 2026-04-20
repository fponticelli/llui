import { randomUUID } from 'node:crypto'
import type { ClientFrame, ServerFrame, HelloFrame, LogEntry } from '../../protocol.js'

/**
 * Thin abstraction over a WebSocket so the registry is testable with
 * a fake EventEmitter-style mock.
 */
export interface PairingConnection {
  send(frame: ServerFrame): void
  onFrame(handler: (f: ClientFrame) => void): void
  onClose(handler: () => void): void
  close(): void
}

type RpcEntry = {
  resolve: (result: unknown) => void
  reject: (err: RpcError) => void
  timer: ReturnType<typeof setTimeout> | null
}

type ConfirmEntry = {
  resolve: (r: { outcome: 'confirmed' | 'user-cancelled'; stateAfter?: unknown }) => void
  timer: ReturnType<typeof setTimeout> | null
}

type WaitEntry = {
  path: string | undefined
  resolve: (r: { status: 'changed' | 'timeout'; stateAfter: unknown }) => void
  timer: ReturnType<typeof setTimeout> | null
}

type Pairing = {
  conn: PairingConnection
  hello: HelloFrame | null
  pendingRpc: Map<string, RpcEntry>
  pendingConfirm: Map<string, ConfirmEntry>
  pendingWait: WaitEntry[]
  closed: boolean
}

export type RpcError = {
  code: 'paused' | 'invalid' | 'timeout' | 'schema-error' | 'internal' | string
  detail?: string
}

export type RpcOptions = { timeoutMs?: number }

/**
 * Tracks live browser pairings and correlates rpc requests with replies.
 * One instance per server; shared by all LAP handlers + the upgrade
 * handler. Spec §10.4–§10.5.
 */
export class WsPairingRegistry {
  private pairings = new Map<string, Pairing>()
  private now: () => number
  private onLogAppend: ((tid: string, entry: LogEntry) => void) | null

  constructor(
    opts: {
      now?: () => number
      onLogAppend?: (tid: string, entry: LogEntry) => void
    } = {},
  ) {
    this.now = opts.now ?? (() => Date.now())
    this.onLogAppend = opts.onLogAppend ?? null
  }

  register(tid: string, conn: PairingConnection): void {
    const p: Pairing = {
      conn,
      hello: null,
      pendingRpc: new Map(),
      pendingConfirm: new Map(),
      pendingWait: [],
      closed: false,
    }
    this.pairings.set(tid, p)
    conn.onFrame((frame) => this.handleClientFrame(tid, frame))
    conn.onClose(() => this.handleClose(tid))
  }

  unregister(tid: string): void {
    const p = this.pairings.get(tid)
    if (!p) return
    this.handleClose(tid)
  }

  isPaired(tid: string): boolean {
    const p = this.pairings.get(tid)
    return !!p && !p.closed
  }

  /**
   * Send a ServerFrame to the paired browser connection, if one is live.
   * No-op when unpaired or closed.
   */
  notify(tid: string, frame: ServerFrame): void {
    const p = this.pairings.get(tid)
    if (!p || p.closed) return
    try {
      p.conn.send(frame)
    } catch {
      // connection may have dropped between isPaired and notify; ignore
    }
  }

  getHello(tid: string): HelloFrame | null {
    return this.pairings.get(tid)?.hello ?? null
  }

  async rpc(tid: string, tool: string, args: unknown, opts: RpcOptions = {}): Promise<unknown> {
    const p = this.pairings.get(tid)
    if (!p || p.closed) {
      const err: RpcError = { code: 'paused' }
      throw err
    }
    const id = randomUUID()
    const timeoutMs = opts.timeoutMs ?? 15_000
    return new Promise((resolve, reject) => {
      const entry: RpcEntry = {
        resolve,
        reject,
        timer: setTimeout(() => {
          p.pendingRpc.delete(id)
          reject({ code: 'timeout' } as RpcError)
        }, timeoutMs),
      }
      p.pendingRpc.set(id, entry)
      const frame: ServerFrame = { t: 'rpc', id, tool, args }
      try {
        p.conn.send(frame)
      } catch (e) {
        p.pendingRpc.delete(id)
        if (entry.timer) clearTimeout(entry.timer)
        reject({ code: 'internal', detail: String(e) } as RpcError)
      }
    })
  }

  async waitForConfirm(
    tid: string,
    confirmId: string,
    timeoutMs: number,
  ): Promise<{ outcome: 'confirmed' | 'user-cancelled'; stateAfter?: unknown }> {
    const p = this.pairings.get(tid)
    if (!p || p.closed) {
      return { outcome: 'user-cancelled' }
    }
    return new Promise((resolve) => {
      const entry: ConfirmEntry = {
        resolve,
        timer: setTimeout(() => {
          p.pendingConfirm.delete(confirmId)
          resolve({ outcome: 'user-cancelled' })
        }, timeoutMs),
      }
      p.pendingConfirm.set(confirmId, entry)
    })
  }

  async waitForChange(
    tid: string,
    path: string | undefined,
    timeoutMs: number,
  ): Promise<{ status: 'changed' | 'timeout'; stateAfter: unknown }> {
    const p = this.pairings.get(tid)
    if (!p || p.closed) return { status: 'timeout', stateAfter: null }
    return new Promise((resolve) => {
      const entry: WaitEntry = {
        path,
        resolve,
        timer: setTimeout(() => {
          const idx = p.pendingWait.indexOf(entry)
          if (idx >= 0) p.pendingWait.splice(idx, 1)
          resolve({ status: 'timeout', stateAfter: null })
        }, timeoutMs),
      }
      p.pendingWait.push(entry)
    })
  }

  private handleClientFrame(tid: string, frame: ClientFrame): void {
    const p = this.pairings.get(tid)
    if (!p || p.closed) return
    switch (frame.t) {
      case 'hello': {
        p.hello = frame
        break
      }
      case 'rpc-reply': {
        const e = p.pendingRpc.get(frame.id)
        if (!e) break
        p.pendingRpc.delete(frame.id)
        if (e.timer) clearTimeout(e.timer)
        e.resolve(frame.result)
        break
      }
      case 'rpc-error': {
        const e = p.pendingRpc.get(frame.id)
        if (!e) break
        p.pendingRpc.delete(frame.id)
        if (e.timer) clearTimeout(e.timer)
        e.reject({ code: frame.code, detail: frame.detail } as RpcError)
        break
      }
      case 'confirm-resolved': {
        const e = p.pendingConfirm.get(frame.confirmId)
        if (!e) break
        p.pendingConfirm.delete(frame.confirmId)
        if (e.timer) clearTimeout(e.timer)
        e.resolve({ outcome: frame.outcome, stateAfter: frame.stateAfter })
        break
      }
      case 'state-update': {
        for (let i = p.pendingWait.length - 1; i >= 0; i--) {
          const w = p.pendingWait[i]
          if (w === undefined) continue
          if (w.path === undefined || w.path === frame.path || frame.path.startsWith(w.path)) {
            p.pendingWait.splice(i, 1)
            if (w.timer) clearTimeout(w.timer)
            w.resolve({ status: 'changed', stateAfter: frame.stateAfter })
          }
        }
        break
      }
      case 'log-append': {
        this.onLogAppend?.(tid, frame.entry)
        break
      }
    }
  }

  private handleClose(tid: string): void {
    const p = this.pairings.get(tid)
    if (!p) return
    p.closed = true
    for (const [, e] of p.pendingRpc) {
      if (e.timer) clearTimeout(e.timer)
      e.reject({ code: 'paused' } as RpcError)
    }
    p.pendingRpc.clear()
    for (const [, e] of p.pendingConfirm) {
      if (e.timer) clearTimeout(e.timer)
      e.resolve({ outcome: 'user-cancelled' })
    }
    p.pendingConfirm.clear()
    for (const w of p.pendingWait) {
      if (w.timer) clearTimeout(w.timer)
      w.resolve({ status: 'timeout', stateAfter: null })
    }
    p.pendingWait.length = 0
    this.pairings.delete(tid)
  }
}
