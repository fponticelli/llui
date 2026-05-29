import { describe, it, expect, vi } from 'vitest'
import { init, update, connect } from '../../src/components/listbox'
import { rootSignal, read } from '../_signal'

describe('listbox reducer', () => {
  it('initializes with empty value', () => {
    expect(init({ items: ['a', 'b'] })).toMatchObject({ value: [], selectionMode: 'single' })
  })

  it('single select replaces value', () => {
    const s0 = init({ items: ['a', 'b'], value: ['a'] })
    const [s] = update(s0, { type: 'select', value: 'b' })
    expect(s.value).toEqual(['b'])
  })

  it('multiple select toggles value', () => {
    const s0 = init({ items: ['a', 'b'], selectionMode: 'multiple' })
    const [s1] = update(s0, { type: 'select', value: 'a' })
    expect(s1.value).toEqual(['a'])
    const [s2] = update(s1, { type: 'select', value: 'b' })
    expect(s2.value).toEqual(['a', 'b'])
    const [s3] = update(s2, { type: 'select', value: 'a' })
    expect(s3.value).toEqual(['b'])
  })

  it('highlightNext wraps', () => {
    const s0 = { ...init({ items: ['a', 'b', 'c'] }), highlightedIndex: 2 }
    const [s] = update(s0, { type: 'highlightNext' })
    expect(s.highlightedIndex).toBe(0)
  })

  it('highlightNext skips disabled', () => {
    const s0 = { ...init({ items: ['a', 'b', 'c'], disabledItems: ['b'] }), highlightedIndex: 0 }
    const [s] = update(s0, { type: 'highlightNext' })
    expect(s.highlightedIndex).toBe(2)
  })

  it('selectHighlighted uses index→value', () => {
    const s0 = { ...init({ items: ['a', 'b', 'c'] }), highlightedIndex: 1 }
    const [s] = update(s0, { type: 'selectHighlighted' })
    expect(s.value).toEqual(['b'])
  })

  it('clear empties value', () => {
    const s0 = init({ items: ['a'], value: ['a'] })
    const [s] = update(s0, { type: 'clear' })
    expect(s.value).toEqual([])
  })

  it('setItems preserves valid values, drops invalid', () => {
    const s0 = init({ items: ['a', 'b'], value: ['a'] })
    const [s] = update(s0, { type: 'setItems', items: ['b', 'c'] })
    expect(s.value).toEqual([])
  })

  it('typeahead highlights by prefix', () => {
    const s0 = init({ items: ['apple', 'banana', 'apricot'] })
    const [s] = update(s0, { type: 'typeahead', char: 'b', now: 1000 })
    expect(s.highlightedIndex).toBe(1)
  })
})

describe('listbox.connect', () => {
  const p = connect(rootSignal(), vi.fn(), { id: 'lb1' })

  it('root role=listbox', () => {
    expect(p.root.role).toBe('listbox')
  })

  it('aria-multiselectable=true for multiple mode', () => {
    expect(read(p.root['aria-multiselectable'], init({ selectionMode: 'multiple' }))).toBe('true')
    expect(read(p.root['aria-multiselectable'], init({ selectionMode: 'single' }))).toBeUndefined()
  })

  it('item aria-selected reflects value', () => {
    const item = p.item('a', 0).root
    expect(read(item['aria-selected'], init({ items: ['a'], value: ['a'] }))).toBe(true)
    expect(read(item['aria-selected'], init({ items: ['a'], value: [] }))).toBe(false)
  })

  it('ArrowDown sends highlightNext', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send, { id: 'x' })
    pc.root.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }))
    expect(send).toHaveBeenCalledWith({ type: 'highlightNext' })
  })

  it('root aria-owns lists all item IDs', () => {
    const pc = connect(rootSignal(), vi.fn(), { id: 'lb' })
    // Empty items → undefined
    expect(read(pc.root['aria-owns'], init())).toBeUndefined()
    // With items → space-separated ids using index
    const s = init({ items: ['apple', 'banana', 'cherry'] })
    expect(read(pc.root['aria-owns'], s)).toBe('lb:item:0 lb:item:1 lb:item:2')
  })

  it('typeahead fires for single char', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send, { id: 'x' })
    pc.root.onKeyDown(new KeyboardEvent('keydown', { key: 'a' }))
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'typeahead', char: 'a' }))
  })
})
