import { describe, it, expect, vi } from 'vitest'
import { init, update, connect } from '../../src/components/checkbox'
import { rootSignal, read } from '../_signal'

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
    const p = connect(rootSignal(), vi.fn())
    expect(read(p.root['aria-checked'], init({ checked: true }))).toBe('true')
    expect(read(p.root['aria-checked'], init({ checked: false }))).toBe('false')
    expect(read(p.root['aria-checked'], init({ checked: 'indeterminate' }))).toBe('mixed')
  })

  it('data-state maps checked state', () => {
    const p = connect(rootSignal(), vi.fn())
    expect(read(p.root['data-state'], init({ checked: true }))).toBe('checked')
    expect(read(p.root['data-state'], init({ checked: false }))).toBe('unchecked')
    expect(read(p.root['data-state'], init({ checked: 'indeterminate' }))).toBe('indeterminate')
  })

  it('root onClick dispatches toggle', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send)
    p.root.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'toggle' })
  })

  it('space toggles, enter does not', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send)
    const space = new KeyboardEvent('keydown', { key: ' ', cancelable: true })
    p.root.onKeyDown(space)
    expect(space.defaultPrevented).toBe(true)
    expect(send).toHaveBeenCalledWith({ type: 'toggle' })
    const enter = new KeyboardEvent('keydown', { key: 'Enter' })
    p.root.onKeyDown(enter)
    expect(send).toHaveBeenCalledTimes(1) // enter does not toggle
  })

  it('tabindex=-1 when disabled', () => {
    const p = connect(rootSignal(), vi.fn())
    expect(read(p.root.tabindex, init({ disabled: true }))).toBe(-1)
    expect(read(p.root.tabindex, init({ disabled: false }))).toBe(0)
  })

  it('hiddenInput.checked is strictly true-only', () => {
    const p = connect(rootSignal(), vi.fn())
    expect(read(p.hiddenInput.checked, init({ checked: true }))).toBe(true)
    expect(read(p.hiddenInput.checked, init({ checked: 'indeterminate' }))).toBe(false)
    expect(read(p.hiddenInput.checked, init({ checked: false }))).toBe(false)
  })

  it('hiddenInput.indeterminate reflects indeterminate', () => {
    const p = connect(rootSignal(), vi.fn())
    expect(read(p.hiddenInput.indeterminate, init({ checked: 'indeterminate' }))).toBe(true)
    expect(read(p.hiddenInput.indeterminate, init({ checked: true }))).toBe(false)
  })
})
