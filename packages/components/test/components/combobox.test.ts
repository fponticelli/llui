import { describe, it, expect, vi } from 'vitest'
import { init, update, connect } from '../../src/components/combobox'
import type { ComboboxState } from '../../src/components/combobox'

type Ctx = { cb: ComboboxState }
const wrap = (cb: ComboboxState): Ctx => ({ cb })

describe('combobox reducer', () => {
  it('initializes with all items as filtered', () => {
    const s = init({ items: ['apple', 'banana', 'cherry'] })
    expect(s.filteredItems).toEqual(['apple', 'banana', 'cherry'])
  })

  it('setInputValue filters items by substring', () => {
    const s0 = init({ items: ['apple', 'apricot', 'banana'] })
    const [s] = update(s0, { type: 'setInputValue', value: 'ap' })
    expect(s.filteredItems).toEqual(['apple', 'apricot'])
    expect(s.open).toBe(true)
  })

  it('setInputValue is case-insensitive', () => {
    const s0 = init({ items: ['Apple', 'Banana'] })
    const [s] = update(s0, { type: 'setInputValue', value: 'apple' })
    expect(s.filteredItems).toEqual(['Apple'])
  })

  it('selecting single value sets input to selection', () => {
    const s0 = init({ items: ['apple', 'banana'], selectionMode: 'single' })
    const [s] = update(s0, { type: 'selectOption', value: 'banana' })
    expect(s.value).toEqual(['banana'])
    expect(s.inputValue).toBe('banana')
    expect(s.open).toBe(false)
  })

  it('selecting multiple clears input', () => {
    const s0 = { ...init({ items: ['a', 'b'], selectionMode: 'multiple' }), open: true }
    const [s] = update(s0, { type: 'selectOption', value: 'a' })
    expect(s.value).toEqual(['a'])
    expect(s.inputValue).toBe('')
    expect(s.open).toBe(true)
  })

  it('highlightNext navigates filtered list', () => {
    const s0 = {
      ...init({ items: ['apple', 'apricot', 'banana'] }),
      highlightedIndex: 0,
      filteredItems: ['apple', 'apricot'],
    }
    const [s] = update(s0, { type: 'highlightNext' })
    expect(s.highlightedIndex).toBe(1)
  })

  it('selectHighlighted uses filteredItems[highlightedIndex]', () => {
    const s0 = {
      ...init({ items: ['apple', 'apricot', 'banana'] }),
      highlightedIndex: 0,
      inputValue: 'ap',
      filteredItems: ['apple', 'apricot'],
      open: true,
    }
    const [s] = update(s0, { type: 'selectHighlighted' })
    expect(s.value).toEqual(['apple'])
    expect(s.open).toBe(false)
  })

  it('clear resets input + value', () => {
    const s0 = init({ items: ['a', 'b'], value: ['a'], inputValue: 'a' })
    const [s] = update(s0, { type: 'clear' })
    expect(s.value).toEqual([])
    expect(s.inputValue).toBe('')
  })
})

describe('combobox.connect', () => {
  const p = connect<Ctx>((s) => s.cb, vi.fn(), { id: 'cb1' })

  it('input has aria-autocomplete=list', () => {
    expect(p.input['aria-autocomplete']).toBe('list')
  })

  it('input role=combobox', () => {
    expect(p.input.role).toBe('combobox')
  })

  it('onInput sends setInputValue', () => {
    const send = vi.fn()
    const pc = connect<Ctx>((s) => s.cb, send, { id: 'x' })
    const target = document.createElement('input')
    target.value = 'hello'
    const ev = new Event('input')
    Object.defineProperty(ev, 'target', { value: target })
    pc.input.onInput(ev)
    expect(send).toHaveBeenCalledWith({ type: 'setInputValue', value: 'hello' })
  })

  it('Escape on input closes', () => {
    const send = vi.fn()
    const pc = connect<Ctx>((s) => s.cb, send, { id: 'x' })
    pc.input.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
    expect(send).toHaveBeenCalledWith({ type: 'close' })
  })

  it('input value tracks inputValue', () => {
    expect(p.input.value(wrap(init({ inputValue: 'xyz' })))).toBe('xyz')
  })

  it('trigger click opens', () => {
    const send = vi.fn()
    const pc = connect<Ctx>((s) => s.cb, send, { id: 'x' })
    pc.trigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'open' })
  })
})
