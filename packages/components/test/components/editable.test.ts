import { describe, it, expect, vi } from 'vitest'
import { init, update, connect } from '../../src/components/editable'
import type { EditableState, EditableMsg } from '../../src/components/editable'
import { pathHandle } from '@llui/dom'
import { rootSignal, read } from '../_signal'

describe('editable reducer', () => {
  it('initializes with value as draft', () => {
    const s = init({ value: 'hello' })
    expect(s.value).toBe('hello')
    expect(s.draft).toBe('hello')
    expect(s.editing).toBe(false)
  })

  it('edit starts editing with draft = value', () => {
    const [s] = update(init({ value: 'x' }), { type: 'edit' })
    expect(s.editing).toBe(true)
    expect(s.draft).toBe('x')
  })

  it('setDraft updates draft only', () => {
    const s0 = { ...init({ value: 'a' }), editing: true, draft: 'a' }
    const [s] = update(s0, { type: 'setDraft', draft: 'b' })
    expect(s.draft).toBe('b')
    expect(s.value).toBe('a')
  })

  it('submit commits draft to value', () => {
    const s0 = { ...init({ value: 'a' }), editing: true, draft: 'b' }
    const [s] = update(s0, { type: 'submit' })
    expect(s.value).toBe('b')
    expect(s.editing).toBe(false)
  })

  it('cancel reverts draft and exits edit', () => {
    const s0 = { ...init({ value: 'a' }), editing: true, draft: 'xyz' }
    const [s] = update(s0, { type: 'cancel' })
    expect(s.value).toBe('a')
    expect(s.draft).toBe('a')
    expect(s.editing).toBe(false)
  })

  it('setValue syncs both value and draft', () => {
    const [s] = update(init({ value: 'a' }), { type: 'setValue', value: 'b' })
    expect(s.value).toBe('b')
    expect(s.draft).toBe('b')
  })

  it('disabled blocks edit', () => {
    const [s] = update(init({ value: 'x', disabled: true }), { type: 'edit' })
    expect(s.editing).toBe(false)
  })
})

describe('editable.connect', () => {
  const p = connect(rootSignal(), vi.fn())

  it('preview hidden while editing', () => {
    expect(read(p.preview.hidden, { ...init({ value: 'x' }), editing: true })).toBe(true)
    expect(read(p.preview.hidden, { ...init({ value: 'x' }), editing: false })).toBe(false)
  })

  it('input hidden until editing', () => {
    expect(read(p.input.hidden, { ...init({ value: 'x' }), editing: false })).toBe(true)
    expect(read(p.input.hidden, { ...init({ value: 'x' }), editing: true })).toBe(false)
  })

  it('preview click sends edit', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send)
    pc.preview.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'edit' })
  })

  it('Enter on input sends submit', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send)
    pc.input.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))
    expect(send).toHaveBeenCalledWith({ type: 'submit' })
  })

  it('Escape on input sends cancel', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send)
    pc.input.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
    expect(send).toHaveBeenCalledWith({ type: 'cancel' })
  })

  it('blur submits by default', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send)
    pc.input.onBlur(new FocusEvent('blur'))
    expect(send).toHaveBeenCalledWith({ type: 'submit' })
  })

  it('blur cancels when submitOnBlur=false', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send, { submitOnBlur: false })
    pc.input.onBlur(new FocusEvent('blur'))
    expect(send).toHaveBeenCalledWith({ type: 'cancel' })
  })

  it('validate blocks submit when returning errors', () => {
    const h = harness(init({ editing: true }), {
      validate: (v) => (v.length < 3 ? ['too short'] : null),
    })
    // Simulate typing a short draft
    const input = document.createElement('input')
    input.value = 'ab'
    const inputEvent = new Event('input')
    Object.defineProperty(inputEvent, 'target', { value: input })
    h.parts.input.onInput(inputEvent)
    // Try to submit via Enter
    h.parts.input.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))
    expect(h.sent).not.toContainEqual({ type: 'submit' })
    // Now type a valid draft
    input.value = 'abc'
    const inputEvent2 = new Event('input')
    Object.defineProperty(inputEvent2, 'target', { value: input })
    h.parts.input.onInput(inputEvent2)
    h.parts.input.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))
    expect(h.sent).toContainEqual({ type: 'submit' })
    expect(h.state.value).toBe('abc')
  })
})

/**
 * A live signal over a real reducer: `connect` must read the draft from STATE.
 * It used to mirror it in a closure fed only by `onInput`, so a draft that
 * arrived by any other path (agent `send`, host `setValue`) was validated as
 * `''` instead of its real text — the guard silently did not run (#120).
 */
function harness(initial: EditableState, opts?: Parameters<typeof connect>[2]) {
  let state = initial
  const sent: EditableMsg[] = []
  const send = (m: EditableMsg): void => {
    sent.push(m)
    ;[state] = update(state, m)
  }
  const parts = connect(
    pathHandle<EditableState>(() => state, ''),
    send,
    opts,
  )
  return {
    parts,
    sent,
    send,
    get state() {
      return state
    },
  }
}

describe('editable reads the draft from state', () => {
  it('validates the draft that reached state without onInput', () => {
    const validate = vi.fn((v: string) => (v === 'nope' ? ['banned'] : null))
    const h = harness(init({ editing: true }), { validate })
    h.send({ type: 'setDraft', draft: 'nope' })
    h.parts.input.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))
    expect(validate).toHaveBeenCalledWith('nope')
    expect(h.sent).not.toContainEqual({ type: 'submit' })
    expect(h.state.value).toBe('')
  })

  it('blur commit validates the state draft too', () => {
    const validate = vi.fn(() => ['banned'])
    const h = harness(init({ editing: true }), { validate })
    h.send({ type: 'setDraft', draft: 'x' })
    h.parts.input.onBlur(new FocusEvent('blur'))
    expect(validate).toHaveBeenCalledWith('x')
    expect(h.state.editing).toBe(true)
  })
})
