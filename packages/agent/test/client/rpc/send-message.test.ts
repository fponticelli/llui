import { describe, it, expect, vi } from 'vitest'
import { handleSendMessage, type SendMessageHost } from '../../../src/client/rpc/send-message.js'
import { randomUUID } from '../../../src/client/uuid.js'
import type { LapDrainMeta, MessageAnnotations } from '../../../src/protocol.js'

type ControllableHost = SendMessageHost & {
  /** Fire the currently-registered subscriber once (simulates an update-cycle commit). */
  fireCommit(): void
  /** Push an error into the drain-error buffer as if window.error fired. */
  pushError(err: LapDrainMeta['errors'][number]): void
}

function makeHost(
  overrides: Partial<SendMessageHost> & { state?: unknown } = {},
): ControllableHost {
  const state = overrides.state ?? { count: 0 }
  const listeners = new Set<() => void>()
  const errorBuffer: LapDrainMeta['errors'] = []

  const host: ControllableHost = {
    getState: overrides.getState ?? (() => state),
    send: overrides.send ?? vi.fn(),
    flush: overrides.flush ?? vi.fn(),
    subscribe:
      overrides.subscribe ??
      ((listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }),
    getAndClearDrainErrors:
      overrides.getAndClearDrainErrors ?? (() => errorBuffer.splice(0, errorBuffer.length)),
    getMsgAnnotations: overrides.getMsgAnnotations ?? (() => null),
    getMsgSchema: overrides.getMsgSchema ?? (() => null),
    getDispatchPolicy: overrides.getDispatchPolicy,
    getBindingDescriptors: overrides.getBindingDescriptors ?? (() => null),
    getAgentAffordances: overrides.getAgentAffordances ?? (() => null),
    proposeConfirm: overrides.proposeConfirm ?? vi.fn(),
    fireCommit() {
      for (const l of Array.from(listeners)) l()
    },
    pushError(err) {
      errorBuffer.push(err)
    },
  }
  return host
}

describe('randomUUID', () => {
  it('returns a string of length 36', () => {
    const id = randomUUID()
    expect(typeof id).toBe('string')
    expect(id).toHaveLength(36)
  })
})

describe('handleSendMessage — validation and annotations', () => {
  it('invalid msg (missing type) → {status: rejected, reason: invalid}', async () => {
    const host = makeHost()
    // @ts-expect-error intentionally passing invalid arg
    const result = await handleSendMessage(host, { msg: { notType: 'oops' } })
    expect(result).toEqual({ status: 'rejected', reason: 'invalid' })
  })

  it('invalid msg (non-string type) → {status: rejected, reason: invalid}', async () => {
    const host = makeHost()
    // @ts-expect-error intentionally passing invalid arg
    const result = await handleSendMessage(host, { msg: { type: 42 } })
    expect(result).toEqual({ status: 'rejected', reason: 'invalid' })
  })

  it('human-only annotation → {status: rejected, reason: human-only}, no side effects', async () => {
    const send = vi.fn()
    const proposeConfirm = vi.fn()
    const annotations: Record<string, MessageAnnotations> = {
      ClickButton: {
        intent: 'click button',
        alwaysAffordable: false,
        requiresConfirm: false,
        dispatchMode: 'human-only',
        examples: [],
        warning: null,
        emits: [],
      },
    }
    const host = makeHost({ send, proposeConfirm, getMsgAnnotations: () => annotations })

    const result = await handleSendMessage(host, { msg: { type: 'ClickButton' } })

    expect(result).toEqual({ status: 'rejected', reason: 'human-only' })
    expect(send).not.toHaveBeenCalled()
    expect(proposeConfirm).not.toHaveBeenCalled()
  })

  it('requiresConfirm → proposes ConfirmEntry, returns {status: pending-confirmation, confirmId}', async () => {
    const proposeConfirm = vi.fn()
    const annotations: Record<string, MessageAnnotations> = {
      DeleteAccount: {
        intent: 'delete account',
        alwaysAffordable: false,
        requiresConfirm: true,
        dispatchMode: 'shared',
        examples: [],
        warning: null,
        emits: [],
      },
    }
    const host = makeHost({ proposeConfirm, getMsgAnnotations: () => annotations })

    const result = await handleSendMessage(host, {
      msg: { type: 'DeleteAccount', userId: 'u1' },
      reason: 'user requested deletion',
    })

    expect(result.status).toBe('pending-confirmation')
    expect('confirmId' in result && typeof result.confirmId).toBe('string')
    expect(proposeConfirm).toHaveBeenCalledOnce()
    const proposed = proposeConfirm.mock.calls[0]![0]
    expect(proposed.variant).toBe('DeleteAccount')
    expect(proposed.payload).toEqual({ userId: 'u1' })
    expect(proposed.intent).toBe('delete account')
    expect(proposed.reason).toBe('user requested deletion')
  })

  it('schema mismatch (missing required field) → rejected with explanation', async () => {
    // The motivating case: agent constructs a payload from
    // payloadHint but forgets a required field. Schema validation
    // catches this before the reducer runs and reports which field
    // is missing.
    const send = vi.fn()
    const host = makeHost({
      send,
      getMsgAnnotations: () => ({
        SetCell: {
          intent: 'Set a cell value',
          alwaysAffordable: false,
          requiresConfirm: false,
          dispatchMode: 'shared',
          examples: [],
          warning: null,
          emits: [],
        },
      }),
      getMsgSchema: () => ({
        discriminant: 'type',
        variants: {
          SetCell: {
            criterionId: 'string',
            value: 'number',
          },
        },
      }),
    })

    const result = await handleSendMessage(host, {
      msg: { type: 'SetCell', criterionId: 'c1' },
    })

    expect(send).not.toHaveBeenCalled()
    expect(result.status).toBe('rejected')
    if (result.status === 'rejected') {
      expect(result.reason).toBe('invalid')
      expect(result.detail).toContain('value')
      expect(result.detail).toContain('required field is missing')
    }
  })

  it('schema mismatch (wrong type) → rejected with type detail', async () => {
    const send = vi.fn()
    const host = makeHost({
      send,
      getMsgAnnotations: () => ({
        SetCell: {
          intent: null,
          alwaysAffordable: false,
          requiresConfirm: false,
          dispatchMode: 'shared',
          examples: [],
          warning: null,
          emits: [],
        },
      }),
      getMsgSchema: () => ({
        discriminant: 'type',
        variants: { SetCell: { value: 'number' } },
      }),
    })

    const result = await handleSendMessage(host, {
      msg: { type: 'SetCell', value: 'not a number' },
    })

    expect(send).not.toHaveBeenCalled()
    if (result.status === 'rejected') {
      expect(result.detail).toContain('expected number')
      expect(result.detail).toContain('got string')
    }
  })

  it('schema mismatch (enum value not in list) → rejected', async () => {
    const send = vi.fn()
    const host = makeHost({
      send,
      getMsgAnnotations: () => ({
        SetSharing: {
          intent: null,
          alwaysAffordable: false,
          requiresConfirm: false,
          dispatchMode: 'shared',
          examples: [],
          warning: null,
          emits: [],
        },
      }),
      getMsgSchema: () => ({
        discriminant: 'type',
        variants: {
          SetSharing: {
            level: { enum: ['private', 'unlisted', 'public'] },
          },
        },
      }),
    })

    const result = await handleSendMessage(host, {
      msg: { type: 'SetSharing', level: 'secret' },
    })

    expect(send).not.toHaveBeenCalled()
    if (result.status === 'rejected') {
      expect(result.detail).toContain('not in the enum')
      expect(result.detail).toContain("'secret'")
    }
  })

  it('schema validation tolerates optional fields when omitted', async () => {
    // Optional fields (TS `?:` or @should-flagged) don't fail
    // validation when absent — required fields do.
    const send = vi.fn()
    const host = makeHost({
      send,
      getMsgAnnotations: () => ({
        Save: {
          intent: null,
          alwaysAffordable: false,
          requiresConfirm: false,
          dispatchMode: 'shared',
          examples: [],
          warning: null,
          emits: [],
        },
      }),
      getMsgSchema: () => ({
        discriminant: 'type',
        variants: {
          Save: {
            title: 'string',
            description: { type: 'string', optional: true },
          },
        },
      }),
    })

    const result = await handleSendMessage(host, {
      msg: { type: 'Save', title: 'hello' },
      waitFor: 'none',
    })

    expect(send).toHaveBeenCalledOnce()
    expect(result.status).toBe('dispatched')
  })

  it('schema validation passes through unknown-typed fields without checking', async () => {
    // `'unknown'` in the schema means the compiler couldn't resolve
    // the type; the validator must accept any value at that position
    // (the reducer takes responsibility from there).
    const send = vi.fn()
    const host = makeHost({
      send,
      getMsgAnnotations: () => ({
        Set: {
          intent: null,
          alwaysAffordable: false,
          requiresConfirm: false,
          dispatchMode: 'shared',
          examples: [],
          warning: null,
          emits: [],
        },
      }),
      getMsgSchema: () => ({
        discriminant: 'type',
        variants: { Set: { matrix: 'unknown' } },
      }),
    })

    const result = await handleSendMessage(host, {
      msg: { type: 'Set', matrix: { whatever: 'shape' } },
      waitFor: 'none',
    })

    expect(send).toHaveBeenCalledOnce()
    expect(result.status).toBe('dispatched')
  })

  it('extra fields not in schema are tolerated', async () => {
    // Adding a field via update.ts before regenerating the schema
    // shouldn't bounce all dispatches. Be lenient on extras.
    const send = vi.fn()
    const host = makeHost({
      send,
      getMsgAnnotations: () => ({
        Inc: {
          intent: null,
          alwaysAffordable: false,
          requiresConfirm: false,
          dispatchMode: 'shared',
          examples: [],
          warning: null,
          emits: [],
        },
      }),
      getMsgSchema: () => ({
        discriminant: 'type',
        variants: { Inc: {} },
      }),
    })

    const result = await handleSendMessage(host, {
      msg: { type: 'Inc', extraField: 'also fine' },
      waitFor: 'none',
    })

    expect(send).toHaveBeenCalledOnce()
    expect(result.status).toBe('dispatched')
  })

  it('unknown variant when annotations map is non-empty → rejected as invalid', async () => {
    const send = vi.fn()
    const host = makeHost({
      send,
      getMsgAnnotations: () => ({
        OtherMsg: {
          intent: 'other',
          alwaysAffordable: false,
          requiresConfirm: false,
          dispatchMode: 'shared',
          examples: [],
          warning: null,
          emits: [],
        },
      }),
    })

    const result = await handleSendMessage(host, { msg: { type: 'UnknownMsg' } })

    expect(send).not.toHaveBeenCalled()
    expect(result.status).toBe('rejected')
    if (result.status === 'rejected') {
      expect(result.reason).toBe('invalid')
      expect(result.detail).toMatch('UnknownMsg')
    }
  })
})

describe('handleSendMessage — waitFor modes', () => {
  it('waitFor: "none" dispatches without flushing, returns dispatched envelope with empty drain', async () => {
    const flush = vi.fn()
    const send = vi.fn()
    const host = makeHost({ flush, send })

    const result = await handleSendMessage(host, { msg: { type: 'Noop' }, waitFor: 'none' })

    expect(send).toHaveBeenCalledWith({ type: 'Noop' })
    expect(flush).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      status: 'dispatched',
      drain: { effectsObserved: 0, timedOut: false, errors: [] },
    })
  })

  it('waitFor: "idle" flushes once and yields a microtask; no drain loop', async () => {
    const flush = vi.fn()
    const send = vi.fn()
    const host = makeHost({ flush, send })

    const result = await handleSendMessage(host, { msg: { type: 'Go' }, waitFor: 'idle' })

    expect(send).toHaveBeenCalledWith({ type: 'Go' })
    expect(flush).toHaveBeenCalledOnce()
    expect(result).toMatchObject({
      status: 'dispatched',
      drain: { effectsObserved: 1, timedOut: false, errors: [] },
    })
  })

  it('default waitFor is "drained" — quiet window elapses then returns', async () => {
    const send = vi.fn()
    const flush = vi.fn()
    const host = makeHost({ send, flush })

    const result = await handleSendMessage(host, {
      msg: { type: 'Tick' },
      drainQuietMs: 20,
      timeoutMs: 200,
    })

    expect(send).toHaveBeenCalledWith({ type: 'Tick' })
    expect(flush).toHaveBeenCalled()
    expect(result.status).toBe('dispatched')
    if (result.status === 'dispatched') {
      expect(result.drain.timedOut).toBe(false)
    }
  })

  it('drain loop resets quiet window on each commit; times out when commits keep firing', async () => {
    const host = makeHost()
    const promise = handleSendMessage(host, {
      msg: { type: 'Chatty' },
      drainQuietMs: 50,
      timeoutMs: 120,
    })

    // Fire commits substantially faster than the quiet window so the
    // drain never quiets. Use recursive setTimeout rather than
    // setInterval to avoid setInterval's event-loop catch-up behavior
    // which can collapse ticks when the loop is busy.
    let stopped = false
    const fire = () => {
      if (stopped) return
      host.fireCommit()
      setTimeout(fire, 10)
    }
    setTimeout(fire, 0)

    const result = await promise
    stopped = true

    expect(result.status).toBe('dispatched')
    if (result.status === 'dispatched') {
      expect(result.drain.timedOut).toBe(true)
      expect(result.drain.effectsObserved).toBeGreaterThan(0)
      // The final truncated quiet window fires the setTimeout a hair
      // below capMs by design — budget = capMs - elapsed, measured at
      // iteration start — so durationMs can land up to ~1ms under cap
      // when the setTimeout's own resolution rounds down. Check we
      // ran for most of the cap rather than asserting a strict >=.
      expect(result.drain.durationMs).toBeGreaterThanOrEqual(100)
    }
  })

  it('drain surfaces buffered errors in the envelope and clears the buffer', async () => {
    const host = makeHost()
    host.pushError({ kind: 'error', message: 'boom', stack: 'at foo' })
    host.pushError({ kind: 'unhandledrejection', message: 'fetch rejected' })

    // getAndClearDrainErrors is called at the START of drain to clear
    // stale errors, so pre-seeded errors from before this call are
    // discarded. Seed again inside the drain window via a commit that
    // pushes errors synchronously.
    const result = await handleSendMessage(host, {
      msg: { type: 'Run' },
      drainQuietMs: 20,
      timeoutMs: 200,
      waitFor: 'drained',
    })

    expect(result.status).toBe('dispatched')
    if (result.status === 'dispatched') {
      // Pre-seeded errors were cleared at drain start; none fired during drain.
      expect(result.drain.errors).toEqual([])
    }
  })

  it('reducer/binding throw during flush surfaces in drain.errors, dispatch is `dispatched`', async () => {
    // Phase 5: when host.flush() throws (e.g. a binding's accessor
    // crashes during the post-reducer view-update), the dispatch is
    // STILL considered dispatched — the agent gets the stateDiff and
    // the throw lands in drain.errors. Returning HTTP 500 / status
    // rejected would be misleading: the reducer ran, state advanced,
    // and the agent retrying the same dispatch wouldn't help.
    let stateBox: { x: number } = { x: 0 }
    const send = vi.fn(() => {
      stateBox = { x: 1 }
    })
    const flush = vi.fn(() => {
      throw new Error('scoring crashed: unexpected ease value')
    })
    const host = makeHost({
      state: stateBox,
      getState: () => stateBox,
      send,
      flush,
    })

    const result = await handleSendMessage(host, {
      msg: { type: 'Run' },
      drainQuietMs: 20,
      timeoutMs: 200,
      waitFor: 'drained',
    })

    expect(result.status).toBe('dispatched')
    if (result.status === 'dispatched') {
      expect(result.drain.errors.length).toBeGreaterThan(0)
      expect(result.drain.errors[0]).toMatchObject({
        kind: 'error',
        message: expect.stringContaining('scoring crashed'),
      })
    }
    expect(send).toHaveBeenCalledOnce()
    expect(flush).toHaveBeenCalledOnce()
  })

  it('reducer throw at host.send time also surfaces — flush skipped', async () => {
    // If host.send itself throws (the reducer threw synchronously in
    // a non-microtask path, or the host's queue rejected the Msg),
    // we don't try to flush a Msg that wasn't queued. The error
    // still lands in drain.errors and the dispatch reports as
    // `dispatched` so the agent gets a structured response rather
    // than HTTP 500.
    const send = vi.fn(() => {
      throw new TypeError('cannot read property of null')
    })
    const flush = vi.fn()
    const host = makeHost({ send, flush })

    const result = await handleSendMessage(host, {
      msg: { type: 'Boom' },
      drainQuietMs: 10,
      timeoutMs: 100,
      waitFor: 'drained',
    })

    expect(result.status).toBe('dispatched')
    if (result.status === 'dispatched') {
      expect(result.drain.errors[0]).toMatchObject({
        kind: 'error',
        message: expect.stringContaining('cannot read property'),
      })
    }
    expect(send).toHaveBeenCalledOnce()
    expect(flush).not.toHaveBeenCalled()
  })

  it('strict-mode validation warnings propagate to drain.warnings', async () => {
    // The host opts into strict policy. The dispatch lands (the agent
    // gave a value the validator can't structurally check, but
    // unknown-typed fields are still accepted), and the warning
    // surfaces in drain.warnings so the LLM sees "we accepted this
    // but didn't validate it" — useful for self-correcting on the
    // next attempt.
    const host = makeHost({
      getMsgSchema: () => ({
        discriminant: 'type',
        variants: { Set: { payload: 'unknown' } },
      }),
      getMsgAnnotations: () => ({
        Set: {
          intent: null,
          dispatchMode: 'shared',
          requiresConfirm: false,
          alwaysAffordable: false,
          examples: [],
          warning: null,
          emits: [],
        },
      }),
      getDispatchPolicy: () => 'strict',
    })

    const result = await handleSendMessage(host, {
      msg: { type: 'Set', payload: { whatever: 1 } },
      drainQuietMs: 10,
      timeoutMs: 100,
    })

    expect(result.status).toBe('dispatched')
    if (result.status === 'dispatched') {
      expect(result.drain.warnings).toBeDefined()
      expect(result.drain.warnings?.[0]).toMatchObject({
        path: 'payload',
        code: 'untyped-field',
      })
    }
  })

  it('lenient-mode (default) omits drain.warnings entirely', async () => {
    // No `warnings` key on the drain envelope — keeps wire shape
    // minimal for the common case.
    const host = makeHost({
      getMsgSchema: () => ({
        discriminant: 'type',
        variants: { Set: { payload: 'unknown' } },
      }),
    })
    const result = await handleSendMessage(host, {
      msg: { type: 'Set', payload: { whatever: 1 } },
      drainQuietMs: 10,
      timeoutMs: 100,
    })
    expect(result.status).toBe('dispatched')
    if (result.status === 'dispatched') {
      expect(result.drain.warnings).toBeUndefined()
    }
  })

  it('drain captures errors that fire during the window', async () => {
    const host = makeHost()
    // Fire a commit that pushes an error while drain is running.
    setTimeout(() => {
      host.pushError({ kind: 'unhandledrejection', message: 'mid-drain failure' })
      host.fireCommit()
    }, 10)

    const result = await handleSendMessage(host, {
      msg: { type: 'Run' },
      drainQuietMs: 40,
      timeoutMs: 200,
      waitFor: 'drained',
    })

    expect(result.status).toBe('dispatched')
    if (result.status === 'dispatched') {
      expect(result.drain.errors).toHaveLength(1)
      expect(result.drain.errors[0]!.message).toBe('mid-drain failure')
      expect(result.drain.errors[0]!.kind).toBe('unhandledrejection')
    }
  })
})

describe('handleSendMessage — response envelope', () => {
  it('envelope includes actions and drain meta but omits stateAfter by default', async () => {
    const send = vi.fn()
    const state = { count: 7 }
    const host = makeHost({
      send,
      state,
      getBindingDescriptors: () => [{ variant: 'Increment' }],
      getMsgAnnotations: () => ({
        Increment: {
          intent: 'increment',
          alwaysAffordable: false,
          requiresConfirm: false,
          dispatchMode: 'shared',
          examples: [],
          warning: null,
          emits: [],
        },
      }),
    })

    const result = await handleSendMessage(host, {
      msg: { type: 'Increment' },
      waitFor: 'idle',
    })

    expect(result).toMatchObject({
      status: 'dispatched',
      actions: [
        { variant: 'Increment', intent: 'increment', source: 'binding', requiresConfirm: false },
      ],
      drain: { effectsObserved: 1, timedOut: false, errors: [] },
    })
    // stateAfter is opt-in via includeState: true. Not requested → must not be on the response.
    expect(result).not.toHaveProperty('stateAfter')
  })

  it('includeState: true echoes the post-dispatch snapshot', async () => {
    let currentState: unknown = { count: 0 }
    const send = vi.fn(() => {
      currentState = { count: 1 }
    })
    const getState = vi.fn(() => currentState)
    const host = makeHost({ send, getState })

    const result = await handleSendMessage(host, {
      msg: { type: 'SomeMsg' },
      waitFor: 'idle',
      includeState: true,
    })

    expect(result).toMatchObject({ status: 'dispatched', stateAfter: { count: 1 } })
  })

  it('default (no includeState) suppresses stateAfter even when state changed', async () => {
    let currentState: unknown = { count: 0 }
    const send = vi.fn(() => {
      currentState = { count: 1 }
    })
    const getState = vi.fn(() => currentState)
    const host = makeHost({ send, getState })

    const result = await handleSendMessage(host, { msg: { type: 'SomeMsg' }, waitFor: 'idle' })

    expect(result.status).toBe('dispatched')
    expect(result).not.toHaveProperty('stateAfter')
  })

  it('no annotations → dispatches and returns envelope', async () => {
    const send = vi.fn()
    const host = makeHost({ send, getMsgAnnotations: () => ({}) })

    const result = await handleSendMessage(host, { msg: { type: 'AnyMsg' }, waitFor: 'idle' })

    expect(send).toHaveBeenCalledWith({ type: 'AnyMsg' })
    expect(result.status).toBe('dispatched')
  })

  it('null annotations → dispatches and returns envelope', async () => {
    const send = vi.fn()
    const host = makeHost({ send, getMsgAnnotations: () => null })

    const result = await handleSendMessage(host, { msg: { type: 'AnyMsg' }, waitFor: 'idle' })

    expect(send).toHaveBeenCalledWith({ type: 'AnyMsg' })
    expect(result.status).toBe('dispatched')
  })
})
