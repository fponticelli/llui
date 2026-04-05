import { describe, it, expect, vi } from 'vitest'
import { init, update, connect } from '../../src/components/switch'
import type { SwitchState } from '../../src/components/switch'

type Ctx = { sw: SwitchState }
const wrap = (s: SwitchState): Ctx => ({ sw: s })

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
    const p = connect<Ctx>((s) => s.sw, vi.fn())
    expect(p.root.role).toBe('switch')
    expect(p.root['aria-checked'](wrap({ checked: true, disabled: false }))).toBe(true)
    expect(p.root['data-state'](wrap({ checked: false, disabled: false }))).toBe('unchecked')
    expect(p.root['data-state'](wrap({ checked: true, disabled: false }))).toBe('checked')
  })

  it('root click toggles', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.sw, send)
    p.root.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'toggle' })
  })

  it('Space and Enter toggle', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.sw, send)
    p.root.onKeyDown(new KeyboardEvent('keydown', { key: ' ', cancelable: true }))
    p.root.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('tabIndex=-1 when disabled', () => {
    const p = connect<Ctx>((s) => s.sw, vi.fn())
    expect(p.root.tabIndex(wrap({ checked: false, disabled: true }))).toBe(-1)
    expect(p.root.tabIndex(wrap({ checked: false, disabled: false }))).toBe(0)
  })

  it('hidden input mirrors checked and disabled', () => {
    const p = connect<Ctx>((s) => s.sw, vi.fn())
    expect(p.hiddenInput.checked(wrap({ checked: true, disabled: false }))).toBe(true)
    expect(p.hiddenInput.disabled(wrap({ checked: false, disabled: true }))).toBe(true)
  })
})
