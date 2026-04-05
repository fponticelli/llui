import { describe, it, expect, vi } from 'vitest'
import {
  init,
  update,
  connect,
  parseDate,
  formatDate,
} from '../../src/components/date-input'
import type { DateInputState } from '../../src/components/date-input'

type Ctx = { d: DateInputState }
const wrap = (d: DateInputState): Ctx => ({ d })

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
    const s = init({ value: new Date(2024, 2, 15) })
    expect(s.input).toBe('2024-03-15')
    expect(s.value?.getMonth()).toBe(2)
  })

  it('setInput parses a valid date', () => {
    const [s] = update(init(), { type: 'setInput', value: '2024-03-15' })
    expect(s.value?.getMonth()).toBe(2)
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
    const s0 = init({ min: new Date(2024, 0, 1) })
    const [s] = update(s0, { type: 'setInput', value: '2023-12-31' })
    expect(s.error).toBe('before-min')
  })

  it('after-max error', () => {
    const s0 = init({ max: new Date(2024, 0, 31) })
    const [s] = update(s0, { type: 'setInput', value: '2024-02-15' })
    expect(s.error).toBe('after-max')
  })

  it('clear wipes input + value + error', () => {
    let s: DateInputState = init({ value: new Date(2024, 0, 1) })
    ;[s] = update(s, { type: 'clear' })
    expect(s).toMatchObject({ input: '', value: null, error: null })
  })

  it('disabled blocks setInput', () => {
    const s0 = init({ disabled: true })
    const [s] = update(s0, { type: 'setInput', value: '2024-01-01' })
    expect(s.input).toBe('')
  })

  it('setValue formats into input + validates', () => {
    const s0 = init({ max: new Date(2024, 0, 1) })
    const [s] = update(s0, { type: 'setValue', value: new Date(2025, 0, 1) })
    expect(s.input).toBe('2025-01-01')
    expect(s.error).toBe('after-max')
  })

  it('setMin re-validates existing value', () => {
    const s0 = init({ value: new Date(2023, 0, 1) })
    const [s] = update(s0, { type: 'setMin', min: new Date(2024, 0, 1) })
    expect(s.error).toBe('before-min')
  })
})

describe('date-input.connect', () => {
  it('aria-invalid reflects error', () => {
    const p = connect<Ctx>((s) => s.d, vi.fn())
    const bad: DateInputState = { ...init(), error: 'invalid' }
    expect(p.input['aria-invalid'](wrap(bad))).toBe('true')
    expect(p.input['aria-invalid'](wrap(init()))).toBeUndefined()
  })

  it('clearTrigger disabled when empty', () => {
    const p = connect<Ctx>((s) => s.d, vi.fn())
    expect(p.clearTrigger.disabled(wrap(init()))).toBe(true)
    const withInput: DateInputState = { ...init(), input: '2024-01-01' }
    expect(p.clearTrigger.disabled(wrap(withInput))).toBe(false)
  })

  it('errorText hidden when no error', () => {
    const p = connect<Ctx>((s) => s.d, vi.fn())
    expect(p.errorText.hidden(wrap(init()))).toBe(true)
    const bad: DateInputState = { ...init(), error: 'invalid' }
    expect(p.errorText.hidden(wrap(bad))).toBe(false)
  })

  it('input onInput dispatches setInput', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.d, send)
    const el = document.createElement('input')
    el.value = '2024-01-01'
    p.input.onInput({ target: el } as unknown as Event)
    expect(send).toHaveBeenCalledWith({ type: 'setInput', value: '2024-01-01' })
  })

  it('placeholder flows from options', () => {
    const p = connect<Ctx>((s) => s.d, vi.fn(), { placeholder: 'YYYY-MM-DD' })
    expect(p.input.placeholder).toBe('YYYY-MM-DD')
  })
})
