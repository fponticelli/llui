import { describe, it, expect, vi } from 'vitest'
import { init, update, connect } from '../../src/components/switch'
import { rootSignal, read } from '../_signal'

describe('switch reducer', () => {
  it('initializes unchecked', () => {
    expect(init()).toEqual({ checked: false, disabled: false })
  })

  it('toggle flips checked', () => {
    const [s] = update(init(), { type: 'toggle' })
    expect(s.checked).toBe(true)
    const [s2] = update(s, { type: 'toggle' })
    expect(s2.checked).toBe(false)
  })

  it('toggle respects disabled', () => {
    const [s] = update(init({ disabled: true }), { type: 'toggle' })
    expect(s.checked).toBe(false)
  })

  it('setChecked forces value', () => {
    const [s] = update(init({ disabled: true }), { type: 'setChecked', checked: true })
    expect(s.checked).toBe(true)
  })
})

describe('switch.connect', () => {
  it('root has role=switch, aria-checked, data-state', () => {
    const p = connect(rootSignal(), vi.fn())
    expect(p.root.role).toBe('switch')
    expect(read(p.root['aria-checked'], { checked: true, disabled: false })).toBe(true)
    expect(read(p.root['data-state'], { checked: false, disabled: false })).toBe('unchecked')
    expect(read(p.root['data-state'], { checked: true, disabled: false })).toBe('checked')
  })

  it('root click toggles', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send)
    p.root.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'toggle' })
  })

  it('Space and Enter toggle', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send)
    p.root.onKeyDown(new KeyboardEvent('keydown', { key: ' ', cancelable: true }))
    p.root.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('tabIndex=-1 when disabled', () => {
    const p = connect(rootSignal(), vi.fn())
    expect(read(p.root.tabIndex, { checked: false, disabled: true })).toBe(-1)
    expect(read(p.root.tabIndex, { checked: false, disabled: false })).toBe(0)
  })

  it('hidden input mirrors checked and disabled', () => {
    const p = connect(rootSignal(), vi.fn())
    expect(read(p.hiddenInput.checked, { checked: true, disabled: false })).toBe(true)
    expect(read(p.hiddenInput.disabled, { checked: false, disabled: true })).toBe(true)
  })
})
