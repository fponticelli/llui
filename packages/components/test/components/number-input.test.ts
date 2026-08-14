import { describe, it, expect, vi } from 'vitest'
import { init, update, connect } from '../../src/components/number-input'
import { rootSignal, read } from '../_signal'

describe('number-input reducer', () => {
  it('initializes with null value by default', () => {
    const s = init()
    expect(s.value).toBeNull()
    expect(s.rawText).toBe('')
  })

  it('init clamps and snaps the seed value, like every other mutation path (#125)', () => {
    // init WAS the one way left to seed an off-grid / out-of-range value:
    // `value: opts.value ?? null` stored whatever it was handed.
    expect(init({ value: 5, step: 2 }).value).toBe(6)
    expect(init({ value: 5, step: 2 }).rawText).toBe('6')
    expect(init({ value: 15, min: 0, max: 10, step: 2 }).value).toBe(10)
    expect(init({ value: -5, min: 0, max: 10, step: 2 }).value).toBe(0)
    // The grid is min-anchored, so 5 is ON the grid when min is 1.
    expect(init({ value: 5, min: 1, step: 2 }).value).toBe(5)
    expect(init({ value: null }).value).toBeNull()
  })

  it('setValue clamps and snaps', () => {
    const s0 = init({ min: 0, max: 10, step: 2 })
    const [s1] = update(s0, { type: 'setValue', value: 15 })
    expect(s1.value).toBe(10)
    const [s2] = update(s0, { type: 'setValue', value: 3 })
    expect(s2.value).toBe(4)
  })

  it('increment adds step', () => {
    const s0 = init({ value: 4, step: 2 })
    const [s] = update(s0, { type: 'increment' })
    expect(s.value).toBe(6)
    // Same press from the off-grid 5 (the grid is anchored at 0 here, since min
    // is unbounded) lands ON the grid instead of adding a step — it used to
    // answer 7 and keep the value off-grid forever. The rationale is SPEC
    // CONFORMANCE, not unreachability: HTML's value-stepping algorithm uses the
    // magnitude of n only on the on-grid branch, so `stepUp()` from an off-grid
    // value moves to the next grid position and stops. 5 IS reachable — a
    // rehydrated/hand-built state can hold it (below), and `setValue(5)` with
    // `{min: 1, step: 2}` returns it, because the grid is min-anchored.
    const offGrid = { ...init({ step: 2 }), value: 5, rawText: '5' }
    expect(update(offGrid, { type: 'increment' })[0].value).toBe(6)
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

  it('snaps an exponential-notation step (#125 defect 1)', () => {
    const s0 = init({ min: 0, max: 1, step: 1e-7 })
    const [s1] = update(s0, { type: 'setValue', value: 3e-7 })
    expect(s1.value).toBe(3e-7)
    const [s2] = update({ ...s0, rawText: '0.0000003' }, { type: 'commit' })
    expect(s2.value).toBe(3e-7)
  })

  it('increment/decrement land on the grid from an off-grid start (#125 defect 2)', () => {
    // init snaps now, so the off-grid start is built directly — the shape a
    // rehydrated state can still hold.
    const s0 = { ...init({ min: 0, max: 100, step: 2 }), value: 3, rawText: '3' }
    expect(update(s0, { type: 'increment' })[0].value).toBe(4)
    expect(update(s0, { type: 'decrement' })[0].value).toBe(2)
    // A multiplier does not skip past the grid on the first press.
    expect(update(s0, { type: 'increment', multiplier: 10 })[0].value).toBe(4)
  })

  // `disabled` gates HUMAN interaction. A programmatic write from the host or an
  // agent is not an interaction, and dropping it left machines unwritable (#120).
  it('disabled still accepts a programmatic setValue', () => {
    const [s] = update(init({ value: 5, disabled: true, max: 10 }), { type: 'setValue', value: 8 })
    expect(s.value).toBe(8)
    expect(s.rawText).toBe('8')
  })

  it('readonly still accepts a programmatic setValue', () => {
    const [s] = update(init({ value: 5, readonly: true }), { type: 'setValue', value: 8 })
    expect(s.value).toBe(8)
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
  const p = connect(rootSignal(), vi.fn())

  it('input role=spinbutton', () => {
    expect(p.input.role).toBe('spinbutton')
  })

  it('aria-valuenow tracks value', () => {
    expect(read(p.input['aria-valuenow'], init({ value: 42 }))).toBe(42)
    expect(read(p.input['aria-valuenow'], init({ value: null }))).toBeUndefined()
  })

  it('ArrowUp sends increment', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send)
    pc.input.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true }))
    expect(send).toHaveBeenCalledWith({ type: 'increment' })
  })

  it('increment disabled at max', () => {
    const p = connect(rootSignal(), vi.fn())
    expect(read(p.increment.disabled, init({ value: 10, max: 10 }))).toBe(true)
    expect(read(p.increment.disabled, init({ value: 5, max: 10 }))).toBe(false)
  })

  it('onInput keeps in-progress text and does not snap/commit live', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send)
    const input = document.createElement('input')
    input.value = '1.'
    const ev = new Event('input')
    Object.defineProperty(ev, 'target', { value: input })
    pc.input.onInput(ev)
    // Only the raw text is recorded — "1." is preserved verbatim.
    expect(send).toHaveBeenCalledWith({ type: 'setRawText', text: '1.' })
    // No live setValue/commit that would clamp/snap the in-progress value.
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'setValue' }))
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'commit' }))
  })

  it('validate blocks commit on invalid input, allows it when valid', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send, {
      validate: (v) => (v < 0 ? ['must be non-negative'] : null),
    })
    const input = document.createElement('input')
    // Typing only records raw text — never setValue.
    input.value = '-5'
    const ev = new Event('input')
    Object.defineProperty(ev, 'target', { value: input })
    pc.input.onInput(ev)
    expect(send).toHaveBeenCalledWith({ type: 'setRawText', text: '-5' })
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'setValue' }))
    // Blur with an invalid value → commit is blocked by validate.
    send.mockClear()
    const blur = new FocusEvent('blur')
    Object.defineProperty(blur, 'target', { value: input })
    pc.input.onBlur(blur)
    expect(send).not.toHaveBeenCalledWith({ type: 'commit' })
    // Blur with a valid value → commit fires.
    send.mockClear()
    input.value = '5'
    const blur2 = new FocusEvent('blur')
    Object.defineProperty(blur2, 'target', { value: input })
    pc.input.onBlur(blur2)
    expect(send).toHaveBeenCalledWith({ type: 'commit' })
  })
})
