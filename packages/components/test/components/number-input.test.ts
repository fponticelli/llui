import { describe, it, expect, vi } from 'vitest'
import { init, update, connect } from '../../src/components/number-input'
import type { NumberInputState } from '../../src/components/number-input'

type Ctx = { n: NumberInputState }
const wrap = (n: NumberInputState): Ctx => ({ n })

describe('number-input reducer', () => {
  it('initializes with null value by default', () => {
    const s = init()
    expect(s.value).toBeNull()
    expect(s.rawText).toBe('')
  })

  it('setValue clamps and snaps', () => {
    const s0 = init({ min: 0, max: 10, step: 2 })
    const [s1] = update(s0, { type: 'setValue', value: 15 })
    expect(s1.value).toBe(10)
    const [s2] = update(s0, { type: 'setValue', value: 3 })
    expect(s2.value).toBe(4)
  })

  it('increment adds step', () => {
    const s0 = init({ value: 5, step: 2 })
    const [s] = update(s0, { type: 'increment' })
    expect(s.value).toBe(7)
  })

  it('increment from null treats as 0', () => {
    const s0 = init({ step: 5 })
    const [s] = update(s0, { type: 'increment' })
    expect(s.value).toBe(5)
  })

  it('increment with multiplier', () => {
    const s0 = init({ value: 0, step: 1 })
    const [s] = update(s0, { type: 'increment', multiplier: 10 })
    expect(s.value).toBe(10)
  })

  it('decrement clamped by min', () => {
    const s0 = init({ value: 2, min: 0, step: 1 })
    const [s] = update(s0, { type: 'decrement', multiplier: 10 })
    expect(s.value).toBe(0)
  })

  it('setRawText updates text only', () => {
    const s0 = init({ value: 5 })
    const [s] = update(s0, { type: 'setRawText', text: 'abc' })
    expect(s.rawText).toBe('abc')
    expect(s.value).toBe(5)
  })

  it('commit parses rawText or restores last value', () => {
    const s0 = { ...init({ value: 5, step: 1, max: 100 }), rawText: '17' }
    const [s1] = update(s0, { type: 'commit' })
    expect(s1.value).toBe(17)
    expect(s1.rawText).toBe('17')
    // Invalid text restores previous value
    const s2 = { ...s1, rawText: 'junk' }
    const [s3] = update(s2, { type: 'commit' })
    expect(s3.value).toBe(17)
    expect(s3.rawText).toBe('17')
  })

  it('toMin/toMax snap to bounds', () => {
    const s0 = init({ value: 5, min: 0, max: 10 })
    expect(update(s0, { type: 'toMin' })[0].value).toBe(0)
    expect(update(s0, { type: 'toMax' })[0].value).toBe(10)
  })

  it('disabled blocks value changes', () => {
    const s0 = init({ value: 5, disabled: true })
    const [s] = update(s0, { type: 'increment' })
    expect(s.value).toBe(5)
  })

  it('handles fractional step without drift', () => {
    const s0 = init({ value: 0, step: 0.1 })
    const [s1] = update(s0, { type: 'increment' })
    expect(s1.value).toBe(0.1)
    const [s2] = update(s1, { type: 'increment' })
    expect(s2.value).toBe(0.2)
    const [s3] = update(s2, { type: 'increment' })
    expect(s3.value).toBe(0.3)
  })
})

describe('number-input.connect', () => {
  const p = connect<Ctx>((s) => s.n, vi.fn())

  it('input role=spinbutton', () => {
    expect(p.input.role).toBe('spinbutton')
  })

  it('aria-valuenow tracks value', () => {
    expect(p.input['aria-valuenow'](wrap(init({ value: 42 })))).toBe(42)
    expect(p.input['aria-valuenow'](wrap(init({ value: null })))).toBeUndefined()
  })

  it('ArrowUp sends increment', () => {
    const send = vi.fn()
    const pc = connect<Ctx>((s) => s.n, send)
    pc.input.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true }))
    expect(send).toHaveBeenCalledWith({ type: 'increment' })
  })

  it('increment disabled at max', () => {
    const p = connect<Ctx>((s) => s.n, vi.fn())
    expect(p.increment.disabled(wrap(init({ value: 10, max: 10 })))).toBe(true)
    expect(p.increment.disabled(wrap(init({ value: 5, max: 10 })))).toBe(false)
  })

  it('validate blocks setValue on invalid input', () => {
    const send = vi.fn()
    const pc = connect<Ctx>((s) => s.n, send, {
      validate: (v) => (v < 0 ? ['must be non-negative'] : null),
    })
    const input = document.createElement('input')
    // Type a negative number
    input.value = '-5'
    const ev = new Event('input')
    Object.defineProperty(ev, 'target', { value: input })
    pc.input.onInput(ev)
    // setRawText should still be dispatched
    expect(send).toHaveBeenCalledWith({ type: 'setRawText', text: '-5' })
    // setValue should NOT be dispatched (blocked by validate)
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'setValue' }))
    // Type a valid number
    send.mockClear()
    input.value = '5'
    const ev2 = new Event('input')
    Object.defineProperty(ev2, 'target', { value: input })
    pc.input.onInput(ev2)
    expect(send).toHaveBeenCalledWith({ type: 'setValue', value: 5 })
  })
})
