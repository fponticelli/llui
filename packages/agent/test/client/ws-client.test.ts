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
    getBindingDescriptors: () => null,
    getAgentAffordances: () => null,
    getAgentContext: () => null,
    getRootElement: () => null,
    proposeConfirm: vi.fn(),
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

  it('emitStateUpdate sends a state-update frame', () => {
    const ws = new FakeWs()
    const client = attachWsClient(ws, makeRpcHosts(), makeHelloBuilder())
    ws.emit('open')
    ws.sent.length = 0

    client.emitStateUpdate('/', { x: 1 })

    expect(ws.sent).toHaveLength(1)
    const frame = JSON.parse(ws.sent[0]!)
    expect(frame.t).toBe('state-update')
    expect(frame.path).toBe('/')
    expect(frame.stateAfter).toEqual({ x: 1 })
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
          humanOnly: false,
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
