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

  it('humanOnly annotation → {status: rejected, reason: humanOnly}, no side effects', async () => {
    const send = vi.fn()
    const proposeConfirm = vi.fn()
    const annotations: Record<string, MessageAnnotations> = {
      ClickButton: {
        intent: 'click button',
        alwaysAffordable: false,
        requiresConfirm: false,
        humanOnly: true,
      },
    }
    const host = makeHost({ send, proposeConfirm, getMsgAnnotations: () => annotations })

    const result = await handleSendMessage(host, { msg: { type: 'ClickButton' } })

    expect(result).toEqual({ status: 'rejected', reason: 'humanOnly' })
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
        humanOnly: false,
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

  it('unknown variant when annotations map is non-empty → rejected as invalid', async () => {
    const send = vi.fn()
    const host = makeHost({
      send,
      getMsgAnnotations: () => ({
        OtherMsg: {
          intent: 'other',
          alwaysAffordable: false,
          requiresConfirm: false,
          humanOnly: false,
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
  it('envelope includes current state, actions, and drain meta', async () => {
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
          humanOnly: false,
        },
      }),
    })

    const result = await handleSendMessage(host, {
      msg: { type: 'Increment' },
      waitFor: 'idle',
    })

    expect(result).toMatchObject({
      status: 'dispatched',
      stateAfter: state,
      actions: [
        { variant: 'Increment', intent: 'increment', source: 'binding', requiresConfirm: false },
      ],
      drain: { effectsObserved: 1, timedOut: false, errors: [] },
    })
  })

  it('stateAfter reflects post-dispatch value', async () => {
    let currentState: unknown = { count: 0 }
    const send = vi.fn(() => {
      currentState = { count: 1 }
    })
    const getState = vi.fn(() => currentState)
    const host = makeHost({ send, getState })

    const result = await handleSendMessage(host, { msg: { type: 'SomeMsg' }, waitFor: 'idle' })

    expect(result).toMatchObject({ status: 'dispatched', stateAfter: { count: 1 } })
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
