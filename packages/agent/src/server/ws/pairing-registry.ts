import type { ClientFrame, ServerFrame, HelloFrame, LogEntry } from '../../protocol.js'
import { LAP_VERSION } from '../../protocol.js'
import {
  rpc as rpcHelper,
  waitForConfirm as waitForConfirmHelper,
  waitForChange as waitForChangeHelper,
  type RpcOptions,
  type RpcError,
  type ConfirmWaitResult,
} from './rpc.js'

export type { RpcOptions, RpcError, ConfirmWaitResult }

/**
 * Thin abstraction over a single paired WebSocket. Consumed by the
 * registry implementations; runtime-specific adapters (`ws`-lib,
 * `WebSocketPair`, `Deno.upgradeWebSocket`, `Bun.serve` upgrade) build
 * one of these and pass it to `registry.register()`.
 */
export interface PairingConnection {
  send(frame: ServerFrame): void
  onFrame(handler: (f: ClientFrame) => void): void
  onClose(handler: () => void): void
  close(): void
}

/**
 * A per-call frame subscriber. Return `true` to remove this
 * subscriber (one-shot), or `false` to keep receiving. The registry
 * dispatches every inbound `ClientFrame` to every active subscriber
 * for the given `tid`; subscribers filter by `frame.t` + identifiers
 * (correlation id, confirm id, state path) to find the one that
 * belongs to their request.
 */
export type FrameSubscriber = (frame: ClientFrame) => boolean

/**
 * Registry of live browser pairings. Pure routing + hello cache —
 * request-lifecycle state (in-flight RPC promises, confirm waits,
 * long-polls) lives in the LAP handlers that need it, not here.
 *
 * Two implementations ship today:
 *   - `InMemoryPairingRegistry` for long-lived server processes
 *     (Node, Bun, Deno, Deno Deploy).
 *   - A Cloudflare Durable Object implementation (see
 *     `server/cloudflare`) for stateless Worker runtimes.
 *
 * Other runtimes can implement this interface the same way; the
 * contract is intentionally small.
 */
export interface PairingRegistry {
  // ── Routing primitives ─────────────────────────────────────────
  register(tid: string, conn: PairingConnection): void
  unregister(tid: string): void
  isPaired(tid: string): boolean
  getHello(tid: string): HelloFrame | null
  /** Send a frame. No-op when the pairing is absent or closed. */
  send(tid: string, frame: ServerFrame): void
  /**
   * Subscribe to frames from the paired browser. Returns an
   * unsubscribe function. A subscriber can remove itself mid-dispatch
   * by returning `true` from its callback — useful for one-shot
   * request/response correlation.
   */
  subscribe(tid: string, handler: FrameSubscriber): () => void
  /**
   * Observe the pairing closing (WebSocket drop, `unregister`, etc.).
   * Handlers registered before close fire; handlers registered after
   * close fire synchronously. Returns an unsubscribe function.
   */
  onClose(tid: string, handler: () => void): () => void

  /**
   * Read the most recent `n` log entries for a tid (newest first).
   * Backed by an in-memory ring buffer populated as the registry
   * sees `log-append` frames; capped per-tid to bound memory across
   * long-lived sessions. Drained on close. Returns an empty array
   * for unknown tids.
   */
  getRecentLog(tid: string, n: number): LogEntry[]

  /**
   * Per-tid cap on the recent-log ring buffer — the ceiling
   * `getRecentLog` clamps to. Exposed so callers that need "everything
   * the buffer can hold" (e.g. the `/recent-actions` handler pulling the
   * full buffer before filtering by kind) reference the registry's own
   * bound instead of hardcoding a literal that could drift.
   */
  readonly recentLogCap: number

  // ── Request/response helpers ───────────────────────────────────
  // These are part of the contract (LAP handlers call them directly)
  // but implementations almost always delegate to the free helpers in
  // `./rpc.ts`, which are built on the routing primitives above. The
  // Cloudflare Durable Object registry uses the same helpers; the
  // split exists so the routing surface is small enough to implement
  // across stateful boundaries (DO storage, WebSocket hibernation),
  // while the correlation logic lives once in a runtime-neutral file.

  /**
   * Send a typed rpc frame and await its matching reply. See
   * `./rpc.ts::rpc` for the full contract.
   */
  rpc(tid: string, tool: string, args: unknown, opts?: RpcOptions): Promise<unknown>
  /** See `./rpc.ts::waitForConfirm`. Three-way: confirmed | user-cancelled | timeout. */
  waitForConfirm(tid: string, confirmId: string, timeoutMs: number): Promise<ConfirmWaitResult>
  /** See `./rpc.ts::waitForChange`. */
  waitForChange(
    tid: string,
    path: string | undefined,
    timeoutMs: number,
  ): Promise<{ status: 'changed' | 'timeout'; stateAfter: unknown }>
}

type Pairing = {
  conn: PairingConnection
  hello: HelloFrame | null
  subscribers: Set<FrameSubscriber>
  closeHandlers: Set<() => void>
  closed: boolean
}

/**
 * Single-process in-memory registry. Correct for Node/Bun/Deno/Deno
 * Deploy — anywhere the server process can hold a long-lived
 * WebSocket. Not suitable for stateless Worker isolates; use the
 * Durable Object registry for Cloudflare.
 */
/**
 * Per-tid cap on the recent-log ring buffer. Sized to cover a few
 * minutes of agent activity at typical dispatch rates without
 * growing unboundedly for long-lived sessions. Reads via
 * `getRecentLog` clamp to this; agents asking for more get whatever
 * the buffer currently holds.
 */
const RECENT_LOG_CAP = 100

export class InMemoryPairingRegistry implements PairingRegistry {
  /** @see PairingRegistry.recentLogCap */
  readonly recentLogCap = RECENT_LOG_CAP
  private pairings = new Map<string, Pairing>()
  private onLogAppend: ((tid: string, entry: LogEntry) => void) | null
  /**
   * Per-tid ring buffer of recent log entries. Populated as the
   * registry sees `log-append` frames; trimmed to RECENT_LOG_CAP.
   * The agent reads this via `describe_recent_actions` to introspect
   * its own activity history with stateDiffs intact.
   */
  private recentLog = new Map<string, LogEntry[]>()

  constructor(
    opts: {
      onLogAppend?: (tid: string, entry: LogEntry) => void
    } = {},
  ) {
    this.onLogAppend = opts.onLogAppend ?? null
  }

  /**
   * Read the most recent `n` log entries for a tid, newest-first. Returns
   * an empty array when the tid is unknown or has no recorded activity.
   * Drained from the in-memory ring buffer; entries older than
   * RECENT_LOG_CAP have already been trimmed.
   */
  getRecentLog(tid: string, n: number): LogEntry[] {
    const buf = this.recentLog.get(tid)
    if (!buf || buf.length === 0) return []
    const count = Math.min(Math.max(0, Math.floor(n)), buf.length)
    if (count === 0) return []
    // Buffer is append-order; return the tail reversed so newest is first.
    return buf.slice(-count).reverse()
  }

  register(tid: string, conn: PairingConnection): void {
    // Supersede any still-live pairing for this tid (reconnect while the
    // old socket hasn't finished closing). We tear the old pairing down
    // SILENTLY — its close handlers are dropped WITHOUT firing so the
    // core's `markPendingResume` transition does NOT run mid-re-pair
    // (the caller, `acceptConnection`, re-marks the record active right
    // after). The recent-log ring buffer is deliberately preserved so
    // history survives the re-pair. Then we explicitly close the old
    // socket so a half-open connection doesn't linger.
    const existing = this.pairings.get(tid)
    if (existing && !existing.closed && existing.conn !== conn) {
      existing.closed = true
      existing.subscribers.clear()
      existing.closeHandlers.clear()
      try {
        existing.conn.close()
      } catch {
        // Best-effort — the socket may already be tearing down.
      }
    }
    const p: Pairing = {
      conn,
      // Preserve the last-known hello across a re-pair; the browser
      // re-sends hello on WS open, but keeping it avoids a null window.
      hello: existing?.hello ?? null,
      subscribers: new Set(),
      closeHandlers: new Set(),
      closed: false,
    }
    this.pairings.set(tid, p)
    conn.onFrame((frame) => this.dispatch(tid, frame))
    // Connection-scoped close: the handler carries the identity of THIS
    // conn, so a late close event from a superseded socket is a no-op
    // (it won't tear down the replacement pairing or wipe its log).
    conn.onClose(() => this.handleClose(tid, conn))
  }

  unregister(tid: string): void {
    // Hard teardown (e.g. revoke): fire close handlers for the current
    // conn AND drop the recent-log buffer — unlike a plain WS close,
    // this session is gone for good, so retaining history would leak.
    this.handleClose(tid, this.pairings.get(tid)?.conn)
    this.recentLog.delete(tid)
  }

  isPaired(tid: string): boolean {
    const p = this.pairings.get(tid)
    return !!p && !p.closed
  }

  getHello(tid: string): HelloFrame | null {
    return this.pairings.get(tid)?.hello ?? null
  }

  send(tid: string, frame: ServerFrame): void {
    const p = this.pairings.get(tid)
    if (!p || p.closed) return
    try {
      p.conn.send(frame)
    } catch {
      // Connection may have dropped between isPaired() and send(); no-op.
    }
  }

  subscribe(tid: string, handler: FrameSubscriber): () => void {
    const p = this.pairings.get(tid)
    if (!p || p.closed) return () => {}
    p.subscribers.add(handler)
    return () => {
      p.subscribers.delete(handler)
    }
  }

  onClose(tid: string, handler: () => void): () => void {
    const p = this.pairings.get(tid)
    if (!p || p.closed) {
      // Already closed — fire synchronously so callers don't hang
      // waiting for a close that already happened.
      queueMicrotask(handler)
      return () => {}
    }
    p.closeHandlers.add(handler)
    return () => {
      p.closeHandlers.delete(handler)
    }
  }

  private dispatch(tid: string, frame: ClientFrame): void {
    const p = this.pairings.get(tid)
    if (!p || p.closed) return
    // hello and log-append are registry-owned side effects — handled
    // here so no per-call subscriber has to pick them up.
    if (frame.t === 'hello') {
      p.hello = frame
      // LAP version negotiation: log (don't hard-fail) a client whose
      // wire-protocol version we don't recognise, so a version skew is
      // diagnosable instead of surfacing as mysterious frame errors.
      if (frame.lapVersion !== undefined && frame.lapVersion !== LAP_VERSION) {
        console.warn(
          `[llui-agent] LAP version skew for tid=${tid}: client speaks v${frame.lapVersion}, server speaks v${LAP_VERSION}`,
        )
      }
      return
    }
    if (frame.t === 'log-append') {
      // Push into the ring buffer for `describe_recent_actions`,
      // capped to RECENT_LOG_CAP. The audit-sink callback runs
      // alongside; both are independent observers of the same
      // log-append stream.
      let buf = this.recentLog.get(tid)
      if (!buf) {
        buf = []
        this.recentLog.set(tid, buf)
      }
      buf.push(frame.entry)
      if (buf.length > RECENT_LOG_CAP) {
        buf.splice(0, buf.length - RECENT_LOG_CAP)
      }
      this.onLogAppend?.(tid, frame.entry)
      return
    }
    // Guard against genuinely unknown client frame types (protocol drift /
    // a newer client). The known correlated types are consumed by
    // per-call subscribers below; anything else is logged, not silently
    // dropped.
    if (
      frame.t !== 'rpc-reply' &&
      frame.t !== 'rpc-error' &&
      frame.t !== 'confirm-resolved' &&
      frame.t !== 'state-update'
    ) {
      console.warn(
        `[llui-agent] ignoring unknown client frame type: ${String((frame as { t?: unknown }).t)}`,
      )
      return
    }
    // Iterate over a snapshot because subscribers may self-remove
    // mid-iteration by returning true.
    const snapshot = Array.from(p.subscribers)
    for (const sub of snapshot) {
      try {
        if (sub(frame)) p.subscribers.delete(sub)
      } catch {
        // One bad subscriber shouldn't break the others.
        p.subscribers.delete(sub)
      }
    }
  }

  // ── Convenience wrappers ───────────────────────────────────────
  // The following methods delegate to the free-function helpers in
  // `./rpc.ts`. They're here so the in-memory registry remains a
  // one-stop testing surface (spy on `registry.rpc`, etc.) without
  // couping the `PairingRegistry` interface to request-lifecycle
  // details. External implementations (e.g. the Cloudflare Durable
  // Object registry) are NOT required to provide these; the LAP
  // handlers always go through the free helpers.

  rpc(tid: string, tool: string, args: unknown, opts: RpcOptions = {}): Promise<unknown> {
    return rpcHelper(this, tid, tool, args, opts)
  }

  waitForConfirm(tid: string, confirmId: string, timeoutMs: number): Promise<ConfirmWaitResult> {
    return waitForConfirmHelper(this, tid, confirmId, timeoutMs)
  }

  waitForChange(
    tid: string,
    path: string | undefined,
    timeoutMs: number,
  ): Promise<{ status: 'changed' | 'timeout'; stateAfter: unknown }> {
    return waitForChangeHelper(this, tid, path, timeoutMs)
  }

  /** @deprecated Use `send(tid, frame)` directly; semantics are identical. */
  notify(tid: string, frame: ServerFrame): void {
    this.send(tid, frame)
  }

  private handleClose(tid: string, conn?: PairingConnection): void {
    const p = this.pairings.get(tid)
    if (!p || p.closed) return
    // Connection-scoped: only the pairing's CURRENT conn may close it.
    // A late close from a superseded socket (reconnect race) is ignored
    // so it can't tear down the replacement pairing.
    if (conn !== undefined && p.conn !== conn) return
    p.closed = true
    for (const h of Array.from(p.closeHandlers)) {
      try {
        h()
      } catch {
        // Swallow — handlers run best-effort.
      }
    }
    p.closeHandlers.clear()
    p.subscribers.clear()
    this.pairings.delete(tid)
    // The recent-log ring buffer is intentionally NOT dropped here: a
    // brief WS drop followed by a reconnect within the pending-resume
    // grace window should keep `describe_recent_actions` history intact.
    // Hard teardown (revoke) goes through `unregister`, which drops it.
  }
}

/**
 * Back-compat alias for the prior class name. New code should use
 * `InMemoryPairingRegistry`. Removed in a future major.
 *
 * @deprecated Use `InMemoryPairingRegistry` directly.
 */
export const WsPairingRegistry = InMemoryPairingRegistry
export type WsPairingRegistry = InMemoryPairingRegistry
