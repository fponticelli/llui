import { describe, it, expect, vi } from 'vitest'
import { init, update, connect } from '../../src/components/password-input'
import type { PasswordInputState } from '../../src/components/password-input'

type Ctx = { p: PasswordInputState }
const wrap = (p: PasswordInputState): Ctx => ({ p })

describe('password-input reducer', () => {
  it('initializes hidden', () => {
    expect(init()).toEqual({ value: '', visible: false, disabled: false })
  })

  it('setValue updates value', () => {
    const [s] = update(init(), { type: 'setValue', value: 'hunter2' })
    expect(s.value).toBe('hunter2')
  })

  it('toggleVisibility flips flag', () => {
    const [s] = update(init(), { type: 'toggleVisibility' })
    expect(s.visible).toBe(true)
    const [s2] = update(s, { type: 'toggleVisibility' })
    expect(s2.visible).toBe(false)
  })

  it('disabled blocks toggle but allows setValue', () => {
    const [s] = update(init({ disabled: true }), { type: 'toggleVisibility' })
    expect(s.visible).toBe(false)
    const [s2] = update(init({ disabled: true }), { type: 'setValue', value: 'x' })
    expect(s2.value).toBe('x')
  })
})

describe('password-input.connect', () => {
  it('input type switches based on visible', () => {
    const p = connect<Ctx>((s) => s.p, vi.fn())
    expect(p.input.type(wrap(init({ visible: false })))).toBe('password')
    expect(p.input.type(wrap(init({ visible: true })))).toBe('text')
  })

  it('visibilityTrigger aria-pressed tracks state', () => {
    const p = connect<Ctx>((s) => s.p, vi.fn())
    expect(p.visibilityTrigger['aria-pressed'](wrap(init({ visible: true })))).toBe(true)
  })

  it('visibilityTrigger label adapts', () => {
    const p = connect<Ctx>((s) => s.p, vi.fn())
    expect(p.visibilityTrigger['aria-label'](wrap(init({ visible: false })))).toBe('Show password')
    expect(p.visibilityTrigger['aria-label'](wrap(init({ visible: true })))).toBe('Hide password')
  })

  it('visibilityTrigger click sends toggle', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.p, send)
    p.visibilityTrigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'toggleVisibility' })
  })
})
