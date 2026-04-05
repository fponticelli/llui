import { describe, it, expect, vi } from 'vitest'
import { init, update, connect } from '../../src/components/select'
import type { SelectState } from '../../src/components/select'

type Ctx = { sel: SelectState }
const wrap = (sel: SelectState): Ctx => ({ sel })

describe('select reducer', () => {
  it('initializes closed', () => {
    const s = init({ items: ['a', 'b'] })
    expect(s.open).toBe(false)
    expect(s.value).toEqual([])
  })

  it('open highlights first item when empty', () => {
    const s0 = init({ items: ['a', 'b', 'c'] })
    const [s] = update(s0, { type: 'open' })
    expect(s.open).toBe(true)
    expect(s.highlightedIndex).toBe(0)
  })

  it('open highlights selected value', () => {
    const s0 = init({ items: ['a', 'b', 'c'], value: ['b'] })
    const [s] = update(s0, { type: 'open' })
    expect(s.highlightedIndex).toBe(1)
  })

  it('single select closes on selection', () => {
    const s0 = { ...init({ items: ['a', 'b'], selectionMode: 'single' }), open: true }
    const [s] = update(s0, { type: 'selectOption', value: 'a' })
    expect(s.open).toBe(false)
    expect(s.value).toEqual(['a'])
  })

  it('multiple select stays open', () => {
    const s0 = { ...init({ items: ['a', 'b'], selectionMode: 'multiple' }), open: true }
    const [s] = update(s0, { type: 'selectOption', value: 'a' })
    expect(s.open).toBe(true)
    expect(s.value).toEqual(['a'])
  })

  it('multiple select toggles existing', () => {
    const s0 = {
      ...init({ items: ['a', 'b'], selectionMode: 'multiple', value: ['a'] }),
      open: true,
    }
    const [s] = update(s0, { type: 'selectOption', value: 'a' })
    expect(s.value).toEqual([])
  })
})

describe('select.connect', () => {
  const p = connect<Ctx>((s) => s.sel, vi.fn(), { id: 'sel1', placeholder: 'Choose…' })

  it('trigger role=combobox', () => {
    expect(p.trigger.role).toBe('combobox')
  })

  it('aria-activedescendant points to highlighted item id', () => {
    expect(
      p.trigger['aria-activedescendant'](
        wrap({ ...init({ items: ['a', 'b'] }), highlightedIndex: 1, open: true }),
      ),
    ).toBe('sel1:item:1')
    expect(p.trigger['aria-activedescendant'](wrap(init({ items: ['a'] })))).toBeUndefined()
  })

  it('trigger click toggles', () => {
    const send = vi.fn()
    const pc = connect<Ctx>((s) => s.sel, send, { id: 'x' })
    pc.trigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'toggle' })
  })

  it('ArrowDown on trigger opens', () => {
    const send = vi.fn()
    const pc = connect<Ctx>((s) => s.sel, send, { id: 'x' })
    pc.trigger.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }))
    expect(send).toHaveBeenCalledWith({ type: 'open' })
  })

  it('Enter in content selects highlighted', () => {
    const send = vi.fn()
    const pc = connect<Ctx>((s) => s.sel, send, { id: 'x' })
    pc.content.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))
    expect(send).toHaveBeenCalledWith({ type: 'selectHighlighted' })
  })

  it('valueText uses placeholder when empty', () => {
    expect(p.valueText(wrap(init({ items: ['a'] })))).toBe('Choose…')
  })

  it('valueText joins multiple with separator', () => {
    const pc = connect<Ctx>((s) => s.sel, vi.fn(), { id: 'x', separator: ' | ' })
    expect(
      pc.valueText(
        wrap({ ...init({ items: ['a', 'b'], selectionMode: 'multiple' }), value: ['a', 'b'] }),
      ),
    ).toBe('a | b')
  })
})
