import { describe, it, expect, vi } from 'vitest'
import {
  init,
  update,
  connect,
  type AgentChatState,
  type AgentChatMsg,
} from '../../src/client/agentChat.js'

describe('agentChat: init', () => {
  it('returns empty pendingInput, not submitting, no effects', () => {
    const [s, e] = init()
    expect(s).toEqual({ pendingInput: '', submitting: false })
    expect(e).toHaveLength(0)
  })

  it('seeds pendingInput from opts.initialInput', () => {
    const [s] = init({ initialInput: 'restored' })
    expect(s.pendingInput).toBe('restored')
  })
})

describe('agentChat: SetInput', () => {
  it('updates pendingInput and emits no effect', () => {
    const [s0] = init()
    const [s1, effects] = update(s0, { type: 'SetInput', value: 'hello' })
    expect(s1.pendingInput).toBe('hello')
    expect(effects).toHaveLength(0)
  })

  it('preserves state ref when value is unchanged (no spurious commits)', () => {
    const [s0] = init({ initialInput: 'x' })
    const [s1] = update(s0, { type: 'SetInput', value: 'x' })
    expect(s1).toBe(s0)
  })

  it('updates submitting state independently of input changes', () => {
    const [s0] = init()
    const [s1] = update(s0, { type: 'SetInput', value: 'hello' })
    expect(s1.submitting).toBe(false)
  })
})

describe('agentChat: Submit', () => {
  it('emits AgentChatSendInput with the trimmed text and clears pendingInput', () => {
    const [s0] = init()
    const [s1] = update(s0, { type: 'SetInput', value: '  hello  ' })
    const before = Date.now()
    const [s2, effects] = update(s1, { type: 'Submit' })
    const after = Date.now()

    expect(s2.pendingInput).toBe('')
    expect(s2.submitting).toBe(true)
    expect(effects).toHaveLength(1)
    const eff = effects[0]!
    expect(eff.type).toBe('AgentChatSendInput')
    if (eff.type === 'AgentChatSendInput') {
      expect(eff.text).toBe('hello')
      expect(eff.at).toBeGreaterThanOrEqual(before)
      expect(eff.at).toBeLessThanOrEqual(after)
    }
  })

  it('no-ops on empty / whitespace-only input', () => {
    const [s0] = init()
    const [s1] = update(s0, { type: 'SetInput', value: '   ' })
    const [s2, effects] = update(s1, { type: 'Submit' })
    expect(s2).toBe(s1) // identity preserved
    expect(effects).toEqual([])
  })

  it('no-ops while submitting (prevents double-send on bounce)', () => {
    const [s0] = init()
    const [s1] = update(s0, { type: 'SetInput', value: 'hi' })
    const [s2] = update(s1, { type: 'Submit' })
    // s2.submitting === true; another Submit should be a no-op
    const [s3, effects] = update(s2, { type: 'Submit' })
    expect(s3).toBe(s2)
    expect(effects).toEqual([])
  })
})

describe('agentChat: SubmitComplete', () => {
  it('clears submitting flag', () => {
    const [s0] = init()
    const [s1] = update(s0, { type: 'SetInput', value: 'x' })
    const [s2] = update(s1, { type: 'Submit' })
    expect(s2.submitting).toBe(true)
    const [s3, effects] = update(s2, { type: 'SubmitComplete' })
    expect(s3.submitting).toBe(false)
    expect(effects).toEqual([])
  })

  it('is a no-op when not submitting (no spurious commits)', () => {
    const [s0] = init()
    const [s1] = update(s0, { type: 'SubmitComplete' })
    expect(s1).toBe(s0)
  })
})

describe('agentChat: connect()', () => {
  const buildBag = (
    state: AgentChatState,
    send = vi.fn() as unknown as (m: AgentChatMsg) => void,
  ) => {
    return { bag: connect<AgentChatState>((s) => s, send), send: send as ReturnType<typeof vi.fn> }
  }

  it('input.value reflects pendingInput; data-submitting reflects submitting', () => {
    const [s0] = init({ initialInput: 'draft' })
    const { bag } = buildBag(s0)
    expect(bag.input.value(s0)).toBe('draft')
    expect(bag.root['data-submitting'](s0)).toBe(false)
    expect(bag.input.disabled(s0)).toBe(false)
  })

  it('submitButton.disabled is true when pendingInput is empty/whitespace', () => {
    const [s0] = init()
    const { bag } = buildBag(s0)
    expect(bag.submitButton.disabled(s0)).toBe(true)
    const [s1] = update(s0, { type: 'SetInput', value: '   ' })
    expect(bag.submitButton.disabled(s1)).toBe(true)
    const [s2] = update(s0, { type: 'SetInput', value: 'real' })
    expect(bag.submitButton.disabled(s2)).toBe(false)
  })

  it('submitButton.disabled is true while submitting', () => {
    const [s0] = init()
    const [s1] = update(s0, { type: 'SetInput', value: 'go' })
    const [s2] = update(s1, { type: 'Submit' })
    const { bag } = buildBag(s2)
    expect(bag.submitButton.disabled(s2)).toBe(true)
    expect(bag.input.disabled(s2)).toBe(true)
  })

  it('canSubmit is true iff there is non-whitespace content and not submitting', () => {
    const [s0] = init()
    const { bag } = buildBag(s0)
    expect(bag.canSubmit(s0)).toBe(false)
    const [s1] = update(s0, { type: 'SetInput', value: 'go' })
    expect(bag.canSubmit(s1)).toBe(true)
    const [s2] = update(s1, { type: 'Submit' })
    expect(bag.canSubmit(s2)).toBe(false) // submitting
  })

  it('input.oninput dispatches SetInput with the target value', () => {
    const [s0] = init()
    const { bag, send } = buildBag(s0)
    const fakeEvent = { target: { value: 'typed' } } as unknown as Event
    bag.input.oninput(fakeEvent)
    expect(send).toHaveBeenCalledWith({ type: 'SetInput', value: 'typed' })
  })

  it('input.onkeydown dispatches Submit on Enter (no shift) and prevents default', () => {
    const [s0] = init()
    const { bag, send } = buildBag(s0)
    const preventDefault = vi.fn()
    bag.input.onkeydown({
      key: 'Enter',
      shiftKey: false,
      preventDefault,
    } as unknown as KeyboardEvent)
    expect(preventDefault).toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith({ type: 'Submit' })
  })

  it('input.onkeydown does NOT submit on Shift+Enter (newline path for multiline hosts)', () => {
    const [s0] = init()
    const { bag, send } = buildBag(s0)
    const preventDefault = vi.fn()
    bag.input.onkeydown({
      key: 'Enter',
      shiftKey: true,
      preventDefault,
    } as unknown as KeyboardEvent)
    expect(preventDefault).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('input.onkeydown ignores other keys', () => {
    const [s0] = init()
    const { bag, send } = buildBag(s0)
    const preventDefault = vi.fn()
    bag.input.onkeydown({ key: 'a', shiftKey: false, preventDefault } as unknown as KeyboardEvent)
    expect(preventDefault).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('submitButton.onClick dispatches Submit', () => {
    const [s0] = init()
    const { bag, send } = buildBag(s0)
    bag.submitButton.onClick()
    const calls = (send.mock.calls as Array<[AgentChatMsg]>).map((c) => c[0])
    expect(calls).toEqual([{ type: 'Submit' }])
  })
})
