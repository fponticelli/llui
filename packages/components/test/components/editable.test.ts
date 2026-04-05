import { describe, it, expect, vi } from 'vitest'
import { init, update, connect } from '../../src/components/editable'
import type { EditableState } from '../../src/components/editable'

type Ctx = { e: EditableState }
const wrap = (e: EditableState): Ctx => ({ e })

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
  const p = connect<Ctx>((s) => s.e, vi.fn())

  it('preview hidden while editing', () => {
    expect(p.preview.hidden(wrap({ ...init({ value: 'x' }), editing: true }))).toBe(true)
    expect(p.preview.hidden(wrap({ ...init({ value: 'x' }), editing: false }))).toBe(false)
  })

  it('input hidden until editing', () => {
    expect(p.input.hidden(wrap({ ...init({ value: 'x' }), editing: false }))).toBe(true)
    expect(p.input.hidden(wrap({ ...init({ value: 'x' }), editing: true }))).toBe(false)
  })

  it('preview click sends edit', () => {
    const send = vi.fn()
    const pc = connect<Ctx>((s) => s.e, send)
    pc.preview.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'edit' })
  })

  it('Enter on input sends submit', () => {
    const send = vi.fn()
    const pc = connect<Ctx>((s) => s.e, send)
    pc.input.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))
    expect(send).toHaveBeenCalledWith({ type: 'submit' })
  })

  it('Escape on input sends cancel', () => {
    const send = vi.fn()
    const pc = connect<Ctx>((s) => s.e, send)
    pc.input.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
    expect(send).toHaveBeenCalledWith({ type: 'cancel' })
  })

  it('blur submits by default', () => {
    const send = vi.fn()
    const pc = connect<Ctx>((s) => s.e, send)
    pc.input.onBlur(new FocusEvent('blur'))
    expect(send).toHaveBeenCalledWith({ type: 'submit' })
  })

  it('blur cancels when submitOnBlur=false', () => {
    const send = vi.fn()
    const pc = connect<Ctx>((s) => s.e, send, { submitOnBlur: false })
    pc.input.onBlur(new FocusEvent('blur'))
    expect(send).toHaveBeenCalledWith({ type: 'cancel' })
  })
})
