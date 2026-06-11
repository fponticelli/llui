import { describe, it, expect, vi } from 'vitest'
import { init, update, connect } from '../../src/components/search-field'
import { rootSignal, read } from '../_signal'

describe('search-field reducer', () => {
  it('initializes empty and enabled', () => {
    expect(init()).toEqual({ value: '', disabled: false })
  })

  it('honors init options', () => {
    expect(init({ value: 'cats', disabled: true })).toEqual({ value: 'cats', disabled: true })
  })

  it('setValue updates value', () => {
    const [s] = update(init(), { type: 'setValue', value: 'dogs' })
    expect(s.value).toBe('dogs')
  })

  it('clear empties value', () => {
    const [s] = update(init({ value: 'dogs' }), { type: 'clear' })
    expect(s.value).toBe('')
  })

  it('submit leaves value unchanged and emits no effects', () => {
    const [s, fx] = update(init({ value: 'dogs' }), { type: 'submit', value: 'dogs' })
    expect(s.value).toBe('dogs')
    expect(fx).toEqual([])
  })

  it('disabled blocks setValue/clear', () => {
    const [s] = update(init({ value: 'x', disabled: true }), { type: 'setValue', value: 'y' })
    expect(s.value).toBe('x')
    const [s2] = update(init({ value: 'x', disabled: true }), { type: 'clear' })
    expect(s2.value).toBe('x')
  })
})

describe('search-field.connect', () => {
  it('root is a search landmark', () => {
    const p = connect(rootSignal(), vi.fn())
    expect(p.root.role).toBe('search')
  })

  it('input is type=search and reflects value', () => {
    const p = connect(rootSignal(), vi.fn())
    expect(p.input.type).toBe('search')
    expect(read(p.input.value, init({ value: 'hi' }))).toBe('hi')
  })

  it('input onInput sends setValue', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send)
    const target = document.createElement('input')
    target.value = 'query'
    p.input.onInput({ target } as unknown as Event)
    expect(send).toHaveBeenCalledWith({ type: 'setValue', value: 'query' })
  })

  it('input onKeyDown Enter sends submit with current value', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send)
    const target = document.createElement('input')
    target.value = 'query'
    const e = new KeyboardEvent('keydown', { key: 'Enter' })
    Object.defineProperty(e, 'currentTarget', { value: target })
    const prevent = vi.spyOn(e, 'preventDefault')
    p.input.onKeyDown(e)
    expect(send).toHaveBeenCalledWith({ type: 'submit', value: 'query' })
    expect(prevent).toHaveBeenCalled()
  })

  it('Escape clears and consumes the event WHEN non-empty', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send)
    const target = document.createElement('input')
    target.value = 'query'
    const e = new KeyboardEvent('keydown', { key: 'Escape' })
    Object.defineProperty(e, 'currentTarget', { value: target })
    const prevent = vi.spyOn(e, 'preventDefault')
    const stop = vi.spyOn(e, 'stopPropagation')
    p.input.onKeyDown(e)
    expect(send).toHaveBeenCalledWith({ type: 'clear' })
    expect(prevent).toHaveBeenCalled()
    expect(stop).toHaveBeenCalled()
  })

  it('Escape on an empty field does NOT clear and lets the event propagate', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send)
    const target = document.createElement('input')
    target.value = ''
    const e = new KeyboardEvent('keydown', { key: 'Escape' })
    Object.defineProperty(e, 'currentTarget', { value: target })
    const prevent = vi.spyOn(e, 'preventDefault')
    const stop = vi.spyOn(e, 'stopPropagation')
    p.input.onKeyDown(e)
    expect(send).not.toHaveBeenCalled()
    expect(prevent).not.toHaveBeenCalled()
    expect(stop).not.toHaveBeenCalled()
  })

  it('other keys are ignored', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send)
    const target = document.createElement('input')
    target.value = 'query'
    const e = new KeyboardEvent('keydown', { key: 'a' })
    Object.defineProperty(e, 'currentTarget', { value: target })
    p.input.onKeyDown(e)
    expect(send).not.toHaveBeenCalled()
  })

  it('clearTrigger is hidden when value is empty, shown otherwise', () => {
    const p = connect(rootSignal(), vi.fn())
    expect(read(p.clearTrigger.hidden, init({ value: '' }))).toBe(true)
    expect(read(p.clearTrigger.hidden, init({ value: 'x' }))).toBe(false)
  })

  it('clearTrigger has accessible label from opts and tabindex -1', () => {
    const p = connect(rootSignal(), vi.fn(), { clearLabel: 'Clear search' })
    expect(p.clearTrigger['aria-label']).toBe('Clear search')
    expect(p.clearTrigger.tabindex).toBe(-1)
  })

  it('clearTrigger click sends clear', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send)
    p.clearTrigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'clear' })
  })

  it('disabled flag is reflected on input and root', () => {
    const p = connect(rootSignal(), vi.fn())
    expect(read(p.input.disabled, init({ disabled: true }))).toBe(true)
    expect(read(p.root['data-disabled'], init({ disabled: true }))).toBe('')
    expect(read(p.root['data-disabled'], init({ disabled: false }))).toBe(undefined)
  })
})
