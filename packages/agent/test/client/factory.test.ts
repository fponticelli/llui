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
      this._handlers[event].push(h as () => void)
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
  const listeners = new Set<(s: FakeState) => void>()
  const handle = {
    getState: () => state,
    send: vi.fn((msg: unknown) => {
      // Simulate confirm Propose updating state inline so poll can detect
      void msg
    }),
    batch: vi.fn((fn: () => void) => fn()),
    flush: vi.fn(),
    dispose: vi.fn(),
    subscribe: (listener: (s: FakeState) => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    setState: (s: FakeState) => {
      state = s
      for (const l of listeners) l(s)
    },
    // Stub the runtime descriptor registry. The agent factory now
    // reads live descriptors from this method instead of the static
    // `def.__bindingDescriptors`. Tests that don't exercise list-actions
    // can return an empty array; tests that do should override.
    getBindingDescriptors: () => [] as Array<{ variant: string }>,
    swapUpdate: vi.fn(),
    runReducer: () => null,
    setOnBindingError: () => {},
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

  it('AgentOpenWS effect dispatches WsOpened msg via handle.send on open event', async () => {
    const handle = makeHandle({ connect: {}, confirm: { pending: [] } })
    const client = createAgentClient(makeOpts(handle, () => ({ pending: [] })))

    const effect: AgentEffect = {
      type: 'AgentOpenWS',
      token: 'tok456' as AgentToken,
      wsUrl: 'ws://localhost:9000/agent/ws',
    }
    await client.effectHandler(effect)

    // Simulate open event
    lastFakeWs!.emit('open')

    expect(handle.send).toHaveBeenCalledWith({ type: 'AgentMsg', inner: { type: 'WsOpened' } })
  })

  it('AgentOpenWS effect dispatches WsClosed msg via handle.send on close event', async () => {
    const handle = makeHandle({ connect: {}, confirm: { pending: [] } })
    const client = createAgentClient(makeOpts(handle, () => ({ pending: [] })))

    const effect: AgentEffect = {
      type: 'AgentOpenWS',
      token: 'tok789' as AgentToken,
      wsUrl: 'ws://localhost:9000/agent/ws',
    }
    await client.effectHandler(effect)

    lastFakeWs!.emit('open')
    lastFakeWs!.emit('close')

    expect(handle.send).toHaveBeenCalledWith({ type: 'AgentMsg', inner: { type: 'WsClosed' } })
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
      try {
        return JSON.parse(s).t === 'confirm-resolved'
      } catch {
        return false
      }
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
      try {
        return JSON.parse(s).t === 'state-update'
      } catch {
        return false
      }
    })
    expect(stateFrames).toHaveLength(1)
    const frame = JSON.parse(stateFrames[0]!)
    expect(frame.path).toBe('/')

    client.stop()
  })

  it('codec wiring: state-update frames encode Date as iso-date wire form', async () => {
    type DateState = { connect: unknown; confirm: AgentConfirmState; when: Date }
    let state: DateState = {
      connect: {},
      confirm: { pending: [] },
      when: new Date('2026-04-25T00:00:00.000Z'),
    }
    const listeners = new Set<(s: unknown) => void>()
    const handle = {
      getState: () => state,
      send: vi.fn(),
      batch: vi.fn((fn: () => void) => fn()),
      flush: vi.fn(),
      dispose: vi.fn(),
      subscribe: (l: (s: unknown) => void) => {
        listeners.add(l)
        return () => listeners.delete(l)
      },
      setState: (s: DateState) => {
        state = s
        for (const l of listeners) l(s)
      },
      getBindingDescriptors: () => [] as Array<{ variant: string }>,
      setOnBindingError: () => {},
    }
    const opts: CreateAgentClientOpts<DateState, unknown> = {
      handle: handle as never,
      def: { name: 'date-app', __schemaHash: 'h' },
      appVersion: '1.0.0',
      rootElement: null,
      slices: {
        getConnect: (s) => s.connect,
        getConfirm: (s) => s.confirm,
        wrapConnectMsg: (m) => ({ type: 'AgentMsg', inner: m }),
        wrapConfirmMsg: (m) => ({ type: 'ConfirmMsg', inner: m }),
      },
    }
    const client = createAgentClient(opts)
    await client.effectHandler({
      type: 'AgentOpenWS',
      token: 'tok' as AgentToken,
      wsUrl: 'ws://localhost:9000/agent/ws',
    })
    lastFakeWs!.emit('open')
    client.start()
    lastFakeWs!.sent.length = 0

    handle.setState({
      connect: {},
      confirm: { pending: [] },
      when: new Date('2026-04-26T12:34:56.000Z'),
    })

    const stateFrame = lastFakeWs!.sent
      .map((s) => JSON.parse(s))
      .find((f) => f.t === 'state-update')
    expect(stateFrame).toBeDefined()
    expect(stateFrame.stateAfter.when).toEqual({
      __codec: 'iso-date',
      wire: '2026-04-26T12:34:56.000Z',
    })

    client.stop()
  })

  it('codec wiring: incoming msg with iso-date wire form decodes to Date before reaching handle.send', async () => {
    const handle = makeHandle({ connect: {}, confirm: { pending: [] } })
    const client = createAgentClient(makeOpts(handle, () => ({ pending: [] })))
    await client.effectHandler({
      type: 'AgentOpenWS',
      token: 'tok' as AgentToken,
      wsUrl: 'ws://localhost:9000/agent/ws',
    })
    lastFakeWs!.emit('open')
    client.start()

    // Clear the WsOpened call from the open event; only the rpc-driven
    // dispatch should remain after we emit the rpc-request.
    handle.send.mockClear()

    // Simulate the server invoking the send_message rpc with a Date payload
    // in tagged-wire form. The send-message handler will call host.send,
    // which the factory wraps with decodeFromWire — so the call to
    // handle.send should see a real Date, not the tagged shape.
    lastFakeWs!.emit(
      'message',
      JSON.stringify({
        t: 'rpc',
        id: 'rpc-1',
        tool: 'send_message',
        args: {
          msg: {
            type: 'setValue',
            value: { __codec: 'iso-date', wire: '2026-04-25T00:00:00.000Z' },
          },
          waitFor: 'none',
        },
      }),
    )

    // Allow the rpc to flush (microtask)
    await Promise.resolve()
    await Promise.resolve()

    expect(handle.send).toHaveBeenCalled()
    const dispatched = handle.send.mock.calls[0]?.[0] as { type: string; value: unknown }
    expect(dispatched.type).toBe('setValue')
    expect(dispatched.value).toBeInstanceOf(Date)
    expect((dispatched.value as Date).toISOString()).toBe('2026-04-25T00:00:00.000Z')

    client.stop()
  })

  // ── Slice fan-out: log-append routes to both wrapLogMsg and wrapAttentionMsg ──
  // Regression guard for the factory's onLogEntry plumbing. The wiring is
  // small but easy to break: a single log entry must reach BOTH slices when
  // both are wired (so the activity log and the attention spotlight stay
  // in sync), exactly one when only one is wired, and never disagree about
  // the entry payload they receive.
  it('onLogEntry fans out a single log-append to wrapLogMsg AND wrapAttentionMsg when both are wired', async () => {
    const handle = makeHandle({ connect: {}, confirm: { pending: [] } })
    const wrapLogMsg = vi.fn((m: unknown) => ({ type: 'LogMsg', inner: m }))
    const wrapAttentionMsg = vi.fn((m: unknown) => ({ type: 'AttentionMsg', inner: m }))
    const opts: CreateAgentClientOpts<FakeState, unknown> = {
      ...makeOpts(handle, () => ({ pending: [] })),
      slices: {
        getConnect: (s) => s.connect,
        getConfirm: (_s) => ({ pending: [] }),
        wrapConnectMsg: (m) => ({ type: 'AgentMsg', inner: m }),
        wrapConfirmMsg: (m) => ({ type: 'ConfirmMsg', inner: m }),
        wrapLogMsg,
        wrapAttentionMsg,
      },
    }
    const client = createAgentClient(opts)
    await client.effectHandler({
      type: 'AgentOpenWS',
      token: 'tok' as AgentToken,
      wsUrl: 'ws://localhost:9000/agent/ws',
    })
    lastFakeWs!.emit('open')

    handle.send.mockClear()
    // Trigger an rpc so the ws-client emits a LogEntry locally (via onLogEntry).
    lastFakeWs!.emit(
      'message',
      JSON.stringify({ t: 'rpc', id: 'rpc-1', tool: 'get_state', args: {} }),
    )
    await Promise.resolve()
    await Promise.resolve()

    // Both wrappers fired, with the same Append payload (same entry by ref).
    expect(wrapLogMsg).toHaveBeenCalledOnce()
    expect(wrapAttentionMsg).toHaveBeenCalledOnce()
    const logCall = wrapLogMsg.mock.calls[0]![0] as { type: string; entry: { id: string } }
    const attCall = wrapAttentionMsg.mock.calls[0]![0] as {
      type: string
      entry: { id: string }
    }
    expect(logCall.type).toBe('Append')
    expect(attCall.type).toBe('Append')
    expect(logCall.entry).toBe(attCall.entry) // same reference, not a clone

    // Each wrapper's output reaches handle.send.
    expect(handle.send).toHaveBeenCalledWith({ type: 'LogMsg', inner: logCall })
    expect(handle.send).toHaveBeenCalledWith({ type: 'AttentionMsg', inner: attCall })

    client.stop()
  })

  it('onLogEntry skips fan-out entirely when neither wrapLogMsg nor wrapAttentionMsg is wired', async () => {
    const handle = makeHandle({ connect: {}, confirm: { pending: [] } })
    const client = createAgentClient(makeOpts(handle, () => ({ pending: [] })))
    await client.effectHandler({
      type: 'AgentOpenWS',
      token: 'tok' as AgentToken,
      wsUrl: 'ws://localhost:9000/agent/ws',
    })
    lastFakeWs!.emit('open')

    handle.send.mockClear()
    lastFakeWs!.emit(
      'message',
      JSON.stringify({ t: 'rpc', id: 'rpc-quiet', tool: 'get_state', args: {} }),
    )
    await Promise.resolve()
    await Promise.resolve()

    // No Append-style msg should have been dispatched. The rpc still
    // ran (rpc-reply + outbound log-append frames are on the WS), but
    // neither the host nor any slice received an inbound dispatch.
    const appendCalls = handle.send.mock.calls.filter((c) => {
      const msg = c[0] as { type?: string; inner?: { type?: string } } | null
      return msg?.inner?.type === 'Append'
    })
    expect(appendCalls).toHaveLength(0)

    client.stop()
  })
})
