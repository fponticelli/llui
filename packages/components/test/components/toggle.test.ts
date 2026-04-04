import { describe, it, expect, vi } from 'vitest'
import { init, update, connect } from '../../src/components/toggle'

describe('toggle reducer', () => {
  it('initializes with defaults', () => {
    expect(init()).toEqual({ pressed: false, disabled: false })
  })

  it('initializes from options', () => {
    expect(init({ pressed: true, disabled: true })).toEqual({ pressed: true, disabled: true })
  })

  it('toggle flips pressed', () => {
    const [s1] = update({ pressed: false, disabled: false }, { type: 'toggle' })
    expect(s1.pressed).toBe(true)
    const [s2] = update(s1, { type: 'toggle' })
    expect(s2.pressed).toBe(false)
  })

  it('toggle is a no-op when disabled', () => {
    const [s] = update({ pressed: false, disabled: true }, { type: 'toggle' })
    expect(s.pressed).toBe(false)
  })

  it('setPressed works even when disabled', () => {
    const [s] = update({ pressed: false, disabled: true }, { type: 'setPressed', pressed: true })
    expect(s.pressed).toBe(true)
  })

  it('setDisabled changes disabled', () => {
    const [s] = update({ pressed: false, disabled: false }, { type: 'setDisabled', disabled: true })
    expect(s.disabled).toBe(true)
  })
})

describe('toggle.connect', () => {
  it('root aria-pressed reflects state', () => {
    const send = vi.fn()
    const p = connect<ToggleCtx>((s) => s.toggle, send)
    expect(p.root['aria-pressed']({ toggle: { pressed: true, disabled: false } })).toBe(true)
    expect(p.root['aria-pressed']({ toggle: { pressed: false, disabled: false } })).toBe(false)
  })

  it('root data-state is on/off', () => {
    const send = vi.fn()
    const p = connect<ToggleCtx>((s) => s.toggle, send)
    expect(p.root['data-state']({ toggle: { pressed: true, disabled: false } })).toBe('on')
    expect(p.root['data-state']({ toggle: { pressed: false, disabled: false } })).toBe('off')
  })

  it('root onClick dispatches toggle', () => {
    const send = vi.fn()
    const p = connect<ToggleCtx>((s) => s.toggle, send)
    p.root.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'toggle' })
  })

  it('keyDown Space+Enter toggles and prevents default', () => {
    const send = vi.fn()
    const p = connect<ToggleCtx>((s) => s.toggle, send)
    const space = new KeyboardEvent('keydown', { key: ' ', cancelable: true })
    p.root.onKeyDown(space)
    expect(space.defaultPrevented).toBe(true)
    expect(send).toHaveBeenCalledWith({ type: 'toggle' })

    const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true })
    p.root.onKeyDown(enter)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('other keys are ignored', () => {
    const send = vi.fn()
    const p = connect<ToggleCtx>((s) => s.toggle, send)
    p.root.onKeyDown(new KeyboardEvent('keydown', { key: 'a' }))
    expect(send).not.toHaveBeenCalled()
  })

  it('disabled state exposes aria-disabled=true', () => {
    const send = vi.fn()
    const p = connect<ToggleCtx>((s) => s.toggle, send)
    expect(p.root['aria-disabled']({ toggle: { pressed: false, disabled: true } })).toBe('true')
    expect(p.root['aria-disabled']({ toggle: { pressed: false, disabled: false } })).toBeUndefined()
  })
})

type ToggleCtx = { toggle: { pressed: boolean; disabled: boolean } }
