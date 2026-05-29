import { describe, it, expect, vi } from 'vitest'
import { init, update, connect } from '../../src/components/password-input'
import { rootSignal, read } from '../_signal'

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
    const p = connect(rootSignal(), vi.fn())
    expect(read(p.input.type, init({ visible: false }))).toBe('password')
    expect(read(p.input.type, init({ visible: true }))).toBe('text')
  })

  it('visibilityTrigger aria-pressed tracks state', () => {
    const p = connect(rootSignal(), vi.fn())
    expect(read(p.visibilityTrigger['aria-pressed'], init({ visible: true }))).toBe(true)
  })

  it('visibilityTrigger label adapts', () => {
    const p = connect(rootSignal(), vi.fn())
    expect(read(p.visibilityTrigger['aria-label'], init({ visible: false }))).toBe('Show password')
    expect(read(p.visibilityTrigger['aria-label'], init({ visible: true }))).toBe('Hide password')
  })

  it('visibilityTrigger click sends toggle', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send)
    p.visibilityTrigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'toggleVisibility' })
  })
})
