# LLui Agent — Plan 5 of 8: WS Bridge + LAP Dispatch

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete `@llui/agent/server` by adding the stateful half — `/agent/ws` upgrade handler, browser-pairing registry, and all 9 LAP endpoint dispatchers that forward JSON-RPC-style tool calls to the paired browser session over WS and return responses. After this plan, the server is end-to-end functional: mint a token → browser WS connect → Claude drives via LAP.

**Architecture:** A small stateful `WsPairingRegistry` class holds `Map<tid, PairingEntry>` where each entry carries the live `WebSocket`, the browser's cached `hello` payload, a map of pending rpc correlations, pending wait subscriptions, and pending confirm subscriptions. LAP handlers validate the bearer token, look up the pairing, forward an `rpc` frame via the registry, and await the reply. The `/describe` handler is special — it serves from the cached hello payload without round-tripping. `/message` and `/wait` hold the HTTP response open (long-poll) until the browser resolves the subscription or a timeout fires.

**Tech Stack:** Node `ws` library, Node `http.IncomingMessage` / `net.Socket` for the upgrade signature, `node:url` for token extraction, Web `Request`/`Response` for the HTTP surface, vitest + `ws`-based fakes for tests.

**Spec section coverage after this plan:**

- §7.1–§7.5 LAP endpoints (full set, including `/context`)
- §8.2 `describe_app` cache + forwarded tools
- §10.2 WS endpoint
- §10.4 LAP dispatch
- §10.5 Browser-to-server frames (all ClientFrame variants)

**Deferred to Plan 6:** client-side runtime (`agentConnect`/`agentConfirm`/`agentLog` + WS client). Plan 5 tests use fake WS clients; Plan 6 adds the real thing.

---

## File Structure

```
packages/agent/src/server/
  ws/
    pairing-registry.ts     — the Map<tid, PairingEntry> registry + rpc correlation
    upgrade.ts              — /agent/ws upgrade handler: token auth → registry.register
    frames.ts               — narrow type guards for ClientFrame parsing
  lap/
    describe.ts             — serves /lap/v1/describe from cached hello
    forward.ts              — generic "forward to rpc" helper for simple LAP routes
    message.ts              — /lap/v1/message with pending-confirmation long-poll
    wait.ts                 — /lap/v1/wait with state-update long-poll
    confirm-result.ts       — /lap/v1/confirm-result polling handler
    router.ts               — LAP-specific router (prefix match /lap/v1/*)
  factory.ts                — extended to compose ws + lap into AgentServerHandle

packages/agent/test/server/
  ws/
    pairing-registry.test.ts
    upgrade.test.ts
  lap/
    describe.test.ts
    simple-forwards.test.ts        — covers /state, /actions, /query-dom, /describe-visible, /context
    message.test.ts
    wait.test.ts
    confirm-result.test.ts
    router.test.ts
  integration.test.ts              — mint → ws-pair (fake) → describe → message
```

**Key abstraction:** `PairingConnection` — a thin interface wrapping the WS so tests can substitute a fake:

```ts
interface PairingConnection {
  send(frame: ServerFrame): void
  onFrame(handler: (f: ClientFrame) => void): void
  onClose(handler: () => void): void
  close(): void
}
```

Real upgrade handler wraps `ws` into this interface; test harness implements it with an `EventEmitter`.

---

## Task 1: `WsPairingRegistry` — failing tests for rpc correlation

**Files:**

- Create: `packages/agent/test/server/ws/pairing-registry.test.ts`

- [ ] **Step 1: Test**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { WsPairingRegistry } from '../../../src/server/ws/pairing-registry.js'
import type { ClientFrame, ServerFrame, HelloFrame } from '../../../src/protocol.js'

type Fake = {
  send: ReturnType<typeof vi.fn>
  emit: (f: ClientFrame) => void
  emitClose: () => void
}

function mkFake(): Fake {
  let onFrame: (f: ClientFrame) => void = () => {}
  let onClose: () => void = () => {}
  const conn = {
    send: vi.fn(),
    onFrame(h: typeof onFrame) {
      onFrame = h
    },
    onClose(h: typeof onClose) {
      onClose = h
    },
    close() {
      onClose()
    },
  }
  const out: Fake = {
    send: conn.send,
    emit: (f) => onFrame(f),
    emitClose: () => onClose(),
  }
  ;(out as { __conn: typeof conn }).__conn = conn
  return out
}

const hello = (schemaHash = 'h1'): HelloFrame => ({
  t: 'hello',
  appName: 'Test',
  appVersion: '0.0',
  msgSchema: {},
  stateSchema: {},
  affordancesSample: [],
  docs: null,
  schemaHash,
})

let reg: WsPairingRegistry
beforeEach(() => {
  reg = new WsPairingRegistry({ now: () => 1000 })
})

describe('WsPairingRegistry', () => {
  it('register stores the pairing keyed by tid', () => {
    const f = mkFake()
    reg.register(
      't1',
      (
        f as unknown as {
          __conn: {
            send: (x: ServerFrame) => void
            onFrame: (h: (cf: ClientFrame) => void) => void
            onClose: (h: () => void) => void
            close: () => void
          }
        }
      ).__conn,
    )
    expect(reg.isPaired('t1')).toBe(true)
  })

  it('unregister drops the pairing', () => {
    const f = mkFake()
    reg.register('t1', (f as unknown as { __conn: unknown }).__conn as never)
    reg.unregister('t1')
    expect(reg.isPaired('t1')).toBe(false)
  })

  it('caches the hello payload and returns it via getHello', () => {
    const f = mkFake()
    reg.register('t1', (f as unknown as { __conn: unknown }).__conn as never)
    f.emit(hello('hash-1'))
    const cached = reg.getHello('t1')
    expect(cached?.schemaHash).toBe('hash-1')
  })

  it('rpc() sends a frame with a generated id and resolves on matching rpc-reply', async () => {
    const f = mkFake()
    reg.register('t1', (f as unknown as { __conn: unknown }).__conn as never)
    const p = reg.rpc('t1', 'get_state', { path: null })
    expect(f.send).toHaveBeenCalledTimes(1)
    const sent = f.send.mock.calls[0][0] as ServerFrame
    expect(sent.t).toBe('rpc')
    if (sent.t !== 'rpc') throw new Error('unreachable')
    f.emit({ t: 'rpc-reply', id: sent.id, result: { state: { count: 7 } } })
    expect(await p).toEqual({ state: { count: 7 } })
  })

  it('rpc() rejects on matching rpc-error', async () => {
    const f = mkFake()
    reg.register('t1', (f as unknown as { __conn: unknown }).__conn as never)
    const p = reg.rpc('t1', 'get_state', {})
    const sent = f.send.mock.calls[0][0] as ServerFrame
    if (sent.t !== 'rpc') throw new Error('unreachable')
    f.emit({ t: 'rpc-error', id: sent.id, code: 'invalid', detail: 'bad path' })
    await expect(p).rejects.toMatchObject({ code: 'invalid', detail: 'bad path' })
  })

  it('rpc() rejects with paused when no pairing exists', async () => {
    await expect(reg.rpc('unknown', 'get_state', {})).rejects.toMatchObject({ code: 'paused' })
  })

  it('rpc() respects an explicit timeout', async () => {
    const f = mkFake()
    reg.register('t1', (f as unknown as { __conn: unknown }).__conn as never)
    await expect(reg.rpc('t1', 'get_state', {}, { timeoutMs: 1 })).rejects.toMatchObject({
      code: 'timeout',
    })
  })

  it('waitForConfirm() resolves when a matching confirm-resolved frame arrives', async () => {
    const f = mkFake()
    reg.register('t1', (f as unknown as { __conn: unknown }).__conn as never)
    const p = reg.waitForConfirm('t1', 'c-1', 1000)
    f.emit({
      t: 'confirm-resolved',
      confirmId: 'c-1',
      outcome: 'confirmed',
      stateAfter: { ok: true },
    })
    expect(await p).toEqual({ outcome: 'confirmed', stateAfter: { ok: true } })
  })

  it('waitForChange() resolves when a matching state-update arrives (path prefix match)', async () => {
    const f = mkFake()
    reg.register('t1', (f as unknown as { __conn: unknown }).__conn as never)
    const p = reg.waitForChange('t1', '/count', 1000)
    f.emit({ t: 'state-update', path: '/count', stateAfter: { count: 2 } })
    expect(await p).toEqual({ status: 'changed', stateAfter: { count: 2 } })
  })

  it('waitForChange() returns timeout if no matching update arrives', async () => {
    const f = mkFake()
    reg.register('t1', (f as unknown as { __conn: unknown }).__conn as never)
    const res = await reg.waitForChange('t1', '/count', 1)
    expect(res).toEqual({ status: 'timeout', stateAfter: null })
  })

  it('close cleans up pending rpc with paused error', async () => {
    const f = mkFake()
    reg.register('t1', (f as unknown as { __conn: unknown }).__conn as never)
    const p = reg.rpc('t1', 'get_state', {}, { timeoutMs: 10000 })
    f.emitClose()
    await expect(p).rejects.toMatchObject({ code: 'paused' })
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd packages/agent && pnpm vitest run test/server/ws/pairing-registry.test.ts
```

---

## Task 2: `WsPairingRegistry` — implementation

**Files:**

- Create: `packages/agent/src/server/ws/pairing-registry.ts`

- [ ] **Step 1: Implement**

```ts
import { randomUUID } from 'node:crypto'
import type { ClientFrame, ServerFrame, HelloFrame } from '../../protocol.js'

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

  constructor(opts: { now?: () => number } = {}) {
    this.now = opts.now ?? (() => Date.now())
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
          if (w.path === undefined || w.path === frame.path || frame.path.startsWith(w.path)) {
            p.pendingWait.splice(i, 1)
            if (w.timer) clearTimeout(w.timer)
            w.resolve({ status: 'changed', stateAfter: frame.stateAfter })
          }
        }
        break
      }
      case 'log-append': {
        // Plan 5 does not yet plumb client-log appends to the audit sink.
        // Plan 8 (polish) may add that wiring. Ignore for now.
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
```

- [ ] **Step 2: Run tests**

```bash
cd packages/agent && pnpm vitest run test/server/ws/pairing-registry.test.ts
cd packages/agent && pnpm check
```

Expected: 11 passing; check silent.

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/server/ws/pairing-registry.ts packages/agent/test/server/ws/pairing-registry.test.ts
git commit -m "$(cat <<'COMMIT'
feat(agent): WsPairingRegistry — tid→pairing map with rpc correlation

Tracks live PairingConnection per tid, caches hello, correlates rpc
replies, routes confirm-resolved and state-update frames to waiting
handlers, cleans up on close. Pure — tests use a fake connection.
Spec §10.4–§10.5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Task 3: WS upgrade handler — test + impl

**Files:**

- Create: `packages/agent/src/server/ws/upgrade.ts`
- Create: `packages/agent/test/server/ws/upgrade.test.ts`

- [ ] **Step 1: Test — write a minimal integration using real Node http + ws**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import { WebSocket } from 'ws'
import { AddressInfo } from 'node:net'
import { createWsUpgradeHandler } from '../../../src/server/ws/upgrade.js'
import { WsPairingRegistry } from '../../../src/server/ws/pairing-registry.js'
import { InMemoryTokenStore } from '../../../src/server/token-store.js'
import { signToken } from '../../../src/server/token.js'
import type { TokenPayload, TokenRecord } from '../../../src/protocol.js'

const key = 'x'.repeat(32)

function seed(store: InMemoryTokenStore, tid: string): Promise<void> {
  const rec: TokenRecord = {
    tid,
    uid: 'u1',
    status: 'awaiting-ws',
    createdAt: 0,
    lastSeenAt: 0,
    pendingResumeUntil: null,
    origin: 'http://localhost',
    label: null,
  }
  return store.create(rec)
}

let server: Server
let registry: WsPairingRegistry
let store: InMemoryTokenStore
let port = 0

beforeEach(async () => {
  registry = new WsPairingRegistry()
  store = new InMemoryTokenStore()
  server = createServer()
  const upgrade = createWsUpgradeHandler({
    signingKey: key,
    tokenStore: store,
    registry,
    auditSink: { write: () => {} },
    now: () => Date.now(),
  })
  server.on('upgrade', upgrade)
  await new Promise<void>((resolve) => server.listen(0, () => resolve()))
  port = (server.address() as AddressInfo).port
})

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

function makeToken(tid: string): string {
  const payload: TokenPayload = {
    tid,
    iat: 0,
    exp: 9_999_999_999,
    scope: 'agent',
  }
  return signToken(payload, key)
}

describe('createWsUpgradeHandler', () => {
  it('accepts a WS connection with a valid token and registers the pairing', async () => {
    await seed(store, 't1')
    const token = makeToken('t1')
    const ws = new WebSocket(`ws://127.0.0.1:${port}/agent/ws?token=${encodeURIComponent(token)}`)
    await new Promise<void>((resolve) => ws.once('open', resolve))
    expect(registry.isPaired('t1')).toBe(true)
    ws.close()
    await new Promise<void>((resolve) => ws.once('close', resolve))
  })

  it('rejects a connection with a missing token (401 Unauthorized)', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/agent/ws`)
    await new Promise<void>((resolve) => {
      ws.on('unexpected-response', (_req, res) => {
        expect(res.statusCode).toBe(401)
        resolve()
      })
      ws.on('error', () => resolve())
    })
  })

  it('rejects a connection with a bad-signature token', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/agent/ws?token=llui-agent_bogus.sig`)
    await new Promise<void>((resolve) => {
      ws.on('unexpected-response', (_req, res) => {
        expect(res.statusCode).toBe(401)
        resolve()
      })
      ws.on('error', () => resolve())
    })
  })

  it('unregisters on socket close', async () => {
    await seed(store, 't2')
    const token = makeToken('t2')
    const ws = new WebSocket(`ws://127.0.0.1:${port}/agent/ws?token=${encodeURIComponent(token)}`)
    await new Promise<void>((resolve) => ws.once('open', resolve))
    ws.close()
    await new Promise<void>((resolve) => ws.once('close', resolve))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(registry.isPaired('t2')).toBe(false)
  })

  it('ignores non /agent/ws upgrade paths', async () => {
    // Send a GET with Upgrade to /other → handler should do nothing; connection hangs.
    // Simulate by trying to upgrade a different path and asserting the socket closes.
    // Simplified: the handler only runs on `server.on('upgrade')` dispatched events, so
    // an upgrade to /other would reach the handler too — but the handler's first check
    // is the path. Test by sending to `/other` and expecting 404/close.
    const ws = new WebSocket(`ws://127.0.0.1:${port}/other?token=x`)
    await new Promise<void>((resolve) => {
      ws.on('unexpected-response', (_req, res) => {
        expect(res.statusCode).toBe(404)
        resolve()
      })
      ws.on('error', () => resolve())
    })
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implementation**

```ts
import { WebSocketServer } from 'ws'
import type { WebSocket } from 'ws'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { WsPairingRegistry, PairingConnection } from './pairing-registry.js'
import type { TokenStore } from '../token-store.js'
import type { AuditSink } from '../audit.js'
import { verifyToken } from '../token.js'
import type { ClientFrame, ServerFrame } from '../../protocol.js'

export type UpgradeDeps = {
  signingKey: string | Uint8Array
  tokenStore: TokenStore
  registry: WsPairingRegistry
  auditSink: AuditSink
  now?: () => number
}

/**
 * Returns a handler for `server.on('upgrade', ...)`. Validates the token
 * from the query string, attaches to the registry, wires frame/close
 * routing. Unauthorized paths/tokens get a bare HTTP error response on
 * the raw socket (per RFC 6455 the response must be sent before the
 * socket is torn down).
 *
 * Spec §10.2, §10.4.
 */
export function createWsUpgradeHandler(deps: UpgradeDeps) {
  const wss = new WebSocketServer({ noServer: true })
  const now = deps.now ?? (() => Date.now())

  return (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    // Path check
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname !== '/agent/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
      socket.destroy()
      return
    }

    // Token — try query string first, then Authorization header
    let token = url.searchParams.get('token')
    if (!token) {
      const auth = req.headers['authorization']
      if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
        token = auth.slice('Bearer '.length)
      }
    }
    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }

    const verified = verifyToken(token, deps.signingKey)
    if (verified.kind !== 'ok') {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    const { tid } = verified.payload

    // Perform upgrade, wire to registry
    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      const conn: PairingConnection = {
        send(frame: ServerFrame) {
          ws.send(JSON.stringify(frame))
        },
        onFrame(handler) {
          ws.on('message', (data: Buffer | string) => {
            const raw = typeof data === 'string' ? data : data.toString('utf8')
            try {
              const parsed = JSON.parse(raw) as ClientFrame
              handler(parsed)
            } catch {
              // Ignore malformed frames.
            }
          })
        },
        onClose(handler) {
          ws.on('close', handler)
        },
        close() {
          ws.close()
        },
      }
      deps.registry.register(tid, conn)

      // Store touch; audit
      void deps.tokenStore.touch(tid, now())
      void deps.auditSink.write({
        at: now(),
        tid,
        uid: null,
        event: 'claim',
        detail: { transport: 'ws' },
      })
    })
  }
}
```

- [ ] **Step 4: Verify + commit**

```bash
cd packages/agent && pnpm vitest run test/server/ws/upgrade.test.ts
cd packages/agent && pnpm check
git add packages/agent/src/server/ws/upgrade.ts packages/agent/test/server/ws/upgrade.test.ts
git commit -m "$(cat <<'COMMIT'
feat(agent): /agent/ws upgrade handler — token-authed pairing

Bearer-token auth (query string or Authorization header). Wraps ws
into a PairingConnection and hands off to WsPairingRegistry. Rejects
non-/agent/ws paths with 404, missing/invalid tokens with 401.
Spec §10.2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Task 4: LAP `/describe` — cached-hello serving

**Files:**

- Create: `packages/agent/src/server/lap/describe.ts`
- Create: `packages/agent/test/server/lap/describe.test.ts`

- [ ] **Step 1: Test**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { handleLapDescribe } from '../../../src/server/lap/describe.js'
import {
  WsPairingRegistry,
  type PairingConnection,
} from '../../../src/server/ws/pairing-registry.js'
import { InMemoryTokenStore } from '../../../src/server/token-store.js'
import { signToken } from '../../../src/server/token.js'
import type { HelloFrame, LapDescribeResponse, TokenRecord } from '../../../src/protocol.js'

const key = 'x'.repeat(32)

function fakeConn(): PairingConnection & { emit: (f: HelloFrame) => void } {
  let onFrame: (f: unknown) => void = () => {}
  return {
    send: () => {},
    onFrame(h: (f: unknown) => void) {
      onFrame = h
    },
    onClose: () => {},
    close: () => {},
    emit: (f: HelloFrame) => onFrame(f),
  } as unknown as PairingConnection & { emit: (f: HelloFrame) => void }
}

let store: InMemoryTokenStore
let registry: WsPairingRegistry
beforeEach(() => {
  store = new InMemoryTokenStore()
  registry = new WsPairingRegistry()
})

const seed = async (tid: string): Promise<void> => {
  const rec: TokenRecord = {
    tid,
    uid: 'u1',
    status: 'active',
    createdAt: 0,
    lastSeenAt: 0,
    pendingResumeUntil: null,
    origin: 'https://app',
    label: null,
  }
  await store.create(rec)
}

const mkRequest = (token: string): Request =>
  new Request('https://app/agent/lap/v1/describe', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  })

const validToken = (tid: string): string =>
  signToken({ tid, iat: 0, exp: 9_999_999_999, scope: 'agent' }, key)

describe('handleLapDescribe', () => {
  it('serves the cached hello payload', async () => {
    await seed('t1')
    const conn = fakeConn()
    registry.register('t1', conn)
    conn.emit({
      t: 'hello',
      appName: 'Kanban',
      appVersion: '1.0',
      msgSchema: {
        inc: {
          payloadSchema: {},
          annotations: {
            intent: 'inc',
            alwaysAffordable: false,
            requiresConfirm: false,
            humanOnly: false,
          },
        },
      },
      stateSchema: { count: 'number' },
      affordancesSample: [],
      docs: { purpose: 'Demo' },
      schemaHash: 'abc',
    })
    const res = await handleLapDescribe(mkRequest(validToken('t1')), {
      signingKey: key,
      tokenStore: store,
      registry,
      auditSink: { write: () => {} },
      now: () => 1000,
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as LapDescribeResponse
    expect(body.name).toBe('Kanban')
    expect(body.docs?.purpose).toBe('Demo')
    expect(body.messages.inc.intent).toBe('inc')
    expect(body.schemaHash).toBe('abc')
  })

  it('returns 503 paused when no pairing is live', async () => {
    await seed('t1')
    // No registry.register(...)
    const res = await handleLapDescribe(mkRequest(validToken('t1')), {
      signingKey: key,
      tokenStore: store,
      registry,
      auditSink: { write: () => {} },
      now: () => 1000,
    })
    expect(res.status).toBe(503)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('paused')
  })

  it('returns 503 paused when WS is live but no hello has arrived yet', async () => {
    await seed('t1')
    const conn = fakeConn()
    registry.register('t1', conn)
    const res = await handleLapDescribe(mkRequest(validToken('t1')), {
      signingKey: key,
      tokenStore: store,
      registry,
      auditSink: { write: () => {} },
      now: () => 1000,
    })
    expect(res.status).toBe(503)
  })

  it('rejects bearer-less requests with 401', async () => {
    const req = new Request('https://app/agent/lap/v1/describe', { method: 'POST' })
    const res = await handleLapDescribe(req, {
      signingKey: key,
      tokenStore: store,
      registry,
      auditSink: { write: () => {} },
      now: () => 1000,
    })
    expect(res.status).toBe(401)
  })

  it('rejects revoked tokens with 403', async () => {
    await seed('t1')
    await store.revoke('t1')
    const res = await handleLapDescribe(mkRequest(validToken('t1')), {
      signingKey: key,
      tokenStore: store,
      registry,
      auditSink: { write: () => {} },
      now: () => 1000,
    })
    expect(res.status).toBe(403)
  })
})
```

- [ ] **Step 2: Implementation**

Create `packages/agent/src/server/lap/describe.ts`:

```ts
import { verifyToken } from '../token.js'
import type { TokenStore } from '../token-store.js'
import type { WsPairingRegistry } from '../ws/pairing-registry.js'
import type { AuditSink } from '../audit.js'
import type { LapDescribeResponse, MessageSchemaEntry } from '../../protocol.js'

export type LapDescribeDeps = {
  signingKey: string | Uint8Array
  tokenStore: TokenStore
  registry: WsPairingRegistry
  auditSink: AuditSink
  now?: () => number
}

export async function handleLapDescribe(req: Request, deps: LapDescribeDeps): Promise<Response> {
  const auth = extractAuth(req)
  if (!auth.ok) return json({ error: { code: 'auth-failed' } }, 401)
  const rec = await deps.tokenStore.findByTid(auth.tid)
  if (!rec || rec.status === 'revoked') return json({ error: { code: 'revoked' } }, 403)
  if (!deps.registry.isPaired(auth.tid)) return json({ error: { code: 'paused' } }, 503)

  const hello = deps.registry.getHello(auth.tid)
  if (!hello) return json({ error: { code: 'paused' } }, 503)

  const messages: Record<string, MessageSchemaEntry> = hello.msgSchema as Record<
    string,
    MessageSchemaEntry
  >

  const out: LapDescribeResponse = {
    name: hello.appName,
    version: hello.appVersion,
    stateSchema: hello.stateSchema,
    messages,
    docs: hello.docs,
    conventions: {
      dispatchModel: 'TEA',
      confirmationModel: 'runtime-mediated',
      readSurfaces: ['state', 'query_dom', 'describe_visible_content', 'describe_context'],
    },
    schemaHash: hello.schemaHash,
  }

  const nowMs = (deps.now ?? (() => Date.now()))()
  await deps.tokenStore.touch(auth.tid, nowMs)
  await deps.auditSink.write({
    at: nowMs,
    tid: auth.tid,
    uid: rec.uid,
    event: 'lap-call',
    detail: { path: '/lap/v1/describe' },
  })

  return json(out, 200)
}

export function extractAuth(req: Request): { ok: true; tid: string } | { ok: false } {
  const auth = req.headers.get('authorization')
  if (!auth || !auth.startsWith('Bearer ')) return { ok: false }
  const token = auth.slice('Bearer '.length)
  // Token verification is done inline but without the signing key — done by the caller.
  // We only need to parse the payload out to get tid.
  // For handlers we actually do verify with the key since each handler has deps.signingKey.
  // Keep this extractAuth for tid-only parsing after verify succeeds.
  return { ok: false } // placeholder — real code uses verifyTokenAndReadTid below
}

// Actual auth helper that verifies + returns tid:
export function verifyAndReadTid(
  req: Request,
  key: string | Uint8Array,
): { ok: true; tid: string } | { ok: false; status: number; code: string } {
  const auth = req.headers.get('authorization')
  if (!auth || !auth.startsWith('Bearer ')) return { ok: false, status: 401, code: 'auth-failed' }
  const token = auth.slice('Bearer '.length)
  const v = verifyToken(token, key)
  if (v.kind !== 'ok') return { ok: false, status: 401, code: 'auth-failed' }
  return { ok: true, tid: v.payload.tid }
}

function json(b: unknown, s: number): Response {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { 'content-type': 'application/json' },
  })
}
```

Wait — the above has a leftover `extractAuth` placeholder. Clean up: delete `extractAuth` (unused placeholder), inline `verifyAndReadTid` in `handleLapDescribe`:

**Revised `packages/agent/src/server/lap/describe.ts`:**

```ts
import { verifyToken } from '../token.js'
import type { TokenStore } from '../token-store.js'
import type { WsPairingRegistry } from '../ws/pairing-registry.js'
import type { AuditSink } from '../audit.js'
import type { LapDescribeResponse, MessageSchemaEntry } from '../../protocol.js'

export type LapDescribeDeps = {
  signingKey: string | Uint8Array
  tokenStore: TokenStore
  registry: WsPairingRegistry
  auditSink: AuditSink
  now?: () => number
}

export async function handleLapDescribe(req: Request, deps: LapDescribeDeps): Promise<Response> {
  const auth = verifyAndReadTid(req, deps.signingKey)
  if (!auth.ok) return json({ error: { code: auth.code } }, auth.status)

  const rec = await deps.tokenStore.findByTid(auth.tid)
  if (!rec || rec.status === 'revoked') return json({ error: { code: 'revoked' } }, 403)
  if (!deps.registry.isPaired(auth.tid)) return json({ error: { code: 'paused' } }, 503)

  const hello = deps.registry.getHello(auth.tid)
  if (!hello) return json({ error: { code: 'paused' } }, 503)

  const messages: Record<string, MessageSchemaEntry> = hello.msgSchema as Record<
    string,
    MessageSchemaEntry
  >
  const out: LapDescribeResponse = {
    name: hello.appName,
    version: hello.appVersion,
    stateSchema: hello.stateSchema,
    messages,
    docs: hello.docs,
    conventions: {
      dispatchModel: 'TEA',
      confirmationModel: 'runtime-mediated',
      readSurfaces: ['state', 'query_dom', 'describe_visible_content', 'describe_context'],
    },
    schemaHash: hello.schemaHash,
  }

  const nowMs = (deps.now ?? (() => Date.now()))()
  await deps.tokenStore.touch(auth.tid, nowMs)
  await deps.auditSink.write({
    at: nowMs,
    tid: auth.tid,
    uid: rec.uid,
    event: 'lap-call',
    detail: { path: '/lap/v1/describe' },
  })
  return json(out, 200)
}

export function verifyAndReadTid(
  req: Request,
  key: string | Uint8Array,
): { ok: true; tid: string } | { ok: false; status: number; code: string } {
  const auth = req.headers.get('authorization')
  if (!auth || !auth.startsWith('Bearer ')) return { ok: false, status: 401, code: 'auth-failed' }
  const token = auth.slice('Bearer '.length)
  const v = verifyToken(token, key)
  if (v.kind !== 'ok') return { ok: false, status: 401, code: 'auth-failed' }
  return { ok: true, tid: v.payload.tid }
}

function json(b: unknown, s: number): Response {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { 'content-type': 'application/json' },
  })
}
```

- [ ] **Step 3: Verify + commit**

```bash
cd packages/agent && pnpm vitest run test/server/lap/describe.test.ts
cd packages/agent && pnpm check
git add packages/agent/src/server/lap/describe.ts packages/agent/test/server/lap/describe.test.ts
git commit -m "$(cat <<'COMMIT'
feat(agent): /lap/v1/describe — cached-hello serving

Returns the LapDescribeResponse composed from the browser's cached
hello frame. 503 paused if no live pairing or no hello yet, 401 for
bad token, 403 for revoked. Emits lap-call audit entry. Also exports
verifyAndReadTid — shared by all LAP handlers. Spec §7.1, §7.4, §8.2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Task 5: LAP simple-forward handlers (5 endpoints sharing one pattern)

**Files:**

- Create: `packages/agent/src/server/lap/forward.ts`
- Create: `packages/agent/test/server/lap/simple-forwards.test.ts`

All 5 of these follow the same pattern: auth → look up rec → check pairing → registry.rpc(tool, args) → response.

The 5 endpoints:

- `/lap/v1/state` → tool `get_state`, args `{ path? }`
- `/lap/v1/actions` → tool `list_actions`, args `{}`
- `/lap/v1/query-dom` → tool `query_dom`, args `{ name, multiple? }`
- `/lap/v1/describe-visible` → tool `describe_visible_content`, args `{}`
- `/lap/v1/context` → tool `describe_context`, args `{}`

- [ ] **Step 1: forward.ts — shared helper**

```ts
import type { TokenStore } from '../token-store.js'
import type { WsPairingRegistry } from '../ws/pairing-registry.js'
import type { AuditSink } from '../audit.js'
import { verifyAndReadTid } from './describe.js'

export type ForwardDeps = {
  signingKey: string | Uint8Array
  tokenStore: TokenStore
  registry: WsPairingRegistry
  auditSink: AuditSink
  now?: () => number
}

/**
 * Generic LAP handler. `parseArgs` is called with the parsed body (may be
 * null for empty bodies); it returns the args object to forward or null
 * to reject as invalid. `tool` is the browser-side tool name.
 */
export function makeForwardHandler(
  tool: string,
  parseArgs: (body: unknown) => object | null,
  auditDetail: (tid: string, args: object) => Record<string, unknown> = () => ({}),
) {
  return async (req: Request, deps: ForwardDeps): Promise<Response> => {
    const auth = verifyAndReadTid(req, deps.signingKey)
    if (!auth.ok) return json({ error: { code: auth.code } }, auth.status)

    const rec = await deps.tokenStore.findByTid(auth.tid)
    if (!rec || rec.status === 'revoked') return json({ error: { code: 'revoked' } }, 403)
    if (!deps.registry.isPaired(auth.tid)) return json({ error: { code: 'paused' } }, 503)

    const rawBody = req.method === 'POST' ? await req.json().catch(() => null) : null
    const args = parseArgs(rawBody)
    if (args === null) return json({ error: { code: 'invalid' } }, 400)

    try {
      const result = await deps.registry.rpc(auth.tid, tool, args)
      const nowMs = (deps.now ?? (() => Date.now()))()
      await deps.tokenStore.touch(auth.tid, nowMs)
      await deps.auditSink.write({
        at: nowMs,
        tid: auth.tid,
        uid: rec.uid,
        event: 'lap-call',
        detail: { tool, ...auditDetail(auth.tid, args) },
      })
      return json(result, 200)
    } catch (e: unknown) {
      const err = e as { code?: string; detail?: string }
      const code = err.code ?? 'internal'
      const status = code === 'paused' ? 503 : code === 'timeout' ? 504 : 500
      return json({ error: { code, detail: err.detail } }, status)
    }
  }
}

function json(b: unknown, s: number): Response {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { 'content-type': 'application/json' },
  })
}

// Concrete handlers:
export const handleLapState = makeForwardHandler('get_state', (body) => {
  const b = (body ?? {}) as { path?: unknown }
  if (b.path !== undefined && typeof b.path !== 'string') return null
  return { path: b.path }
})

export const handleLapActions = makeForwardHandler('list_actions', () => ({}))

export const handleLapQueryDom = makeForwardHandler('query_dom', (body) => {
  const b = (body ?? {}) as { name?: unknown; multiple?: unknown }
  if (typeof b.name !== 'string') return null
  return { name: b.name, multiple: !!b.multiple }
})

export const handleLapDescribeVisible = makeForwardHandler('describe_visible_content', () => ({}))

export const handleLapContext = makeForwardHandler('describe_context', () => ({}))
```

- [ ] **Step 2: simple-forwards.test.ts — integration with fake registry**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  handleLapState,
  handleLapActions,
  handleLapQueryDom,
  handleLapDescribeVisible,
  handleLapContext,
} from '../../../src/server/lap/forward.js'
import { WsPairingRegistry } from '../../../src/server/ws/pairing-registry.js'
import { InMemoryTokenStore } from '../../../src/server/token-store.js'
import { signToken } from '../../../src/server/token.js'
import type { TokenRecord } from '../../../src/protocol.js'

const key = 'x'.repeat(32)
const validToken = (tid: string) =>
  signToken({ tid, iat: 0, exp: 9_999_999_999, scope: 'agent' }, key)
const seed = async (store: InMemoryTokenStore, tid: string) => {
  const rec: TokenRecord = {
    tid,
    uid: 'u1',
    status: 'active',
    createdAt: 0,
    lastSeenAt: 0,
    pendingResumeUntil: null,
    origin: 'https://app',
    label: null,
  }
  await store.create(rec)
}

let store: InMemoryTokenStore
let registry: WsPairingRegistry
let rpcSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  store = new InMemoryTokenStore()
  registry = new WsPairingRegistry()
  rpcSpy = vi.spyOn(registry, 'rpc').mockImplementation(async (_tid, tool, args) => {
    return { _tool: tool, _args: args }
  })
  vi.spyOn(registry, 'isPaired').mockReturnValue(true)
})

function mkReq(path: string, body: unknown): Request {
  return new Request(`https://app${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${validToken('t1')}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const deps = () => ({
  signingKey: key,
  tokenStore: store,
  registry,
  auditSink: { write: () => {} },
  now: () => 1,
})

describe('LAP simple-forward handlers', () => {
  beforeEach(async () => {
    await seed(store, 't1')
  })

  it('/state forwards get_state with {path}', async () => {
    const res = await handleLapState(mkReq('/lap/v1/state', { path: '/x' }), deps())
    expect(res.status).toBe(200)
    expect(rpcSpy).toHaveBeenCalledWith('t1', 'get_state', { path: '/x' })
  })

  it('/state rejects a non-string path with 400', async () => {
    const res = await handleLapState(mkReq('/lap/v1/state', { path: 123 }), deps())
    expect(res.status).toBe(400)
  })

  it('/actions forwards list_actions with {}', async () => {
    const res = await handleLapActions(mkReq('/lap/v1/actions', {}), deps())
    expect(res.status).toBe(200)
    expect(rpcSpy).toHaveBeenCalledWith('t1', 'list_actions', {})
  })

  it('/query-dom forwards {name, multiple}', async () => {
    const res = await handleLapQueryDom(
      mkReq('/lap/v1/query-dom', { name: 'email', multiple: true }),
      deps(),
    )
    expect(res.status).toBe(200)
    expect(rpcSpy).toHaveBeenCalledWith('t1', 'query_dom', { name: 'email', multiple: true })
  })

  it('/query-dom rejects missing name', async () => {
    const res = await handleLapQueryDom(mkReq('/lap/v1/query-dom', {}), deps())
    expect(res.status).toBe(400)
  })

  it('/describe-visible forwards describe_visible_content with {}', async () => {
    const res = await handleLapDescribeVisible(mkReq('/lap/v1/describe-visible', {}), deps())
    expect(res.status).toBe(200)
    expect(rpcSpy).toHaveBeenCalledWith('t1', 'describe_visible_content', {})
  })

  it('/context forwards describe_context with {}', async () => {
    const res = await handleLapContext(mkReq('/lap/v1/context', {}), deps())
    expect(res.status).toBe(200)
    expect(rpcSpy).toHaveBeenCalledWith('t1', 'describe_context', {})
  })

  it('returns 503 paused when registry rpc rejects with paused', async () => {
    rpcSpy.mockRejectedValueOnce({ code: 'paused' })
    const res = await handleLapState(mkReq('/lap/v1/state', {}), deps())
    expect(res.status).toBe(503)
  })

  it('returns 504 timeout when registry rpc rejects with timeout', async () => {
    rpcSpy.mockRejectedValueOnce({ code: 'timeout' })
    const res = await handleLapState(mkReq('/lap/v1/state', {}), deps())
    expect(res.status).toBe(504)
  })
})
```

- [ ] **Step 3: Verify + commit**

```bash
cd packages/agent && pnpm vitest run test/server/lap/simple-forwards.test.ts
cd packages/agent && pnpm check
git add packages/agent/src/server/lap/forward.ts packages/agent/test/server/lap/simple-forwards.test.ts
git commit -m "$(cat <<'COMMIT'
feat(agent): LAP state/actions/query-dom/describe-visible/context handlers

All five share a makeForwardHandler helper: auth → token-status check
→ rpc via registry → reply. Distinct tools and arg parsing per
endpoint. 503/504 mapping for paused/timeout. Spec §7.1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Task 6: LAP `/message` — long-poll pending-confirmation

**Files:**

- Create: `packages/agent/src/server/lap/message.ts`
- Create: `packages/agent/test/server/lap/message.test.ts`

Spec semantics:

- Browser may reply `dispatched` → return immediately.
- Browser may reply `rejected` → return immediately.
- Browser may reply `pending-confirmation` → server holds HTTP response up to `timeoutMs`, waits for `confirm-resolved` frame, returns `confirmed`/`rejected`.
- Browser may reply `confirmed` (if user resolved super fast) → return.

- [ ] **Step 1: Implementation**

```ts
import type { TokenStore } from '../token-store.js'
import type { WsPairingRegistry } from '../ws/pairing-registry.js'
import type { AuditSink } from '../audit.js'
import { verifyAndReadTid } from './describe.js'
import type { LapMessageRequest, LapMessageResponse } from '../../protocol.js'

export type LapMessageDeps = {
  signingKey: string | Uint8Array
  tokenStore: TokenStore
  registry: WsPairingRegistry
  auditSink: AuditSink
  now?: () => number
}

export async function handleLapMessage(req: Request, deps: LapMessageDeps): Promise<Response> {
  const auth = verifyAndReadTid(req, deps.signingKey)
  if (!auth.ok) return json({ error: { code: auth.code } }, auth.status)

  const rec = await deps.tokenStore.findByTid(auth.tid)
  if (!rec || rec.status === 'revoked') return json({ error: { code: 'revoked' } }, 403)
  if (!deps.registry.isPaired(auth.tid)) return json({ error: { code: 'paused' } }, 503)

  const body = (await req.json().catch(() => null)) as LapMessageRequest | null
  if (!body || !body.msg || typeof body.msg.type !== 'string') {
    return json({ error: { code: 'invalid' } }, 400)
  }

  const timeoutMs = body.timeoutMs ?? 15_000

  let initial: LapMessageResponse
  try {
    initial = (await deps.registry.rpc(auth.tid, 'send_message', body, {
      timeoutMs,
    })) as LapMessageResponse
  } catch (e: unknown) {
    const err = e as { code?: string; detail?: string }
    const status = err.code === 'paused' ? 503 : err.code === 'timeout' ? 504 : 500
    return json({ error: { code: err.code ?? 'internal', detail: err.detail } }, status)
  }

  const nowMs = (deps.now ?? (() => Date.now()))()
  await deps.tokenStore.touch(auth.tid, nowMs)

  if (
    initial.status === 'dispatched' ||
    initial.status === 'confirmed' ||
    initial.status === 'rejected'
  ) {
    await deps.auditSink.write({
      at: nowMs,
      tid: auth.tid,
      uid: rec.uid,
      event: initial.status === 'rejected' ? 'msg-blocked' : 'msg-dispatched',
      detail: { variant: body.msg.type, status: initial.status },
    })
    return json(initial, 200)
  }

  if (initial.status === 'pending-confirmation') {
    await deps.auditSink.write({
      at: nowMs,
      tid: auth.tid,
      uid: rec.uid,
      event: 'confirm-proposed',
      detail: { variant: body.msg.type, confirmId: initial.confirmId },
    })
    const resolved = await deps.registry.waitForConfirm(auth.tid, initial.confirmId, timeoutMs)
    const nowMs2 = (deps.now ?? (() => Date.now()))()
    if (resolved.outcome === 'confirmed') {
      await deps.auditSink.write({
        at: nowMs2,
        tid: auth.tid,
        uid: rec.uid,
        event: 'confirm-approved',
        detail: { variant: body.msg.type, confirmId: initial.confirmId },
      })
      return json(
        { status: 'confirmed', stateAfter: resolved.stateAfter } satisfies LapMessageResponse,
        200,
      )
    }
    await deps.auditSink.write({
      at: nowMs2,
      tid: auth.tid,
      uid: rec.uid,
      event: 'confirm-rejected',
      detail: { variant: body.msg.type, confirmId: initial.confirmId },
    })
    return json({ status: 'rejected', reason: 'user-cancelled' } satisfies LapMessageResponse, 200)
  }

  return json({ error: { code: 'internal', detail: 'unknown browser status' } }, 500)
}

function json(b: unknown, s: number): Response {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { 'content-type': 'application/json' },
  })
}
```

- [ ] **Step 2: Test — covers all four browser paths**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { handleLapMessage } from '../../../src/server/lap/message.js'
import { WsPairingRegistry } from '../../../src/server/ws/pairing-registry.js'
import { InMemoryTokenStore } from '../../../src/server/token-store.js'
import { signToken } from '../../../src/server/token.js'
import type { TokenRecord, LapMessageResponse } from '../../../src/protocol.js'

const key = 'x'.repeat(32)
const validToken = (tid: string) =>
  signToken({ tid, iat: 0, exp: 9_999_999_999, scope: 'agent' }, key)
const seed = async (store: InMemoryTokenStore, tid: string) => {
  const rec: TokenRecord = {
    tid,
    uid: 'u1',
    status: 'active',
    createdAt: 0,
    lastSeenAt: 0,
    pendingResumeUntil: null,
    origin: 'https://app',
    label: null,
  }
  await store.create(rec)
}

let store: InMemoryTokenStore
let registry: WsPairingRegistry
beforeEach(() => {
  store = new InMemoryTokenStore()
  registry = new WsPairingRegistry()
  vi.spyOn(registry, 'isPaired').mockReturnValue(true)
})

const deps = () => ({
  signingKey: key,
  tokenStore: store,
  registry,
  auditSink: { write: () => {} },
  now: () => 1,
})

const mkReq = (body: unknown): Request =>
  new Request('https://app/lap/v1/message', {
    method: 'POST',
    headers: { authorization: `Bearer ${validToken('t1')}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('handleLapMessage', () => {
  beforeEach(async () => {
    await seed(store, 't1')
  })

  it('returns dispatched when browser replies dispatched', async () => {
    vi.spyOn(registry, 'rpc').mockResolvedValue({ status: 'dispatched', stateAfter: { n: 1 } })
    const res = await handleLapMessage(mkReq({ msg: { type: 'inc' } }), deps())
    expect(res.status).toBe(200)
    const body = (await res.json()) as LapMessageResponse
    expect(body.status).toBe('dispatched')
  })

  it('returns rejected when browser replies rejected', async () => {
    vi.spyOn(registry, 'rpc').mockResolvedValue({ status: 'rejected', reason: 'humanOnly' })
    const res = await handleLapMessage(mkReq({ msg: { type: 'delete' } }), deps())
    const body = (await res.json()) as LapMessageResponse
    expect(body.status).toBe('rejected')
  })

  it('long-polls on pending-confirmation and resolves to confirmed', async () => {
    vi.spyOn(registry, 'rpc').mockResolvedValue({ status: 'pending-confirmation', confirmId: 'c1' })
    vi.spyOn(registry, 'waitForConfirm').mockResolvedValue({
      outcome: 'confirmed',
      stateAfter: { ok: true },
    })
    const res = await handleLapMessage(mkReq({ msg: { type: 'delete' } }), deps())
    const body = (await res.json()) as LapMessageResponse
    expect(body.status).toBe('confirmed')
    if (body.status === 'confirmed') expect(body.stateAfter).toEqual({ ok: true })
  })

  it('long-polls on pending-confirmation and resolves to rejected on user-cancelled', async () => {
    vi.spyOn(registry, 'rpc').mockResolvedValue({ status: 'pending-confirmation', confirmId: 'c1' })
    vi.spyOn(registry, 'waitForConfirm').mockResolvedValue({ outcome: 'user-cancelled' })
    const res = await handleLapMessage(mkReq({ msg: { type: 'delete' } }), deps())
    const body = (await res.json()) as LapMessageResponse
    expect(body.status).toBe('rejected')
    if (body.status === 'rejected') expect(body.reason).toBe('user-cancelled')
  })

  it('rejects missing msg.type with 400', async () => {
    const res = await handleLapMessage(mkReq({}), deps())
    expect(res.status).toBe(400)
  })

  it('returns 503 paused when registry rpc rejects with paused', async () => {
    vi.spyOn(registry, 'rpc').mockRejectedValue({ code: 'paused' })
    const res = await handleLapMessage(mkReq({ msg: { type: 'inc' } }), deps())
    expect(res.status).toBe(503)
  })
})
```

- [ ] **Step 3: Verify + commit**

```bash
cd packages/agent && pnpm vitest run test/server/lap/message.test.ts
cd packages/agent && pnpm check
git add packages/agent/src/server/lap/message.ts packages/agent/test/server/lap/message.test.ts
git commit -m "$(cat <<'COMMIT'
feat(agent): /lap/v1/message — dispatch + pending-confirmation long-poll

Browser reply of dispatched / rejected returns inline. pending-
confirmation holds the HTTP response up to timeoutMs, awaiting a
confirm-resolved frame. Emits confirm-proposed / confirm-approved /
confirm-rejected audit entries through the flow. Spec §7.1, §10.4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Task 7: LAP `/wait` + `/confirm-result`

**Files:**

- Create: `packages/agent/src/server/lap/wait.ts`
- Create: `packages/agent/src/server/lap/confirm-result.ts`
- Create: `packages/agent/test/server/lap/wait.test.ts`
- Create: `packages/agent/test/server/lap/confirm-result.test.ts`

- [ ] **Step 1: wait.ts**

```ts
import type { TokenStore } from '../token-store.js'
import type { WsPairingRegistry } from '../ws/pairing-registry.js'
import type { AuditSink } from '../audit.js'
import { verifyAndReadTid } from './describe.js'
import type { LapWaitRequest, LapWaitResponse } from '../../protocol.js'

export type LapWaitDeps = {
  signingKey: string | Uint8Array
  tokenStore: TokenStore
  registry: WsPairingRegistry
  auditSink: AuditSink
  now?: () => number
}

export async function handleLapWait(req: Request, deps: LapWaitDeps): Promise<Response> {
  const auth = verifyAndReadTid(req, deps.signingKey)
  if (!auth.ok) return json({ error: { code: auth.code } }, auth.status)

  const rec = await deps.tokenStore.findByTid(auth.tid)
  if (!rec || rec.status === 'revoked') return json({ error: { code: 'revoked' } }, 403)
  if (!deps.registry.isPaired(auth.tid)) return json({ error: { code: 'paused' } }, 503)

  const body = ((await req.json().catch(() => null)) ?? {}) as LapWaitRequest
  const timeoutMs = body.timeoutMs ?? 10_000
  const result = await deps.registry.waitForChange(auth.tid, body.path, timeoutMs)
  const out: LapWaitResponse = result

  const nowMs = (deps.now ?? (() => Date.now()))()
  await deps.auditSink.write({
    at: nowMs,
    tid: auth.tid,
    uid: rec.uid,
    event: 'lap-call',
    detail: { path: '/lap/v1/wait', outcome: result.status },
  })
  return json(out, 200)
}

function json(b: unknown, s: number): Response {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { 'content-type': 'application/json' },
  })
}
```

- [ ] **Step 2: confirm-result.ts**

```ts
import type { TokenStore } from '../token-store.js'
import type { WsPairingRegistry } from '../ws/pairing-registry.js'
import type { AuditSink } from '../audit.js'
import { verifyAndReadTid } from './describe.js'
import type { LapConfirmResultRequest, LapConfirmResultResponse } from '../../protocol.js'

export type LapConfirmResultDeps = {
  signingKey: string | Uint8Array
  tokenStore: TokenStore
  registry: WsPairingRegistry
  auditSink: AuditSink
  now?: () => number
}

export async function handleLapConfirmResult(
  req: Request,
  deps: LapConfirmResultDeps,
): Promise<Response> {
  const auth = verifyAndReadTid(req, deps.signingKey)
  if (!auth.ok) return json({ error: { code: auth.code } }, auth.status)

  const rec = await deps.tokenStore.findByTid(auth.tid)
  if (!rec || rec.status === 'revoked') return json({ error: { code: 'revoked' } }, 403)
  if (!deps.registry.isPaired(auth.tid)) return json({ error: { code: 'paused' } }, 503)

  const body = (await req.json().catch(() => null)) as LapConfirmResultRequest | null
  if (!body || typeof body.confirmId !== 'string') return json({ error: { code: 'invalid' } }, 400)
  const timeoutMs = body.timeoutMs ?? 5_000

  // Spec: if the confirm was already resolved during the earlier long-poll on
  // /message, there's no second resolution to wait for. In the current design
  // /confirm-result is ONLY used when /message bailed out early with
  // pending-confirmation. So we call waitForConfirm with the given timeoutMs.
  // If no resolution arrives in time, we surface 'still-pending'.
  const result = await deps.registry.waitForConfirm(auth.tid, body.confirmId, timeoutMs)

  const nowMs = (deps.now ?? (() => Date.now()))()
  if (result.outcome === 'confirmed') {
    await deps.auditSink.write({
      at: nowMs,
      tid: auth.tid,
      uid: rec.uid,
      event: 'confirm-approved',
      detail: { confirmId: body.confirmId },
    })
    return json(
      { status: 'confirmed', stateAfter: result.stateAfter } satisfies LapConfirmResultResponse,
      200,
    )
  }
  // user-cancelled OR timeout. WsPairingRegistry returns user-cancelled on timeout too;
  // we distinguish by checking whether the confirm is still in registry.pendingConfirm —
  // but pendingConfirm cleanup happens inside waitForConfirm's timer, so we can't peek.
  // For v1: treat user-cancelled as user-cancelled; treat explicit timeout as timeout by
  // comparing elapsed vs. timeoutMs. Simpler: just return 'still-pending' on the timeout
  // branch to let Claude poll again. Registry returns {outcome: 'user-cancelled'} on
  // both timer and actual cancel — so we can't distinguish. Punt: return 'user-cancelled'
  // (matches registry semantics). Spec §8.2 get_confirm_result allows 'user-cancelled' |
  // 'timeout' | 'still-pending' — a refinement to distinguish is follow-up work.
  await deps.auditSink.write({
    at: nowMs,
    tid: auth.tid,
    uid: rec.uid,
    event: 'confirm-rejected',
    detail: { confirmId: body.confirmId },
  })
  return json(
    { status: 'rejected', reason: 'user-cancelled' } satisfies LapConfirmResultResponse,
    200,
  )
}

function json(b: unknown, s: number): Response {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { 'content-type': 'application/json' },
  })
}
```

- [ ] **Step 3: Tests (two files, both short)**

`wait.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { handleLapWait } from '../../../src/server/lap/wait.js'
import { WsPairingRegistry } from '../../../src/server/ws/pairing-registry.js'
import { InMemoryTokenStore } from '../../../src/server/token-store.js'
import { signToken } from '../../../src/server/token.js'
import type { TokenRecord, LapWaitResponse } from '../../../src/protocol.js'

const key = 'x'.repeat(32)
const validToken = (tid: string) =>
  signToken({ tid, iat: 0, exp: 9_999_999_999, scope: 'agent' }, key)
let store: InMemoryTokenStore
let registry: WsPairingRegistry
beforeEach(async () => {
  store = new InMemoryTokenStore()
  registry = new WsPairingRegistry()
  const rec: TokenRecord = {
    tid: 't1',
    uid: 'u1',
    status: 'active',
    createdAt: 0,
    lastSeenAt: 0,
    pendingResumeUntil: null,
    origin: 'https://app',
    label: null,
  }
  await store.create(rec)
  vi.spyOn(registry, 'isPaired').mockReturnValue(true)
})

const deps = () => ({
  signingKey: key,
  tokenStore: store,
  registry,
  auditSink: { write: () => {} },
  now: () => 1,
})

const req = (body: unknown): Request =>
  new Request('https://app/lap/v1/wait', {
    method: 'POST',
    headers: { authorization: `Bearer ${validToken('t1')}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('handleLapWait', () => {
  it('returns changed when registry.waitForChange resolves with a match', async () => {
    vi.spyOn(registry, 'waitForChange').mockResolvedValue({
      status: 'changed',
      stateAfter: { n: 2 },
    })
    const res = await handleLapWait(req({ path: '/count' }), deps())
    const body = (await res.json()) as LapWaitResponse
    expect(body.status).toBe('changed')
  })

  it('returns timeout when registry times out', async () => {
    vi.spyOn(registry, 'waitForChange').mockResolvedValue({ status: 'timeout', stateAfter: null })
    const res = await handleLapWait(req({ timeoutMs: 1 }), deps())
    const body = (await res.json()) as LapWaitResponse
    expect(body.status).toBe('timeout')
  })
})
```

`confirm-result.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { handleLapConfirmResult } from '../../../src/server/lap/confirm-result.js'
import { WsPairingRegistry } from '../../../src/server/ws/pairing-registry.js'
import { InMemoryTokenStore } from '../../../src/server/token-store.js'
import { signToken } from '../../../src/server/token.js'
import type { TokenRecord } from '../../../src/protocol.js'

const key = 'x'.repeat(32)
const validToken = (tid: string) =>
  signToken({ tid, iat: 0, exp: 9_999_999_999, scope: 'agent' }, key)
let store: InMemoryTokenStore
let registry: WsPairingRegistry
beforeEach(async () => {
  store = new InMemoryTokenStore()
  registry = new WsPairingRegistry()
  const rec: TokenRecord = {
    tid: 't1',
    uid: 'u1',
    status: 'active',
    createdAt: 0,
    lastSeenAt: 0,
    pendingResumeUntil: null,
    origin: 'https://app',
    label: null,
  }
  await store.create(rec)
  vi.spyOn(registry, 'isPaired').mockReturnValue(true)
})

const deps = () => ({
  signingKey: key,
  tokenStore: store,
  registry,
  auditSink: { write: () => {} },
  now: () => 1,
})

const req = (body: unknown): Request =>
  new Request('https://app/lap/v1/confirm-result', {
    method: 'POST',
    headers: { authorization: `Bearer ${validToken('t1')}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('handleLapConfirmResult', () => {
  it('returns confirmed when waitForConfirm resolves with confirmed', async () => {
    vi.spyOn(registry, 'waitForConfirm').mockResolvedValue({
      outcome: 'confirmed',
      stateAfter: { n: 2 },
    })
    const res = await handleLapConfirmResult(req({ confirmId: 'c1' }), deps())
    const body = (await res.json()) as { status: string }
    expect(body.status).toBe('confirmed')
  })

  it('returns rejected user-cancelled when waitForConfirm resolves cancelled', async () => {
    vi.spyOn(registry, 'waitForConfirm').mockResolvedValue({ outcome: 'user-cancelled' })
    const res = await handleLapConfirmResult(req({ confirmId: 'c1' }), deps())
    const body = (await res.json()) as { status: string; reason?: string }
    expect(body.status).toBe('rejected')
    expect(body.reason).toBe('user-cancelled')
  })

  it('rejects missing confirmId', async () => {
    const res = await handleLapConfirmResult(req({}), deps())
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 4: Verify + commit**

```bash
cd packages/agent && pnpm vitest run test/server/lap/wait.test.ts test/server/lap/confirm-result.test.ts
cd packages/agent && pnpm check
git add packages/agent/src/server/lap/wait.ts packages/agent/src/server/lap/confirm-result.ts packages/agent/test/server/lap/wait.test.ts packages/agent/test/server/lap/confirm-result.test.ts
git commit -m "$(cat <<'COMMIT'
feat(agent): /lap/v1/wait + /lap/v1/confirm-result

wait: registry.waitForChange + audit. confirm-result: registry.waitForConfirm
polling tool for Claude to re-check a pending-confirmation that bailed out
of the /message long-poll. Spec §7.1, §8.2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Task 8: LAP router + factory integration

**Files:**

- Create: `packages/agent/src/server/lap/router.ts`
- Create: `packages/agent/test/server/lap/router.test.ts`
- Modify: `packages/agent/src/server/factory.ts` (add `wsUpgrade` and compose LAP routes)
- Modify: `packages/agent/src/server/options.ts` (add `wsUpgrade` to `AgentServerHandle`)

- [ ] **Step 1: lap/router.ts**

```ts
import { handleLapDescribe } from './describe.js'
import {
  handleLapState,
  handleLapActions,
  handleLapQueryDom,
  handleLapDescribeVisible,
  handleLapContext,
  type ForwardDeps,
} from './forward.js'
import { handleLapMessage } from './message.js'
import { handleLapWait } from './wait.js'
import { handleLapConfirmResult } from './confirm-result.js'

export type LapRouterDeps = ForwardDeps

export function createLapRouter(
  deps: LapRouterDeps,
  basePath: string,
): (req: Request) => Promise<Response | null> {
  return async (req) => {
    const url = new URL(req.url)
    const path = url.pathname
    if (!path.startsWith(basePath + '/')) return null
    const tail = path.slice(basePath.length)
    switch (tail) {
      case '/describe':
        return handleLapDescribe(req, deps)
      case '/state':
        return handleLapState(req, deps)
      case '/actions':
        return handleLapActions(req, deps)
      case '/message':
        return handleLapMessage(req, deps)
      case '/confirm-result':
        return handleLapConfirmResult(req, deps)
      case '/wait':
        return handleLapWait(req, deps)
      case '/query-dom':
        return handleLapQueryDom(req, deps)
      case '/describe-visible':
        return handleLapDescribeVisible(req, deps)
      case '/context':
        return handleLapContext(req, deps)
      default:
        return null
    }
  }
}
```

- [ ] **Step 2: lap/router.test.ts**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createLapRouter } from '../../../src/server/lap/router.js'
import { WsPairingRegistry } from '../../../src/server/ws/pairing-registry.js'
import { InMemoryTokenStore } from '../../../src/server/token-store.js'
import { signToken } from '../../../src/server/token.js'
import type { TokenRecord } from '../../../src/protocol.js'

const key = 'x'.repeat(32)
const validToken = (tid: string) =>
  signToken({ tid, iat: 0, exp: 9_999_999_999, scope: 'agent' }, key)

describe('createLapRouter', () => {
  let store: InMemoryTokenStore
  let registry: WsPairingRegistry
  let router: (req: Request) => Promise<Response | null>
  beforeEach(async () => {
    store = new InMemoryTokenStore()
    registry = new WsPairingRegistry()
    const rec: TokenRecord = {
      tid: 't1',
      uid: 'u1',
      status: 'active',
      createdAt: 0,
      lastSeenAt: 0,
      pendingResumeUntil: null,
      origin: 'https://app',
      label: null,
    }
    await store.create(rec)
    vi.spyOn(registry, 'isPaired').mockReturnValue(true)
    vi.spyOn(registry, 'rpc').mockResolvedValue({ ok: true })
    router = createLapRouter(
      {
        signingKey: key,
        tokenStore: store,
        registry,
        auditSink: { write: () => {} },
      },
      '/agent/lap/v1',
    )
  })

  it('returns null for paths outside the base', async () => {
    expect(await router(new Request('https://app/unknown'))).toBeNull()
  })

  it('routes /agent/lap/v1/state', async () => {
    const res = await router(
      new Request('https://app/agent/lap/v1/state', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${validToken('t1')}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      }),
    )
    expect(res?.status).toBe(200)
  })

  it('returns null for unknown /agent/lap/v1/bogus', async () => {
    const res = await router(new Request('https://app/agent/lap/v1/bogus', { method: 'POST' }))
    expect(res).toBeNull()
  })
})
```

- [ ] **Step 3: Update `options.ts` — add `wsUpgrade` to the handle type**

```ts
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'

// ... existing imports preserved ...

export type AgentServerHandle = {
  router: (req: Request) => Promise<Response | null>
  wsUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void
}
```

- [ ] **Step 4: Rewrite `factory.ts` with WS + LAP composition**

```ts
import type { ServerOptions, AgentServerHandle } from './options.js'
import { InMemoryTokenStore } from './token-store.js'
import { consoleAuditSink } from './audit.js'
import { defaultRateLimiter } from './rate-limit.js'
import { createHttpRouter } from './http/router.js'
import { createLapRouter } from './lap/router.js'
import { WsPairingRegistry } from './ws/pairing-registry.js'
import { createWsUpgradeHandler } from './ws/upgrade.js'

const ANONYMOUS_RESOLVER = async () => null

export function createLluiAgentServer(opts: ServerOptions): AgentServerHandle {
  if (!opts.signingKey) {
    throw new Error('createLluiAgentServer: signingKey is required')
  }

  const tokenStore = opts.tokenStore ?? new InMemoryTokenStore()
  const identityResolver = opts.identityResolver ?? ANONYMOUS_RESOLVER
  const auditSink = opts.auditSink ?? consoleAuditSink
  const rateLimiter = opts.rateLimiter ?? defaultRateLimiter({ perBucket: '30/minute' })
  const lapBasePath = opts.lapBasePath ?? '/agent/lap/v1'

  const registry = new WsPairingRegistry()

  const httpRouter = createHttpRouter({
    signingKey: opts.signingKey,
    tokenStore,
    identityResolver,
    auditSink,
    lapBasePath,
  })

  const lapRouter = createLapRouter(
    {
      signingKey: opts.signingKey,
      tokenStore,
      registry,
      auditSink,
    },
    lapBasePath,
  )

  const router: AgentServerHandle['router'] = async (req) => {
    const lapRes = await lapRouter(req)
    if (lapRes) return lapRes
    return httpRouter(req)
  }

  const wsUpgrade = createWsUpgradeHandler({
    signingKey: opts.signingKey,
    tokenStore,
    registry,
    auditSink,
  })

  void rateLimiter // applied inside route handlers in future polish work

  return { router, wsUpgrade }
}
```

- [ ] **Step 5: Verify**

```bash
cd packages/agent && pnpm vitest run test/server/lap/router.test.ts
cd packages/agent && pnpm test
cd packages/agent && pnpm check
```

All green.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/server/lap/router.ts packages/agent/src/server/options.ts packages/agent/src/server/factory.ts packages/agent/test/server/lap/router.test.ts
git commit -m "$(cat <<'COMMIT'
feat(agent): LAP router + factory integration

Adds createLapRouter dispatching /agent/lap/v1/* to the 9 handlers;
wires the composite router (lap first, then http) plus wsUpgrade
into createLluiAgentServer. AgentServerHandle now exposes both
router and wsUpgrade. Spec §10.1, §10.4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Task 9: Integration test — mint → fake WS pair → describe → message

**Files:**

- Create: `packages/agent/test/server/integration.test.ts`

- [ ] **Step 1: Test**

```ts
import { describe, it, expect } from 'vitest'
import { createLluiAgentServer, InMemoryTokenStore } from '../../src/server/index.js'
import type {
  MintResponse,
  LapDescribeResponse,
  HelloFrame,
  ClientFrame,
  ServerFrame,
  PairingConnection,
} from '../../src/protocol.js'
import type { WsPairingRegistry } from '../../src/server/ws/pairing-registry.js'

const key = 'x'.repeat(32)

// Fake PairingConnection that captures sent frames and lets the test emit frames back.
function fakeConn(): PairingConnection & {
  emit: (f: ClientFrame) => void
  sent: ServerFrame[]
} {
  let onFrame: (f: ClientFrame) => void = () => {}
  const sent: ServerFrame[] = []
  return {
    send(f) {
      sent.push(f)
    },
    onFrame(h) {
      onFrame = h
    },
    onClose: () => {},
    close: () => {},
    emit: (f: ClientFrame) => onFrame(f),
    sent,
  } as unknown as PairingConnection & { emit: (f: ClientFrame) => void; sent: ServerFrame[] }
}

describe('full LAP flow — mint → register → describe → message', () => {
  it('end-to-end dispatched path', async () => {
    const store = new InMemoryTokenStore()
    const agent = createLluiAgentServer({
      signingKey: key,
      tokenStore: store,
      identityResolver: async () => 'u1',
      auditSink: { write: () => {} },
    })

    // 1. Mint
    const mintRes = await agent.router(
      new Request('https://app.example/agent/mint', { method: 'POST' }),
    )
    const mint = (await mintRes!.json()) as MintResponse

    // 2. Simulate WS pair — reach into the factory's registry via internal module import.
    //    Tests have access through the exported AgentServerHandle.wsUpgrade indirectly, but
    //    we don't want a real socket here. Instead, construct the registry manually and
    //    swap it via a test-only helper OR verify via the HTTP path that describe returns
    //    paused (valid coverage too).
    //
    //    Simpler route: the factory creates a registry internally; we can't get a handle on
    //    it from outside. So instead, test the "paused → describe fails" path here, and the
    //    full WS-pair integration lives in the WS-upgrade test (Task 3), which already uses
    //    a real http + ws server.

    const describeRes = await agent.router(
      new Request('https://app.example/agent/lap/v1/describe', {
        method: 'POST',
        headers: { authorization: `Bearer ${mint.token}` },
      }),
    )
    expect(describeRes?.status).toBe(503)
    const body = (await describeRes!.json()) as { error: { code: string } }
    expect(body.error.code).toBe('paused')
  })
})
```

NOTE: the above integration test is narrower than originally planned because the factory's internal WsPairingRegistry isn't exposed. Comprehensive WS-pair coverage lives in the upgrade test (Task 3). If you want full end-to-end WS+LAP, the factory needs a test-seam to override the registry. Consider adding one:

Optionally (only if the above test feels too thin), expose an `internal` export for tests:

```ts
// factory.ts
export function createLluiAgentServer(opts: ServerOptions): AgentServerHandle {
  /* existing */
}

export function __createLluiAgentServerForTest(
  opts: ServerOptions,
  overrides: { registry?: WsPairingRegistry } = {},
): AgentServerHandle & { registry: WsPairingRegistry } {
  const registry = overrides.registry ?? new WsPairingRegistry()
  // ... same as createLluiAgentServer but uses `registry` ...
  return { ...handle, registry }
}
```

Skip this for v1 unless the simpler test gives you pause. The simpler test already verifies the paused path and factory composition; the WS+describe full loop is covered by separate component tests.

- [ ] **Step 2: Verify + commit**

```bash
cd packages/agent && pnpm vitest run test/server/integration.test.ts
cd packages/agent && pnpm check
git add packages/agent/test/server/integration.test.ts
git commit -m "$(cat <<'COMMIT'
test(agent): integration — mint → unpaired describe returns paused

End-to-end exercise of createLluiAgentServer's HTTP surface via
public Request. Full WS+describe-cached coverage lives in the
upgrade test and the describe test.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Task 10: Workspace verification

```bash
cd /Users/franco/projects/llui
pnpm install
pnpm turbo build
pnpm turbo check
pnpm turbo lint
pnpm turbo test
```

All green. No regression.

No commit.

---

## Task 11: Commit plan file

```bash
cd /Users/franco/projects/llui
git add docs/superpowers/plans/2026-04-20-llui-agent-05-ws-lap.md
git commit -m "$(cat <<'COMMIT'
docs(agent): Plan 5 ws-lap — implementation plan document

11-task plan for WS bridge + LAP dispatch. Completes the server side:
WsPairingRegistry with rpc correlation, /agent/ws upgrade handler,
all 9 LAP endpoints (including describe from cached hello, simple-
forward handlers, long-poll message + wait, polling confirm-result),
and the combined factory composition.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Completion Criteria

- `WsPairingRegistry` correlates rpc IDs, caches hello payloads, supports `waitForConfirm` and `waitForChange`, cleans up on close.
- `/agent/ws` upgrade handler accepts valid tokens and rejects unauthorized requests.
- All 9 LAP endpoints are implemented and unit-tested.
- `createLluiAgentServer` returns `{ router, wsUpgrade }` with LAP routes ahead of HTTP routes in the router's dispatch order.
- `@llui/agent` package total test count ~105+ (was 78 at end of Plan 4).
- Full workspace turbo build/check/lint/test green.

---

## Explicitly deferred (Plan 6 and beyond)

- Rate-limit application inside LAP handlers (Plan 8 polish).
- `log-append` frame → audit sink wiring (Plan 8 polish).
- Stricter distinguishing of `user-cancelled` vs true `timeout` in `/confirm-result` (Plan 8 polish).
- Any browser-side code: `agentConnect`, `agentConfirm`, `agentLog`, `ws-client.ts`, effects — all in Plan 6.
