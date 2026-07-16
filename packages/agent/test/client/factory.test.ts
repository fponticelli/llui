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
    // LAP version negotiation: the client advertises its wire version.
    expect(hello.lapVersion).toBe(2)
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

  it('ignores the close of a socket superseded by a reconnect (no spurious WsClosed)', async () => {
    // Finding 7: opening a second WS closes the first; the first socket's
    // close event must NOT dispatch WsClosed (which would kick off a
    // phantom reconnect against the live socket).
    const handle = makeHandle({ connect: {}, confirm: { pending: [] } })
    const client = createAgentClient(makeOpts(handle, () => ({ pending: [] })))

    await client.effectHandler({
      type: 'AgentOpenWS',
      token: 'tok1' as AgentToken,
      wsUrl: 'ws://localhost:9000/agent/ws',
    })
    const first = lastFakeWs!

    // Second open supersedes the first (openWs calls first.close()).
    await client.effectHandler({
      type: 'AgentOpenWS',
      token: 'tok2' as AgentToken,
      wsUrl: 'ws://localhost:9000/agent/ws',
    })
    expect(first.closed).toBe(true)

    // The superseded socket's close must NOT have produced a WsClosed msg.
    const wsClosedCalls = handle.send.mock.calls.filter((c) => {
      const m = c[0] as { inner?: { type?: string } }
      return m?.inner?.type === 'WsClosed'
    })
    expect(wsClosedCalls).toHaveLength(0)

    // The LIVE (second) socket closing DOES dispatch WsClosed.
    lastFakeWs!.emit('close')
    const afterLive = handle.send.mock.calls.filter((c) => {
      const m = c[0] as { inner?: { type?: string } }
      return m?.inner?.type === 'WsClosed'
    })
    expect(afterLive).toHaveLength(1)

    client.stop()
  })

  it('AgentForwardMsg effect dispatches payload via handle.send', async () => {
    const handle = makeHandle({ connect: {}, confirm: { pending: [] } })
    const client = createAgentClient(makeOpts(handle, () => ({ pending: [] })))

    const payload = { type: 'Increment', by: 1 }
    await client.effectHandler({ type: 'AgentForwardMsg', payload })

    expect(handle.send).toHaveBeenCalledWith(payload)
  })

  it('detects an approved confirm on the state subscription (no interval) → emits confirm-resolved', async () => {
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

    // A commit with no resolved confirm emits nothing.
    handle.setState({ connect: {}, confirm: { pending: [] } })
    expect(lastFakeWs!.sent.filter((s) => s.includes('confirm-resolved'))).toHaveLength(0)

    // The confirm transitions to approved; the next commit (Approve is
    // itself a state-changing dispatch) drives detection via the
    // subscription — no 200ms poll involved.
    confirmState = { pending: [approvedEntry] }
    handle.setState({ connect: {}, confirm: { pending: [approvedEntry] } })

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

    // A further commit does NOT re-emit for the same resolved entry.
    handle.setState({ connect: {}, confirm: { pending: [approvedEntry] } })
    expect(lastFakeWs!.sent.filter((s) => s.includes('confirm-resolved'))).toHaveLength(1)

    client.stop()
  })

  it('emits a state-update ONLY for an armed watch, and NOT for an idle session', async () => {
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
    lastFakeWs!.sent.length = 0

    // No watch armed → a state change ships nothing (idle session costs 0).
    handle.setState({ connect: { a: 1 }, confirm: { pending: [] } })
    expect(lastFakeWs!.sent.filter((s) => JSON.parse(s).t === 'state-update')).toHaveLength(0)

    // Server arms a whole-state watch.
    lastFakeWs!.emit('message', JSON.stringify({ t: 'watch', id: 'w1' }))

    // A genuine change now emits exactly one state-update for that watch.
    handle.setState({ connect: { a: 2 }, confirm: { pending: [] } })
    const stateFrames = lastFakeWs!.sent
      .map((s) => JSON.parse(s))
      .filter((f) => f.t === 'state-update')
    expect(stateFrames).toHaveLength(1)
    expect(stateFrames[0].id).toBe('w1')

    // Disarm — subsequent changes ship nothing again.
    lastFakeWs!.emit('message', JSON.stringify({ t: 'unwatch', id: 'w1' }))
    handle.setState({ connect: { a: 3 }, confirm: { pending: [] } })
    expect(
      lastFakeWs!.sent.map((s) => JSON.parse(s)).filter((f) => f.t === 'state-update'),
    ).toHaveLength(1)

    client.stop()
  })

  it('a path-scoped watch fires only when the watched sub-path changes', async () => {
    const handle = makeHandle({ connect: { count: 0 }, confirm: { pending: [] } })
    const client = createAgentClient(makeOpts(handle, () => ({ pending: [] })))
    await client.effectHandler({
      type: 'AgentOpenWS',
      token: 'tok' as AgentToken,
      wsUrl: 'ws://localhost:9000/agent/ws',
    })
    lastFakeWs!.emit('open')
    client.start()
    lastFakeWs!.sent.length = 0

    // Watch /connect/count specifically.
    lastFakeWs!.emit('message', JSON.stringify({ t: 'watch', id: 'wc', path: '/connect/count' }))

    // A change to an UNwatched field emits nothing.
    handle.setState({ connect: { count: 0, other: 1 }, confirm: { pending: [] } })
    expect(
      lastFakeWs!.sent.map((s) => JSON.parse(s)).filter((f) => f.t === 'state-update'),
    ).toHaveLength(0)

    // A change to the watched field fires.
    handle.setState({ connect: { count: 5, other: 1 }, confirm: { pending: [] } })
    const frames = lastFakeWs!.sent.map((s) => JSON.parse(s)).filter((f) => f.t === 'state-update')
    expect(frames).toHaveLength(1)
    expect(frames[0].id).toBe('wc')

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

    // Arm a whole-state watch so the change is broadcast.
    lastFakeWs!.emit('message', JSON.stringify({ t: 'watch', id: 'w1' }))

    handle.setState({
      connect: {},
      confirm: { pending: [] },
      when: new Date('2026-04-26T12:34:56.000Z'),
    })

    const stateFrame = lastFakeWs!.sent
      .map((s) => JSON.parse(s))
      .find((f) => f.t === 'state-update')
    expect(stateFrame).toBeDefined()
    // Codec encoding is applied at the wire boundary (encodeWire), not at
    // getState — but the emitted frame still carries the tagged form.
    expect(stateFrame.stateAfter.when).toEqual({
      __codec: 'iso-date',
      wire: '2026-04-26T12:34:56.000Z',
    })

    client.stop()
  })

  it('app callbacks (routeGate predicate) receive RAW unencoded state — a Date stays a Date', async () => {
    // Finding 9: getState feeds app callbacks / pointer resolution the
    // redacted-but-UNENCODED state, so a @routeGated predicate touching a
    // Date field sees a real Date (not its wire-tagged form, which would
    // fail-closed). Codec encoding happens only at the frame boundary.
    type S = { connect: unknown; confirm: AgentConfirmState; publishAt: Date }
    let state: S = {
      connect: {},
      confirm: { pending: [] },
      publishAt: new Date('2030-01-01T00:00:00.000Z'),
    }
    const handle = {
      getState: () => state,
      send: vi.fn(),
      batch: vi.fn((fn: () => void) => fn()),
      flush: vi.fn(),
      dispose: vi.fn(),
      subscribe: () => () => {},
      setState: (s: S) => {
        state = s
      },
      // A live binding for the gated variant so list_actions surfaces it.
      getBindingDescriptors: () => [{ variant: 'Publish' }],
      runReducer: () => null,
      setOnBindingError: () => {},
    }
    const opts: CreateAgentClientOpts<S, unknown> = {
      handle: handle as never,
      def: {
        name: 'pub-app',
        __schemaHash: 'h',
        __msgAnnotations: {
          Publish: {
            intent: 'Publish now',
            dispatchMode: 'shared',
            requiresConfirm: false,
            alwaysAffordable: false,
            examples: [],
            warning: null,
            emits: [],
            // Predicate calls a Date method — throws on wire-tagged form.
            routeGate: 'state.publishAt instanceof Date && state.publishAt.getTime() > 0',
          },
        },
      },
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
    lastFakeWs!.sent.length = 0

    // Drive a list_actions RPC through the ws.
    lastFakeWs!.emit(
      'message',
      JSON.stringify({ t: 'rpc', id: 'r1', tool: 'list_actions', args: {} }),
    )
    await Promise.resolve()
    await Promise.resolve()

    const reply = lastFakeWs!.sent.map((s) => JSON.parse(s)).find((f) => f.t === 'rpc-reply')
    expect(reply).toBeDefined()
    const publish = reply.result.actions.find((a: { variant: string }) => a.variant === 'Publish')
    expect(publish).toBeDefined()
    // Predicate evaluated on the real Date → truthy → available (no
    // `available: false`). With wire-encoded state it would fail-closed.
    expect(publish.available).not.toBe(false)

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

describe('createAgentClient — source-side state redaction (S6)', () => {
  it('redacts state on the state-update broadcast before it leaves the app', async () => {
    const handle = makeHandle({ connect: { secret: 'sk-LEAK-0' }, confirm: { pending: [] } })
    const opts = makeOpts(handle, () => ({ pending: [] }))
    opts.redactState = (s) => ({ ...s, connect: { redacted: true } })
    const client = createAgentClient(opts)
    await client.effectHandler({
      type: 'AgentOpenWS',
      token: 'tokR' as AgentToken,
      wsUrl: 'ws://localhost:9000/agent/ws',
    })
    lastFakeWs!.emit('open')
    client.start()
    lastFakeWs!.emit('message', JSON.stringify({ t: 'watch', id: 'w1' }))
    handle.setState({ connect: { secret: 'sk-STILL-SECRET' }, confirm: { pending: [] } })
    const frames = lastFakeWs!.sent.map((s) => JSON.parse(s)).filter((f) => f.t === 'state-update')
    expect(frames.length).toBeGreaterThan(0)
    const last = frames[frames.length - 1]
    expect(last.stateAfter.connect).toEqual({ redacted: true })
    expect(JSON.stringify(last)).not.toContain('STILL-SECRET')
    client.stop()
  })

  it('redacts the state fed to the hello-frame affordances sample', async () => {
    const handle = makeHandle({ connect: { secret: 'sk-LEAK-99' }, confirm: { pending: [] } })
    const opts = makeOpts(handle, () => ({ pending: [] }))
    opts.redactState = (s) => ({ ...s, connect: { redacted: true } })
    opts.def = {
      ...opts.def,
      agentAffordances: (state) => [{ type: 'dump', state: JSON.stringify(state) }],
    }
    const client = createAgentClient(opts)
    await client.effectHandler({
      type: 'AgentOpenWS',
      token: 'tokAff' as AgentToken,
      wsUrl: 'ws://localhost:9000/agent/ws',
    })
    lastFakeWs!.emit('open')
    const hello = JSON.parse(lastFakeWs!.sent[0]!)
    expect(JSON.stringify(hello.affordancesSample)).not.toContain('sk-LEAK-99')
    expect(JSON.stringify(hello.affordancesSample)).toContain('redacted')
    client.stop()
  })

  it('passes state through unredacted when no hook is set (control)', async () => {
    const handle = makeHandle({ connect: { token: 'visible' }, confirm: { pending: [] } })
    const client = createAgentClient(makeOpts(handle, () => ({ pending: [] })))
    await client.effectHandler({
      type: 'AgentOpenWS',
      token: 'tokC' as AgentToken,
      wsUrl: 'ws://localhost:9000/agent/ws',
    })
    lastFakeWs!.emit('open')
    client.start()
    lastFakeWs!.emit('message', JSON.stringify({ t: 'watch', id: 'w1' }))
    handle.setState({ connect: { token: 'visible-changed' }, confirm: { pending: [] } })
    const frames = lastFakeWs!.sent.map((s) => JSON.parse(s)).filter((f) => f.t === 'state-update')
    expect(JSON.stringify(frames[frames.length - 1])).toContain('visible')
    client.stop()
  })
})
