import { describe, it, expect, vi } from 'vitest'
import { init, update, connect, parseDate, formatDate } from '../../src/components/date-input'
import type { DateInputState } from '../../src/components/date-input'
import { rootSignal, read } from '../_signal'

describe('parseDate', () => {
  it('parses ISO YYYY-MM-DD', () => {
    expect(parseDate('2024-03-15')?.getFullYear()).toBe(2024)
    expect(parseDate('2024-03-15')?.getMonth()).toBe(2) // March = 2
    expect(parseDate('2024-03-15')?.getDate()).toBe(15)
  })

  it('parses with slashes', () => {
    expect(parseDate('2024/03/15')?.getDate()).toBe(15)
  })

  it('parses US format', () => {
    const d = parseDate('03/15/2024', 'us')
    expect(d?.getDate()).toBe(15)
    expect(d?.getMonth()).toBe(2)
  })

  it('parses EU format', () => {
    const d = parseDate('15/03/2024', 'eu')
    expect(d?.getDate()).toBe(15)
    expect(d?.getMonth()).toBe(2)
  })

  it('rejects invalid dates', () => {
    expect(parseDate('2024-02-30')).toBeNull() // Feb 30 doesn't exist
    expect(parseDate('abc')).toBeNull()
    expect(parseDate('')).toBeNull()
    expect(parseDate('2024-13-01')).toBeNull() // month 13
  })
})

describe('formatDate', () => {
  it('outputs YYYY-MM-DD', () => {
    expect(formatDate(new Date(2024, 2, 15))).toBe('2024-03-15')
    expect(formatDate(new Date(2024, 0, 5))).toBe('2024-01-05')
  })
})

describe('date-input reducer', () => {
  it('starts empty', () => {
    expect(init()).toMatchObject({ input: '', value: null, error: null })
  })

  it('init with value sets formatted input', () => {
    const s = init({ value: '2024-03-15' })
    expect(s.input).toBe('2024-03-15')
    expect(s.value).toBe('2024-03-15')
  })

  it('setInput parses a valid date', () => {
    const [s] = update(init(), { type: 'setInput', value: '2024-03-15' })
    expect(s.value).toBe('2024-03-15')
    expect(s.error).toBeNull()
  })

  it('setInput sets error=invalid on unparseable input', () => {
    const [s] = update(init(), { type: 'setInput', value: 'abc' })
    expect(s.value).toBeNull()
    expect(s.error).toBe('invalid')
  })

  it('empty input clears error', () => {
    const [s] = update(init(), { type: 'setInput', value: '' })
    expect(s.error).toBeNull()
  })

  it('before-min error', () => {
    const s0 = init({ min: '2024-01-01' })
    const [s] = update(s0, { type: 'setInput', value: '2023-12-31' })
    expect(s.error).toBe('before-min')
  })

  it('after-max error', () => {
    const s0 = init({ max: '2024-01-31' })
    const [s] = update(s0, { type: 'setInput', value: '2024-02-15' })
    expect(s.error).toBe('after-max')
  })

  it('clear wipes input + value + error', () => {
    let s: DateInputState = init({ value: '2024-01-01' })
    ;[s] = update(s, { type: 'clear' })
    expect(s).toMatchObject({ input: '', value: null, error: null })
  })

  it('disabled blocks setInput', () => {
    const s0 = init({ disabled: true })
    const [s] = update(s0, { type: 'setInput', value: '2024-01-01' })
    expect(s.input).toBe('')
  })

  it('setValue formats into input + validates', () => {
    const s0 = init({ max: '2024-01-01' })
    const [s] = update(s0, { type: 'setValue', value: '2025-01-01' })
    expect(s.input).toBe('2025-01-01')
    expect(s.error).toBe('after-max')
  })

  it('setMin re-validates existing value', () => {
    const s0 = init({ value: '2023-01-01' })
    const [s] = update(s0, { type: 'setMin', min: '2024-01-01' })
    expect(s.error).toBe('before-min')
  })

  it('setValue normalizes a loosely-formatted ISO string', () => {
    const [s] = update(init(), { type: 'setValue', value: '2024-3-5' })
    expect(s.value).toBe('2024-03-05')
    expect(s.input).toBe('2024-03-05')
  })

  it('setValue with an unparseable string reports invalid', () => {
    const [s] = update(init(), { type: 'setValue', value: 'nope' })
    expect(s.value).toBeNull()
    expect(s.error).toBe('invalid')
  })

  // `value` used to be a `Date`, which made an invalid one UNREPRESENTABLE.
  // As an ISO string it is representable, and `init` swallowed it: a US-format
  // value came back `{ value: null, input: '', error: null }`, indistinguishable
  // from an empty field. `setValue` already surfaces it; `init` now matches
  // (#138 review, item 12).
  it('init with an unparseable value reports invalid instead of swallowing it', () => {
    const s = init({ value: '03/15/2024' })
    expect(s.value).toBeNull()
    expect(s.error).toBe('invalid')
    // The rejected text is kept so the field shows what the host asked for.
    expect(s.input).toBe('03/15/2024')
  })

  it('an explicit init input still wins over the rejected value text', () => {
    const s = init({ value: 'nope', input: 'typing…' })
    expect(s.input).toBe('typing…')
    expect(s.error).toBe('invalid')
  })

  it('init with a value out of bounds still reports the bound, not invalid', () => {
    const s = init({ value: '2023-01-01', min: '2024-01-01' })
    expect(s.value).toBe('2023-01-01')
    expect(s.error).toBe('before-min')
  })
})

// State must be JSON-serializable (CLAUDE.md): devtools time-travel, replayTrace,
// agent snapshots and Vike SSR all restore state through JSON. A `Date` in State
// came back as a string and the next update() threw on `d.getFullYear` (#119).
describe('date-input state is JSON-serializable', () => {
  it('round-trips without change', () => {
    const s0 = init({ value: '2024-03-15', min: '2024-01-01', max: '2024-12-31' })
    const restored = JSON.parse(JSON.stringify(s0)) as DateInputState
    expect(restored).toEqual(s0)
  })

  it('update() on a restored state does not throw and still validates', () => {
    const s0 = init({ value: '2024-03-15', min: '2024-01-01', max: '2024-12-31' })
    const restored = JSON.parse(JSON.stringify(s0)) as DateInputState
    const [s1] = update(restored, { type: 'setValue', value: '2025-06-01' })
    expect(s1.error).toBe('after-max')
    const [s2] = update(restored, { type: 'setInput', value: '2024-06-01' })
    expect(s2.value).toBe('2024-06-01')
    expect(s2.error).toBeNull()
  })
})

describe('date-input.connect', () => {
  it('aria-invalid reflects error', () => {
    const p = connect(rootSignal(), vi.fn())
    const bad: DateInputState = { ...init(), error: 'invalid' }
    expect(read(p.input['aria-invalid'], bad)).toBe('true')
    expect(read(p.input['aria-invalid'], init())).toBeUndefined()
  })

  it('clearTrigger disabled when empty', () => {
    const p = connect(rootSignal(), vi.fn())
    expect(read(p.clearTrigger.disabled, init())).toBe(true)
    const withInput: DateInputState = { ...init(), input: '2024-01-01' }
    expect(read(p.clearTrigger.disabled, withInput)).toBe(false)
  })

  it('errorText hidden when no error', () => {
    const p = connect(rootSignal(), vi.fn())
    expect(read(p.errorText.hidden, init())).toBe(true)
    const bad: DateInputState = { ...init(), error: 'invalid' }
    expect(read(p.errorText.hidden, bad)).toBe(false)
  })

  it('input onInput dispatches setInput', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send)
    const el = document.createElement('input')
    el.value = '2024-01-01'
    p.input.onInput({ target: el } as unknown as Event)
    expect(send).toHaveBeenCalledWith({ type: 'setInput', value: '2024-01-01' })
  })

  it('placeholder flows from options', () => {
    const p = connect(rootSignal(), vi.fn(), { placeholder: 'YYYY-MM-DD' })
    expect(p.input.placeholder).toBe('YYYY-MM-DD')
  })
})
