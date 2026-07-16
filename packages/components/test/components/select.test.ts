import { describe, it, expect, vi } from 'vitest'
import { init, update, connect } from '../../src/components/select'
import { rootSignal, signalOf, read } from '../_signal'

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
    expect(s.highlightedValue).toBe('a')
  })

  it('open highlights selected value', () => {
    const s0 = init({ items: ['a', 'b', 'c'], value: ['b'] })
    const [s] = update(s0, { type: 'open' })
    expect(s.highlightedValue).toBe('b')
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
  const p = connect(rootSignal(), vi.fn(), { id: 'sel1', placeholder: 'Choose…' })

  it('trigger role=combobox', () => {
    expect(p.trigger.role).toBe('combobox')
  })

  it('aria-activedescendant points to highlighted item id', () => {
    expect(
      read(p.trigger['aria-activedescendant'], {
        ...init({ items: ['a', 'b'] }),
        highlightedValue: 'b',
        open: true,
      }),
    ).toBe('sel1:item:b')
    expect(read(p.trigger['aria-activedescendant'], init({ items: ['a'] }))).toBeUndefined()
  })

  it('trigger click toggles', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send, { id: 'x' })
    pc.trigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'toggle' })
  })

  it('ArrowDown on trigger opens', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send, { id: 'x' })
    pc.trigger.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }))
    expect(send).toHaveBeenCalledWith({ type: 'open' })
  })

  it('Enter selects highlighted when open (single keydown handler branches on open)', () => {
    const send = vi.fn()
    const open = signalOf({ ...init({ items: ['a', 'b'] }), open: true })
    const pc = connect(open, send, { id: 'x' })
    pc.content.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))
    expect(send).toHaveBeenCalledWith({ type: 'selectHighlighted' })
  })

  // Finding 3: the trigger is the focused combobox — it (not just the listbox)
  // handles navigation while open, keeping focus + activedescendant + keydown
  // on one element.
  it('ArrowDown on the trigger navigates options when open', () => {
    const send = vi.fn()
    const open = signalOf({ ...init({ items: ['a', 'b'] }), open: true })
    const pc = connect(open, send, { id: 'x' })
    pc.trigger.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }))
    expect(send).toHaveBeenCalledWith({ type: 'highlightNext' })
  })

  // Finding 17: the hidden select participates in forms when a name is given.
  it('hiddenSelect carries the form name; hiddenOption reflects selection', () => {
    const pc = connect(rootSignal(), vi.fn(), { id: 'x', name: 'fruit' })
    expect(pc.hiddenSelect.name).toBe('fruit')
    expect(read(pc.hiddenOption('a').selected, init({ items: ['a', 'b'], value: ['a'] }))).toBe(
      true,
    )
    expect(read(pc.hiddenOption('b').selected, init({ items: ['a', 'b'], value: ['a'] }))).toBe(
      false,
    )
  })

  it('valueText uses placeholder when empty', () => {
    expect(read(p.valueText, init({ items: ['a'] }))).toBe('Choose…')
  })

  it('valueText joins multiple with separator', () => {
    const pc = connect(rootSignal(), vi.fn(), { id: 'x', separator: ' | ' })
    expect(
      read(pc.valueText, {
        ...init({ items: ['a', 'b'], selectionMode: 'multiple' }),
        value: ['a', 'b'],
      }),
    ).toBe('a | b')
  })
})

describe('select option groups', () => {
  it('flat string[] still works with no groups', () => {
    const s = init({ items: ['a', 'b', 'c'] })
    expect(s.items).toEqual(['a', 'b', 'c'])
    expect(s.groups).toEqual([])
  })

  it('init derives flat items from groups when items omitted', () => {
    const s = init({
      groups: [
        { id: 'fruit', label: 'Fruit', items: ['apple', 'banana'] },
        { id: 'veg', label: 'Veg', items: ['carrot'] },
      ],
    })
    expect(s.items).toEqual(['apple', 'banana', 'carrot'])
    expect(s.groups).toEqual([
      { id: 'fruit', label: 'Fruit', items: ['apple', 'banana'] },
      { id: 'veg', label: 'Veg', items: ['carrot'] },
    ])
  })

  it('group(id) part exposes role=group + aria-labelledby pointing at the label', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'sel' })
    const g = p.group('fruit')
    expect(g.group.role).toBe('group')
    expect(g.group['aria-labelledby']).toBe('sel:group:fruit:label')
    expect(g.group['data-scope']).toBe('select')
    expect(g.group['data-part']).toBe('group')
    expect(g.groupLabel.id).toBe('sel:group:fruit:label')
    expect(g.groupLabel['data-part']).toBe('group-label')
  })

  it('navigation skips disabled items across group boundaries', () => {
    const s0 = init({
      groups: [
        { id: 'g1', label: 'G1', items: ['a', 'b'] },
        { id: 'g2', label: 'G2', items: ['c', 'd'] },
      ],
      disabledItems: ['b', 'c'],
    })
    // items === ['a','b','c','d']; highlight starts null
    const [s1] = update(s0, { type: 'highlightFirst' })
    expect(s1.highlightedValue).toBe('a')
    const [s2] = update(s1, { type: 'highlightNext' })
    expect(s2.highlightedValue).toBe('d') // skips disabled 'b' and 'c', lands on 'd'
    const [s3] = update(s2, { type: 'highlightPrev' })
    expect(s3.highlightedValue).toBe('a') // back to 'a'
    const [s4] = update(s0, { type: 'highlightLast' })
    expect(s4.highlightedValue).toBe('d')
  })

  it('group items() helper derives item ids from the option VALUE', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'sel' })
    // item part ids are value-keyed (stable when the flat list reorders)
    expect(p.item('apple').item.id).toBe('sel:item:apple')
    expect(p.item('carrot').item.id).toBe('sel:item:carrot')
  })
})

describe('select value-based highlight identity', () => {
  it('highlight follows the VALUE across a setItems reorder (not a stale index)', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'sel' })
    // Highlight 'c' (index 2), then reorder so 'c' moves to index 0.
    const s0 = { ...init({ items: ['a', 'b', 'c'] }), open: true, highlightedValue: 'c' }
    const [s] = update(s0, { type: 'setItems', items: ['c', 'a', 'b'] })
    expect(s.highlightedValue).toBe('c')
    // The row for 'c' stays highlighted regardless of its new position; 'a' isn't.
    expect(read(p.item('c').item['data-highlighted'], s)).toBe('')
    expect(read(p.item('a').item['data-highlighted'], s)).toBeUndefined()
    // aria-activedescendant tracks the value's id, not a captured index.
    expect(read(p.trigger['aria-activedescendant'], s)).toBe('sel:item:c')
    // data-index reactively reflects the NEW position (0), never a stale 2.
    expect(read(p.item('c').item['data-index'], s)).toBe('0')
  })

  it('setItems drops a highlight whose value no longer exists (no dangling activedescendant)', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'sel' })
    const s0 = { ...init({ items: ['a', 'b', 'c'] }), open: true, highlightedValue: 'c' }
    const [s] = update(s0, { type: 'setItems', items: ['a', 'b'] })
    expect(s.highlightedValue).toBeNull()
    expect(read(p.trigger['aria-activedescendant'], s)).toBeUndefined()
  })

  it('setItems drops a highlight whose value became disabled', () => {
    const s0 = { ...init({ items: ['a', 'b', 'c'] }), open: true, highlightedValue: 'b' }
    const [s] = update(s0, { type: 'setItems', items: ['a', 'b', 'c'], disabled: ['b'] })
    expect(s.highlightedValue).toBeNull()
  })

  it('selectHighlighted commits the highlighted VALUE after a reorder', () => {
    const s0 = { ...init({ items: ['a', 'b', 'c'] }), open: true, highlightedValue: 'c' }
    const [reordered] = update(s0, { type: 'setItems', items: ['c', 'a', 'b'] })
    const [s] = update(reordered, { type: 'selectHighlighted' })
    // Selection acts on 'c' (the highlighted value), not on whatever now sits at index 2.
    expect(s.value).toEqual(['c'])
  })
})
