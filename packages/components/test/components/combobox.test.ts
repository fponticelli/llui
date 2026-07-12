import { describe, it, expect, vi } from 'vitest'
import { init, update, connect, CREATE_OPTION_VALUE } from '../../src/components/combobox'
import { rootSignal, read } from '../_signal'

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
  const p = connect(rootSignal(), vi.fn(), { id: 'cb1' })

  it('input has aria-autocomplete=list', () => {
    expect(p.input['aria-autocomplete']).toBe('list')
  })

  it('input role=combobox', () => {
    expect(p.input.role).toBe('combobox')
  })

  it('onInput sends setInputValue', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send, { id: 'x' })
    const target = document.createElement('input')
    target.value = 'hello'
    const ev = new Event('input')
    Object.defineProperty(ev, 'target', { value: target })
    pc.input.onInput(ev)
    expect(send).toHaveBeenCalledWith({ type: 'setInputValue', value: 'hello' })
  })

  it('Escape on input closes', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send, { id: 'x' })
    pc.input.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
    expect(send).toHaveBeenCalledWith({ type: 'close' })
  })

  it('input value tracks inputValue', () => {
    expect(read(p.input.value, init({ inputValue: 'xyz' }))).toBe('xyz')
  })

  it('trigger click opens', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send, { id: 'x' })
    pc.trigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'open' })
  })
})

describe('combobox async loading', () => {
  it('initializes with idle status and requestId 0', () => {
    const s = init()
    expect(s.status).toBe('idle')
    expect(s.requestId).toBe(0)
    expect(s.error).toBe(null)
  })

  it('loadStart sets loading status and bumps requestId', () => {
    const s0 = init()
    const [s] = update(s0, { type: 'loadStart', requestId: 1 })
    expect(s.status).toBe('loading')
    expect(s.requestId).toBe(1)
    expect(s.error).toBe(null)
  })

  it('loadSuccess for the current requestId replaces items and marks loaded', () => {
    const s0 = init()
    const [s1] = update(s0, { type: 'loadStart', requestId: 1 })
    const [s2] = update(s1, { type: 'loadSuccess', requestId: 1, items: ['x', 'y'] })
    expect(s2.status).toBe('loaded')
    expect(s2.items).toEqual(['x', 'y'])
    expect(s2.filteredItems).toEqual(['x', 'y'])
  })

  it('loadSuccess with a STALE requestId is ignored', () => {
    const s0 = init()
    const [s1] = update(s0, { type: 'loadStart', requestId: 2 })
    // a late response from request #1 arrives — must be dropped
    const [s2] = update(s1, { type: 'loadSuccess', requestId: 1, items: ['stale'] })
    expect(s2).toBe(s1)
    expect(s2.status).toBe('loading')
    expect(s2.items).toEqual([])
  })

  it('loadError with a STALE requestId is ignored', () => {
    const s0 = init()
    const [s1] = update(s0, { type: 'loadStart', requestId: 2 })
    const [s2] = update(s1, { type: 'loadError', requestId: 1, error: 'boom' })
    expect(s2).toBe(s1)
    expect(s2.status).toBe('loading')
    expect(s2.error).toBe(null)
  })

  it('loadError for the current requestId records the error', () => {
    const s0 = init()
    const [s1] = update(s0, { type: 'loadStart', requestId: 1 })
    const [s2] = update(s1, { type: 'loadError', requestId: 1, error: 'boom' })
    expect(s2.status).toBe('error')
    expect(s2.error).toBe('boom')
  })

  it('content exposes aria-busy when loading', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'cb' })
    expect(read(p.content['aria-busy'], { status: 'loading' })).toBe('true')
    expect(read(p.content['aria-busy'], { status: 'loaded' })).toBe(undefined)
  })

  it('liveRegion announces N results when loaded', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'cb' })
    expect(p.liveRegion['aria-live']).toBe('polite')
    expect(
      read(p.liveRegion.text, { status: 'loaded', filteredItems: ['a', 'b'], error: null }),
    ).toBe('2 results')
    expect(read(p.liveRegion.text, { status: 'loaded', filteredItems: ['a'], error: null })).toBe(
      '1 result',
    )
  })

  it('liveRegion announces the error message on error', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'cb' })
    expect(read(p.liveRegion.text, { status: 'error', filteredItems: [], error: 'boom' })).toBe(
      'boom',
    )
  })
})

describe('combobox option groups', () => {
  it('derives flat items from groups when no items given', () => {
    const s = init({
      groups: [
        { id: 'fruit', label: 'Fruit', items: ['apple', 'banana'] },
        { id: 'veg', label: 'Veg', items: ['carrot'] },
      ],
    })
    expect(s.items).toEqual(['apple', 'banana', 'carrot'])
    expect(s.filteredItems).toEqual(['apple', 'banana', 'carrot'])
  })

  it('group/groupLabel parts mirror select shape', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'cb' })
    const g = p.group('fruit')
    expect(g.group.role).toBe('group')
    expect(g.group['aria-labelledby']).toBe('cb:group:fruit:label')
    expect(g.groupLabel.id).toBe('cb:group:fruit:label')
    expect(g.groupLabel['aria-hidden']).toBe('true')
  })

  it('navigation only walks the flat filtered items (group labels are not options)', () => {
    const s0 = {
      ...init({
        groups: [
          { id: 'a', label: 'A', items: ['apple', 'apricot'] },
          { id: 'b', label: 'B', items: ['banana'] },
        ],
      }),
      highlightedIndex: 1,
    }
    const [s] = update(s0, { type: 'highlightNext' })
    // index 1 -> 2 (banana), never lands on a header
    expect(s.highlightedIndex).toBe(2)
    expect(s.filteredItems[s.highlightedIndex!]).toBe('banana')
  })
})

describe('combobox creatable', () => {
  it('appends a synthetic create option when allowCreate and no match', () => {
    const s0 = init({ items: ['apple', 'banana'], allowCreate: true })
    const [s] = update(s0, { type: 'setInputValue', value: 'cherry' })
    expect(s.filteredItems).toContain(CREATE_OPTION_VALUE)
    expect(s.filteredItems[s.filteredItems.length - 1]).toBe(CREATE_OPTION_VALUE)
  })

  it('does NOT append create option when input matches an existing item exactly', () => {
    const s0 = init({ items: ['apple', 'banana'], allowCreate: true })
    const [s] = update(s0, { type: 'setInputValue', value: 'apple' })
    expect(s.filteredItems).not.toContain(CREATE_OPTION_VALUE)
  })

  it('does NOT append create option when input is empty', () => {
    const s0 = init({ items: ['apple'], allowCreate: true })
    const [s] = update(s0, { type: 'setInputValue', value: '' })
    expect(s.filteredItems).not.toContain(CREATE_OPTION_VALUE)
  })

  it('does NOT append create option when allowCreate is off', () => {
    const s0 = init({ items: ['apple'], allowCreate: false })
    const [s] = update(s0, { type: 'setInputValue', value: 'zzz' })
    expect(s.filteredItems).not.toContain(CREATE_OPTION_VALUE)
  })

  it('selectOption on the create sentinel emits createOption with the input text', () => {
    const s0 = {
      ...init({ items: ['apple'], allowCreate: true }),
      inputValue: 'cherry',
      filteredItems: ['apple', CREATE_OPTION_VALUE],
      open: true,
    }
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'cb' })
    const itemParts = p.item(CREATE_OPTION_VALUE, 1)
    itemParts.item.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'selectOption', value: CREATE_OPTION_VALUE })
  })

  it('selectOption(create sentinel) returns a createOption effect/message path via update', () => {
    const s0 = {
      ...init({ items: ['apple'], allowCreate: true }),
      inputValue: 'cherry',
      filteredItems: ['apple', CREATE_OPTION_VALUE],
      open: true,
    }
    const [s, effects] = update(s0, { type: 'selectOption', value: CREATE_OPTION_VALUE })
    // create requests are owned by the consumer: surfaced as a createOption effect
    expect(effects).toEqual([{ type: 'createOption', value: 'cherry' }])
    // the machine does NOT add 'cherry' to value itself
    expect(s.value).toEqual([])
  })

  it('selectHighlighted on the create sentinel also emits the createOption effect', () => {
    const s0 = {
      ...init({ items: ['apple'], allowCreate: true }),
      inputValue: 'cherry',
      filteredItems: ['apple', CREATE_OPTION_VALUE],
      highlightedIndex: 1,
      open: true,
    }
    const [, effects] = update(s0, { type: 'selectHighlighted' })
    expect(effects).toEqual([{ type: 'createOption', value: 'cherry' }])
  })

  it('isCreateOption part flags the synthetic sentinel', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'cb' })
    expect(p.item(CREATE_OPTION_VALUE, 0).item['data-create']).toBe('')
    expect(p.item('apple', 0).item['data-create']).toBe(undefined)
  })

  // Finding 8: the ARIA combobox role belongs on the input only.
  it('root part carries no combobox role/aria (only the input does)', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'cb' })
    expect('role' in p.root).toBe(false)
    expect('aria-expanded' in p.root).toBe(false)
    expect('aria-haspopup' in p.root).toBe(false)
    expect('aria-controls' in p.root).toBe(false)
    expect(p.input.role).toBe('combobox')
    expect(p.input['aria-controls']).toBe('cb:content')
  })

  // Finding 18: a highlight at the already-highlighted index is a no-op that
  // returns the SAME state reference so the reconciler skips the commit.
  it('highlight to the current index returns the same state reference', () => {
    const s0 = { ...init({ items: ['a', 'b', 'c'] }), highlightedIndex: 1, open: true }
    const [s1] = update(s0, { type: 'highlight', index: 1 })
    expect(s1).toBe(s0)
    const [s2] = update(s0, { type: 'highlight', index: 2 })
    expect(s2).not.toBe(s0)
    expect(s2.highlightedIndex).toBe(2)
  })
})
