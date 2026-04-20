import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createAgentClient, type CreateAgentClientOpts } from '../../src/client/factory.js'
import type { AgentEffect } from '../../src/client/effects.js'
import type { AgentConfirmState, ConfirmEntry } from '../../src/client/agentConfirm.js'
import type { AgentToken } from '../../src/protocol.js'

// --- Fake WebSocket -----------------------------------------------------------

type WsEventMap = {
  open: (() => void)[]
  message: ((e: { data: string }) => void)[]
  close: (() => void)[]
}

class FakeWebSocket {
  url: string
  sent: string[] = []
  closed = false
  private _handlers: WsEventMap = { open: [], message: [], close: [] }

  constructor(url: string) {
    this.url = url
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.closed = true
    for (const h of this._handlers.close) h()
  }

  addEventListener(event: 'open' | 'close', h: () => void): void
  addEventListener(event: 'message', h: (e: { data: string }) => void): void
  addEventListener(
    event: 'open' | 'close' | 'message',
    h: (() => void) | ((e: { data: string }) => void),
  ): void {
    if (event === 'open' || event === 'close') {
      (this._handlers[event]).push(h as () => void)
    } else if (event === 'message') {
      this._handlers.message.push(h as (e: { data: string }) => void)
    }
  }

  /** Test helper: simulate the server sending a frame. */
  emit(event: 'open' | 'close'): void
  emit(event: 'message', data: string): void
  emit(event: string, data?: string): void {
    if (event === 'open') {
      for (const h of this._handlers.open) h()
    } else if (event === 'close') {
      for (const h of this._handlers.close) h()
    } else if (event === 'message' && data !== undefined) {
      for (const h of this._handlers.message) h({ data })
    }
  }
}

let lastFakeWs: FakeWebSocket | null = null

// --- Fake AppHandle ----------------------------------------------------------

type FakeState = { connect: unknown; confirm: AgentConfirmState }

function makeHandle(initialState: FakeState) {
  let state = initialState
  const listeners = new Set<(s: unknown) => void>()
  const handle = {
    getState: () => state,
    send: vi.fn((msg: unknown) => {
      // Simulate confirm Propose updating state inline so poll can detect
      void msg
    }),
    flush: vi.fn(),
    dispose: vi.fn(),
    subscribe: (listener: (s: unknown) => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    setState: (s: FakeState) => {
      state = s
      for (const l of listeners) l(s)
    },
  }
  return handle
}

function makeOpts(
  handle: ReturnType<typeof makeHandle>,
  confirmState: () => AgentConfirmState,
): CreateAgentClientOpts<FakeState, unknown> {
  return {
    handle,
    def: {
      name: 'test-app',
      __schemaHash: 'hash1',
    },
    appVersion: '1.0.0',
    rootElement: null,
    slices: {
      getConnect: (s) => s.connect,
      getConfirm: (_s) => confirmState(),
      wrapConnectMsg: (m) => ({ type: 'AgentMsg', inner: m }),
      wrapConfirmMsg: (m) => ({ type: 'ConfirmMsg', inner: m }),
    },
  }
}

// --- Setup/teardown ----------------------------------------------------------

beforeEach(() => {
  lastFakeWs = null
  vi.stubGlobal('WebSocket', function (url: string) {
    const ws = new FakeWebSocket(url)
    lastFakeWs = ws
    return ws
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// --- Tests -------------------------------------------------------------------

describe('createAgentClient', () => {
  it('returns effectHandler, start, and stop', () => {
    const handle = makeHandle({ connect: {}, confirm: { pending: [] } })
    const client = createAgentClient(makeOpts(handle, () => ({ pending: [] })))
    expect(typeof client.effectHandler).toBe('function')
    expect(typeof client.start).toBe('function')
    expect(typeof client.stop).toBe('function')
  })

  it('AgentOpenWS effect constructs a WebSocket with correct URL + sends hello on open', async () => {
    const handle = makeHandle({ connect: {}, confirm: { pending: [] } })
    const client = createAgentClient(makeOpts(handle, () => ({ pending: [] })))

    const effect: AgentEffect = {
      type: 'AgentOpenWS',
      token: 'tok123' as AgentToken,
      wsUrl: 'ws://localhost:9000/agent/ws',
    }
    await client.effectHandler(effect)

    expect(lastFakeWs).not.toBeNull()
    expect(lastFakeWs!.url).toBe('ws://localhost:9000/agent/ws?token=tok123')

    // Simulate open → hello should be emitted
    lastFakeWs!.emit('open')

    expect(lastFakeWs!.sent).toHaveLength(1)
    const hello = JSON.parse(lastFakeWs!.sent[0]!)
    expect(hello.t).toBe('hello')
    expect(hello.appName).toBe('test-app')
    expect(hello.appVersion).toBe('1.0.0')
  })

  it('AgentForwardMsg effect dispatches payload via handle.send', async () => {
    const handle = makeHandle({ connect: {}, confirm: { pending: [] } })
    const client = createAgentClient(makeOpts(handle, () => ({ pending: [] })))

    const payload = { type: 'Increment', by: 1 }
    await client.effectHandler({ type: 'AgentForwardMsg', payload })

    expect(handle.send).toHaveBeenCalledWith(payload)
  })

  it('start() polls confirm state; when entry transitions approved → emits confirm-resolved', async () => {
    vi.useFakeTimers()

    const approvedEntry: ConfirmEntry = {
      id: 'conf-1',
      variant: 'Delete',
      payload: { itemId: 42 },
      intent: 'Delete item',
      reason: null,
      proposedAt: Date.now(),
      status: 'approved',
    }

    let confirmState: AgentConfirmState = { pending: [] }
    const handle = makeHandle({ connect: {}, confirm: { pending: [] } })
    const client = createAgentClient(makeOpts(handle, () => confirmState))

    // Open a WS first so wsClient is available for resolveConfirm
    const effect: AgentEffect = {
      type: 'AgentOpenWS',
      token: 'tok' as AgentToken,
      wsUrl: 'ws://localhost:9000/agent/ws',
    }
    await client.effectHandler(effect)
    lastFakeWs!.emit('open') // trigger hello, establish wsClient

    client.start()

    // Advance time before entry appears — nothing should happen
    vi.advanceTimersByTime(200)
    expect(lastFakeWs!.sent.filter((s) => s.includes('confirm-resolved'))).toHaveLength(0)

    // Now transition state to have an approved entry
    confirmState = { pending: [approvedEntry] }

    // Advance timer to trigger poll
    vi.advanceTimersByTime(200)

    // confirm-resolved should now have been sent (after hello)
    const confirmFrames = lastFakeWs!.sent.filter((s) => {
      try { return JSON.parse(s).t === 'confirm-resolved' } catch { return false }
    })
    expect(confirmFrames).toHaveLength(1)
    const frame = JSON.parse(confirmFrames[0]!)
    expect(frame.confirmId).toBe('conf-1')
    expect(frame.outcome).toBe('confirmed')

    client.stop()
    vi.useRealTimers()
  })

  it('start() subscribes to handle and emits state-update frames when state changes', async () => {
    const handle = makeHandle({ connect: {}, confirm: { pending: [] } })
    const client = createAgentClient(makeOpts(handle, () => ({ pending: [] })))

    // Open a WS so wsClient is available
    const effect: AgentEffect = {
      type: 'AgentOpenWS',
      token: 'tok' as AgentToken,
      wsUrl: 'ws://localhost:9000/agent/ws',
    }
    await client.effectHandler(effect)
    lastFakeWs!.emit('open')

    client.start()

    // Clear frames sent so far (hello)
    lastFakeWs!.sent.length = 0

    // Trigger a state change via handle.setState
    handle.setState({ connect: {}, confirm: { pending: [] } })

    // Should emit a state-update frame
    const stateFrames = lastFakeWs!.sent.filter((s) => {
      try { return JSON.parse(s).t === 'state-update' } catch { return false }
    })
    expect(stateFrames).toHaveLength(1)
    const frame = JSON.parse(stateFrames[0]!)
    expect(frame.path).toBe('/')

    client.stop()
  })
})
