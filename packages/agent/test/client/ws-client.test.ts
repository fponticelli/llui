import { describe, it, expect, vi } from 'vitest'
import {
  attachWsClient,
  type WsLike,
  type RpcHosts,
  type HelloBuilder,
} from '../../src/client/ws-client.js'
import type { HelloFrame, ServerFrame, RpcFrame, LogEntry } from '../../src/protocol.js'

// A minimal fake WsLike backed by an event map so tests can fire events.
// The WsLike interface has overloaded addEventListener signatures, so we
// implement each overload explicitly and use a union internally.
class FakeWs implements WsLike {
  sent: string[] = []
  closed = false

  private _msgHandlers: Array<(e: { data: string | ArrayBuffer }) => void> = []
  private _openHandlers: Array<() => void> = []
  private _closeHandlers: Array<() => void> = []

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.closed = true
  }

  addEventListener(event: 'message', h: (e: { data: string | ArrayBuffer }) => void): void
  addEventListener(event: 'open' | 'close', h: () => void): void
  addEventListener(
    event: 'message' | 'open' | 'close',
    h: ((e: { data: string | ArrayBuffer }) => void) | (() => void),
  ): void {
    if (event === 'message') {
      this._msgHandlers.push(h as (e: { data: string | ArrayBuffer }) => void)
    } else if (event === 'open') {
      this._openHandlers.push(h as () => void)
    } else {
      this._closeHandlers.push(h as () => void)
    }
  }

  /** Fire an event on this fake WS. */
  emit(event: 'open' | 'close'): void
  emit(event: 'message', data: string): void
  emit(event: string, data?: string): void {
    if (event === 'message') {
      for (const h of this._msgHandlers) h({ data: data ?? '' })
    } else if (event === 'open') {
      for (const h of this._openHandlers) h()
    } else if (event === 'close') {
      for (const h of this._closeHandlers) h()
    }
  }
}

function makeRpcHosts(): RpcHosts {
  return {
    getState: () => ({ count: 5 }),
    send: vi.fn(),
    flush: vi.fn(),
    subscribe: () => () => {},
    getAndClearDrainErrors: () => [],
    getMsgAnnotations: () => null,
    getMsgSchema: () => null,
    getBindingDescriptors: () => null,
    getAgentAffordances: () => null,
    getAgentContext: () => null,
    getRootElement: () => null,
    proposeConfirm: vi.fn(),
    runReducer: () => null,
  }
}

function makeHelloBuilder(): HelloBuilder {
  return (): HelloFrame => ({
    t: 'hello',
    appName: 'test-app',
    appVersion: '0.0.1',
    msgSchema: {},
    stateSchema: {},
    affordancesSample: [],
    docs: null,
    schemaHash: 'abc123',
  })
}

describe('attachWsClient', () => {
  it('emits hello frame on open', () => {
    const ws = new FakeWs()
    attachWsClient(ws, makeRpcHosts(), makeHelloBuilder())

    ws.emit('open')

    expect(ws.sent).toHaveLength(1)
    const frame = JSON.parse(ws.sent[0]!)
    expect(frame.t).toBe('hello')
    expect(frame.appName).toBe('test-app')
  })

  it('valid rpc frame for get_state → sends rpc-reply with state, then log-append with kind "read"', async () => {
    const ws = new FakeWs()
    attachWsClient(ws, makeRpcHosts(), makeHelloBuilder())

    ws.emit('open')
    ws.sent.length = 0 // clear hello

    const rpc: RpcFrame = { t: 'rpc', id: 'req-1', tool: 'get_state', args: {} }
    ws.emit('message', JSON.stringify(rpc))

    // Allow async dispatch to complete
    await new Promise((r) => setTimeout(r, 0))

    expect(ws.sent).toHaveLength(2)
    const reply = JSON.parse(ws.sent[0]!)
    expect(reply.t).toBe('rpc-reply')
    expect(reply.id).toBe('req-1')
    expect(reply.result).toEqual({ state: { count: 5 } })
    const logFrame = JSON.parse(ws.sent[1]!)
    expect(logFrame.t).toBe('log-append')
    expect(logFrame.entry.kind).toBe('read')
    expect(logFrame.entry.id).toBe('req-1')
  })

  it('unknown tool → sends rpc-error with code "invalid", then log-append with kind "error"', async () => {
    const ws = new FakeWs()
    attachWsClient(ws, makeRpcHosts(), makeHelloBuilder())
    ws.emit('open')
    ws.sent.length = 0

    const rpc: ServerFrame = { t: 'rpc', id: 'req-2', tool: 'nonexistent_tool', args: {} }
    ws.emit('message', JSON.stringify(rpc))
    await new Promise((r) => setTimeout(r, 0))

    expect(ws.sent).toHaveLength(2)
    const errFrame = JSON.parse(ws.sent[0]!)
    expect(errFrame.t).toBe('rpc-error')
    expect(errFrame.id).toBe('req-2')
    expect(errFrame.code).toBe('invalid')
    const logFrame = JSON.parse(ws.sent[1]!)
    expect(logFrame.t).toBe('log-append')
    expect(logFrame.entry.kind).toBe('error')
  })

  it('revoked frame → closes the socket', async () => {
    const ws = new FakeWs()
    attachWsClient(ws, makeRpcHosts(), makeHelloBuilder())

    ws.emit('message', JSON.stringify({ t: 'revoked' }))
    await new Promise((r) => setTimeout(r, 0))

    expect(ws.closed).toBe(true)
  })

  it('resolveConfirm("confirmed", state) → emits confirm-resolved frame with stateAfter', () => {
    const ws = new FakeWs()
    const client = attachWsClient(ws, makeRpcHosts(), makeHelloBuilder())
    ws.emit('open')
    ws.sent.length = 0

    client.resolveConfirm('conf-1', 'confirmed', { count: 10 })

    expect(ws.sent).toHaveLength(1)
    const frame = JSON.parse(ws.sent[0]!)
    expect(frame.t).toBe('confirm-resolved')
    expect(frame.confirmId).toBe('conf-1')
    expect(frame.outcome).toBe('confirmed')
    expect(frame.stateAfter).toEqual({ count: 10 })
  })

  it('resolveConfirm("user-cancelled") → emits confirm-resolved frame without stateAfter', () => {
    const ws = new FakeWs()
    const client = attachWsClient(ws, makeRpcHosts(), makeHelloBuilder())
    ws.emit('open')
    ws.sent.length = 0

    client.resolveConfirm('conf-2', 'user-cancelled')

    expect(ws.sent).toHaveLength(1)
    const frame = JSON.parse(ws.sent[0]!)
    expect(frame.t).toBe('confirm-resolved')
    expect(frame.confirmId).toBe('conf-2')
    expect(frame.outcome).toBe('user-cancelled')
    expect(frame.stateAfter).toBeUndefined()
  })

  it('emitStateUpdate sends a state-update frame (with watch id) when open', () => {
    const ws = new FakeWs()
    const client = attachWsClient(ws, makeRpcHosts(), makeHelloBuilder())
    ws.emit('open')
    ws.sent.length = 0

    client.emitStateUpdate('w1', '/', { x: 1 })

    expect(ws.sent).toHaveLength(1)
    const frame = JSON.parse(ws.sent[0]!)
    expect(frame.t).toBe('state-update')
    expect(frame.id).toBe('w1')
    expect(frame.path).toBe('/')
    expect(frame.stateAfter).toEqual({ x: 1 })
  })

  it('emitStateUpdate is dropped (does NOT throw) when the socket is not open', () => {
    const ws = new FakeWs()
    const client = attachWsClient(ws, makeRpcHosts(), makeHelloBuilder())
    // Never emit 'open' — socket is CONNECTING from the client's POV.
    expect(() => client.emitStateUpdate('w1', '/', { x: 1 })).not.toThrow()
    expect(ws.sent).toHaveLength(0)
    expect(client.isOpen()).toBe(false)
  })

  it('emitLogAppend sends a log-append frame', () => {
    const ws = new FakeWs()
    const client = attachWsClient(ws, makeRpcHosts(), makeHelloBuilder())
    ws.emit('open')
    ws.sent.length = 0

    const entry: LogEntry = { id: 'x', at: 0, kind: 'read' }
    client.emitLogAppend(entry)

    expect(ws.sent).toHaveLength(1)
    const frame = JSON.parse(ws.sent[0]!)
    expect(frame.t).toBe('log-append')
    expect(frame.entry).toEqual(entry)
  })

  it('send_message with status "dispatched" → log-append with kind "dispatched" and variant from msg.type', async () => {
    const ws = new FakeWs()
    const customRpc: RpcHosts = {
      ...makeRpcHosts(),
      send: vi.fn(),
      flush: vi.fn(),
      getState: () => ({ count: 1 }),
      getMsgAnnotations: () => ({
        Increment: {
          intent: 'Increment',
          alwaysAffordable: true,
          requiresConfirm: false,
          dispatchMode: 'shared',
          examples: [],
          warning: null,
          emits: [],
        },
      }),
    }
    attachWsClient(ws, customRpc, makeHelloBuilder())
    ws.emit('open')
    ws.sent.length = 0

    const rpcFrame: RpcFrame = {
      t: 'rpc',
      id: 'req-sm',
      tool: 'send_message',
      args: { msg: { type: 'Increment' }, waitFor: 'idle' },
    }
    ws.emit('message', JSON.stringify(rpcFrame))
    await new Promise((r) => setTimeout(r, 0))

    // Find the log-append frame
    const logFrames = ws.sent.map((s) => JSON.parse(s)).filter((f) => f.t === 'log-append')
    expect(logFrames).toHaveLength(1)
    const logFrame = logFrames[0]!
    expect(logFrame.entry.kind).toBe('dispatched')
    expect(logFrame.entry.variant).toBe('Increment')
  })
})

// ── auto-narrated detail line on log entries ───────────────────────
// Helper that runs an rpc through the ws-client and returns the resulting
// log entry. Keeps the per-test boilerplate down so the assertions stay
// readable. send_message rpcs default `waitFor: 'idle'` so the test's
// single-microtask wait is enough for the dispatch to settle (the
// production default `'drained'` blocks on a 100ms quiescence window
// that this fake-ws harness never feeds).
async function runRpcAndGetEntry(rpc: RpcFrame): Promise<LogEntry> {
  const ws = new FakeWs()
  attachWsClient(ws, makeRpcHosts(), makeHelloBuilder())
  ws.emit('open')
  ws.sent.length = 0
  // Tighten waitFor for send_message dispatches that don't already specify it.
  let frame = rpc
  if (rpc.tool === 'send_message') {
    const args = (rpc.args as Record<string, unknown> | null) ?? {}
    if (args.waitFor === undefined) {
      frame = { ...rpc, args: { ...args, waitFor: 'idle' } } as RpcFrame
    }
  }
  ws.emit('message', JSON.stringify(frame))
  await new Promise((r) => setTimeout(r, 0))
  const logFrames = ws.sent.map((s) => JSON.parse(s)).filter((f) => f.t === 'log-append')
  if (logFrames.length !== 1) throw new Error(`expected 1 log-append, got ${logFrames.length}`)
  return logFrames[0]!.entry as LogEntry
}

describe('LogEntry.detail auto-narration', () => {
  it('renders payload fields as k=v pairs (excluding the discriminant)', async () => {
    const entry = await runRpcAndGetEntry({
      t: 'rpc',
      id: 'r1',
      tool: 'send_message',
      args: { msg: { type: 'SelectAlternative', id: 'a3', score: 0.85 } },
    })
    expect(entry.detail).toBe('id="a3" score=0.85')
  })

  it('caps to 3 fields and appends … when more remain', async () => {
    const entry = await runRpcAndGetEntry({
      t: 'rpc',
      id: 'r2',
      tool: 'send_message',
      args: { msg: { type: 'Wide', a: 1, b: 2, c: 3, d: 4, e: 5 } },
    })
    expect(entry.detail).toBe('a=1 b=2 c=3 …')
  })

  it('truncates long string values with an ellipsis', async () => {
    const long = 'x'.repeat(60)
    const entry = await runRpcAndGetEntry({
      t: 'rpc',
      id: 'r3',
      tool: 'send_message',
      args: { msg: { type: 'SetNote', text: long } },
    })
    // 30-char cap including the inserted ellipsis, plus the surrounding
    // quotes from JSON.stringify.
    expect(entry.detail).toMatch(/^text="x+…$/)
    expect(entry.detail!.length).toBeLessThanOrEqual('text='.length + 30)
  })

  it('renders objects as keysets, arrays as length, null/undefined explicitly', async () => {
    const entry = await runRpcAndGetEntry({
      t: 'rpc',
      id: 'r4',
      tool: 'send_message',
      args: {
        msg: {
          type: 'Compose',
          where: { x: 1, y: 2 },
          // (3 fields cap means tags or empty would be dropped)
          tags: ['a', 'b', 'c', 'd'],
          opt: null,
        },
      },
    })
    expect(entry.detail).toBe('where={x,y} tags=[4] opt=null')
  })

  it('emits no detail when the payload has only the discriminant', async () => {
    const entry = await runRpcAndGetEntry({
      t: 'rpc',
      id: 'r5',
      tool: 'send_message',
      args: { msg: { type: 'Tick' } },
    })
    expect(entry.detail).toBeUndefined()
  })

  it('emits no detail for read tools (intent line already covers them)', async () => {
    const entry = await runRpcAndGetEntry({
      t: 'rpc',
      id: 'r6',
      tool: 'get_state',
      args: {},
    })
    expect(entry.detail).toBeUndefined()
  })

  it('emits no detail when send_message is missing the msg arg (malformed)', async () => {
    const entry = await runRpcAndGetEntry({
      t: 'rpc',
      id: 'r7',
      tool: 'send_message',
      args: {} as unknown as { msg: unknown },
    })
    expect(entry.detail).toBeUndefined()
  })
})

describe('log-push handling (server-originated narration)', () => {
  it('mirrors a log-push frame to onLogEntry AND echoes log-append upstream', async () => {
    const ws = new FakeWs()
    const onLogEntry = vi.fn()
    attachWsClient(ws, makeRpcHosts(), makeHelloBuilder(), { onLogEntry })
    ws.emit('open')
    ws.sent.length = 0

    const entry = {
      id: 'narrate-1',
      at: 100,
      kind: 'narrate' as const,
      detail: 'thinking…',
      intent: 'Agent narrated',
    }
    ws.emit('message', JSON.stringify({ t: 'log-push', entry }))
    await new Promise((r) => setTimeout(r, 0))

    expect(onLogEntry).toHaveBeenCalledOnce()
    expect(onLogEntry).toHaveBeenCalledWith(entry)

    // A log-append echoes back so the server-side recent-log buffer +
    // audit sink see the same entry through the existing channel.
    const echo = ws.sent.map((s) => JSON.parse(s)).find((f) => f.t === 'log-append')
    expect(echo).toBeDefined()
    expect(echo!.entry).toEqual(entry)
  })

  it('confirm-expire frame invokes onConfirmExpire with the confirmId', () => {
    const ws = new FakeWs()
    const onConfirmExpire = vi.fn()
    attachWsClient(ws, makeRpcHosts(), makeHelloBuilder(), { onConfirmExpire })
    ws.emit('open')

    ws.emit('message', JSON.stringify({ t: 'confirm-expire', confirmId: 'c-42' }))

    expect(onConfirmExpire).toHaveBeenCalledOnce()
    expect(onConfirmExpire).toHaveBeenCalledWith('c-42')
  })
})
