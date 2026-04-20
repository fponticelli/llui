import { describe, it, expect, vi } from 'vitest'
import { handleSendMessage, type SendMessageHost } from '../../../src/client/rpc/send-message.js'
import { randomUUID } from '../../../src/client/uuid.js'
import type { MessageAnnotations } from '../../../src/protocol.js'

function makeHost(overrides: Partial<SendMessageHost> & { state?: unknown } = {}): SendMessageHost {
  let _state = overrides.state ?? { count: 0 }
  return {
    getState: overrides.getState ?? (() => _state),
    send: overrides.send ?? vi.fn(),
    flush: overrides.flush ?? vi.fn(),
    getMsgAnnotations: overrides.getMsgAnnotations ?? (() => null),
    proposeConfirm: overrides.proposeConfirm ?? vi.fn(),
  }
}

describe('randomUUID', () => {
  it('returns a string of length 36', () => {
    const id = randomUUID()
    expect(typeof id).toBe('string')
    expect(id).toHaveLength(36)
  })
})

describe('handleSendMessage', () => {
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

  it('plain msg with no annotations → dispatches via send, returns {status: dispatched, stateAfter}', async () => {
    const send = vi.fn()
    const flush = vi.fn()
    const state = { count: 7 }
    const host = makeHost({ send, flush, state })

    const result = await handleSendMessage(host, { msg: { type: 'Increment' } })

    expect(send).toHaveBeenCalledWith({ type: 'Increment' })
    expect(flush).toHaveBeenCalled()
    expect(result).toEqual({ status: 'dispatched', stateAfter: state })
  })

  it('waitFor: none skips flush', async () => {
    const flush = vi.fn()
    const send = vi.fn()
    const host = makeHost({ flush, send })

    await handleSendMessage(host, { msg: { type: 'Noop' }, waitFor: 'none' })

    expect(send).toHaveBeenCalledWith({ type: 'Noop' })
    expect(flush).not.toHaveBeenCalled()
  })

  it('getState in stateAfter reflects post-dispatch value', async () => {
    // Simulate send mutating state synchronously (e.g. by spying and updating the returned value)
    let currentState: unknown = { count: 0 }
    const send = vi.fn(() => {
      currentState = { count: 1 }
    })
    const getState = vi.fn(() => currentState)
    const host = makeHost({ send, getState })

    const result = await handleSendMessage(host, { msg: { type: 'SomeMsg' } })

    // stateAfter reads getState() after send was called, so it should reflect the mutated value
    expect(result).toMatchObject({ status: 'dispatched', stateAfter: { count: 1 } })
  })

  it('annotation fallback when msg type absent from annotations → dispatches normally', async () => {
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

    expect(send).toHaveBeenCalledWith({ type: 'UnknownMsg' })
    expect(result.status).toBe('dispatched')
  })
})
