import { describe, it, expect, vi } from 'vitest'
import { init, update, connect } from '../../src/components/checkbox'

type Ctx = { cb: ReturnType<typeof init> }
const wrap = (cb: ReturnType<typeof init>): Ctx => ({ cb })

describe('checkbox reducer', () => {
  it('initializes unchecked by default', () => {
    expect(init()).toEqual({ checked: false, disabled: false, required: false })
  })

  it('initializes indeterminate', () => {
    expect(init({ checked: 'indeterminate' }).checked).toBe('indeterminate')
  })

  it('toggle flips boolean', () => {
    const [a] = update(init(), { type: 'toggle' })
    expect(a.checked).toBe(true)
    const [b] = update(a, { type: 'toggle' })
    expect(b.checked).toBe(false)
  })

  it('toggle from indeterminate → true', () => {
    const [s] = update(init({ checked: 'indeterminate' }), { type: 'toggle' })
    expect(s.checked).toBe(true)
  })

  it('toggle ignored when disabled', () => {
    const [s] = update(init({ disabled: true }), { type: 'toggle' })
    expect(s.checked).toBe(false)
  })

  it('setChecked sets explicit value including indeterminate', () => {
    const [a] = update(init(), { type: 'setChecked', checked: 'indeterminate' })
    expect(a.checked).toBe('indeterminate')
    const [b] = update(a, { type: 'setChecked', checked: true })
    expect(b.checked).toBe(true)
  })
})

describe('checkbox.connect', () => {
  it('aria-checked maps checked state', () => {
    const p = connect<Ctx>((s) => s.cb, vi.fn())
    expect(p.root['aria-checked'](wrap(init({ checked: true })))).toBe('true')
    expect(p.root['aria-checked'](wrap(init({ checked: false })))).toBe('false')
    expect(p.root['aria-checked'](wrap(init({ checked: 'indeterminate' })))).toBe('mixed')
  })

  it('data-state maps checked state', () => {
    const p = connect<Ctx>((s) => s.cb, vi.fn())
    expect(p.root['data-state'](wrap(init({ checked: true })))).toBe('checked')
    expect(p.root['data-state'](wrap(init({ checked: false })))).toBe('unchecked')
    expect(p.root['data-state'](wrap(init({ checked: 'indeterminate' })))).toBe('indeterminate')
  })

  it('root onClick dispatches toggle', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.cb, send)
    p.root.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'toggle' })
  })

  it('space toggles, enter does not', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.cb, send)
    const space = new KeyboardEvent('keydown', { key: ' ', cancelable: true })
    p.root.onKeyDown(space)
    expect(space.defaultPrevented).toBe(true)
    expect(send).toHaveBeenCalledWith({ type: 'toggle' })
    const enter = new KeyboardEvent('keydown', { key: 'Enter' })
    p.root.onKeyDown(enter)
    expect(send).toHaveBeenCalledTimes(1) // enter does not toggle
  })

  it('tabIndex=-1 when disabled', () => {
    const p = connect<Ctx>((s) => s.cb, vi.fn())
    expect(p.root.tabIndex(wrap(init({ disabled: true })))).toBe(-1)
    expect(p.root.tabIndex(wrap(init({ disabled: false })))).toBe(0)
  })

  it('hiddenInput.checked is strictly true-only', () => {
    const p = connect<Ctx>((s) => s.cb, vi.fn())
    expect(p.hiddenInput.checked(wrap(init({ checked: true })))).toBe(true)
    expect(p.hiddenInput.checked(wrap(init({ checked: 'indeterminate' })))).toBe(false)
    expect(p.hiddenInput.checked(wrap(init({ checked: false })))).toBe(false)
  })

  it('hiddenInput.indeterminate reflects indeterminate', () => {
    const p = connect<Ctx>((s) => s.cb, vi.fn())
    expect(p.hiddenInput.indeterminate(wrap(init({ checked: 'indeterminate' })))).toBe(true)
    expect(p.hiddenInput.indeterminate(wrap(init({ checked: true })))).toBe(false)
  })
})
