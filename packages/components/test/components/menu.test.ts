import { describe, it, expect, vi } from 'vitest'
import { init, update, connect, type MenuItem } from '../../src/components/menu'
import { rootSignal, read } from '../_signal'

const flat: MenuItem[] = [
  { value: 'a', kind: 'action' },
  { value: 'b', kind: 'action' },
  { value: 'c', kind: 'action' },
]

describe('menu reducer', () => {
  it('initializes closed with no highlight', () => {
    const s = init({ items: flat })
    expect(s.open).toBe(false)
    expect(s.items).toEqual(flat)
    expect(s.highlights['']).toBeNull()
    expect(s.openPath).toEqual([])
  })

  it('open highlights first enabled item', () => {
    const [s] = update(init({ items: flat }), { type: 'open' })
    expect(s.open).toBe(true)
    expect(s.highlights['']).toBe('a')
  })

  it('open skips disabled items for initial highlight', () => {
    const [s] = update(
      init({
        items: [
          { value: 'a', kind: 'action', disabled: true },
          { value: 'b', kind: 'action' },
        ],
      }),
      { type: 'open' },
    )
    expect(s.highlights['']).toBe('b')
  })

  it('open skips separators and group labels for initial highlight', () => {
    const [s] = update(
      init({
        items: [
          { value: 'sep1', kind: 'separator' },
          { value: 'a', kind: 'action' },
        ],
      }),
      { type: 'open' },
    )
    expect(s.highlights['']).toBe('a')
  })

  it('open preserves existing highlight', () => {
    const s0 = init({ items: flat, highlighted: 'b' })
    const [s] = update(s0, { type: 'open' })
    expect(s.highlights['']).toBe('b')
  })

  it('close clears highlight + typeahead + openPath', () => {
    const s0 = { ...init({ items: flat }), open: true }
    s0.highlights[''] = 'a'
    s0.openPath = ['x']
    const [s] = update(s0, { type: 'close' })
    expect(s.open).toBe(false)
    expect(s.highlights['']).toBeNull()
    expect(s.openPath).toEqual([])
  })

  it('toggle alternates', () => {
    const [s1] = update(init({ items: flat }), { type: 'toggle' })
    expect(s1.open).toBe(true)
    const [s2] = update(s1, { type: 'toggle' })
    expect(s2.open).toBe(false)
  })

  it('highlightNext wraps (root level)', () => {
    const s0 = { ...init({ items: flat }) }
    s0.highlights[''] = 'c'
    const [s] = update(s0, { type: 'highlightNext', level: '' })
    expect(s.highlights['']).toBe('a')
  })

  it('highlightNext skips disabled', () => {
    const s0 = {
      ...init({
        items: [
          { value: 'a', kind: 'action' },
          { value: 'b', kind: 'action', disabled: true },
          { value: 'c', kind: 'action' },
        ],
      }),
    }
    s0.highlights[''] = 'a'
    const [s] = update(s0, { type: 'highlightNext', level: '' })
    expect(s.highlights['']).toBe('c')
  })

  it('highlightNext skips separators and group labels', () => {
    const s0 = {
      ...init({
        items: [
          { value: 'a', kind: 'action' as const },
          { value: 'sep', kind: 'separator' as const },
          { value: 'c', kind: 'action' as const },
        ],
      }),
    }
    s0.highlights[''] = 'a'
    const [s] = update(s0, { type: 'highlightNext', level: '' })
    expect(s.highlights['']).toBe('c')
  })

  it('highlightPrev wraps backwards', () => {
    const s0 = { ...init({ items: flat }) }
    s0.highlights[''] = 'a'
    const [s] = update(s0, { type: 'highlightPrev', level: '' })
    expect(s.highlights['']).toBe('c')
  })

  it('highlight directly sets value', () => {
    const [s] = update(init({ items: flat }), { type: 'highlight', level: '', value: 'b' })
    expect(s.highlights['']).toBe('b')
  })

  it('highlight ignores disabled items', () => {
    const [s] = update(
      init({
        items: [
          { value: 'a', kind: 'action' },
          { value: 'b', kind: 'action', disabled: true },
        ],
      }),
      { type: 'highlight', level: '', value: 'b' },
    )
    expect(s.highlights['']).toBeNull()
  })

  it('select (action) closes menu', () => {
    const s0 = { ...init({ items: flat }), open: true }
    s0.highlights[''] = 'a'
    const [s] = update(s0, { type: 'select', value: 'a' })
    expect(s.open).toBe(false)
  })

  it('select ignored for disabled items', () => {
    const s0 = {
      ...init({
        items: [
          { value: 'a', kind: 'action' },
          { value: 'b', kind: 'action', disabled: true },
        ],
      }),
      open: true,
    }
    const [s] = update(s0, { type: 'select', value: 'b' })
    expect(s.open).toBe(true)
  })
})

describe('menu checkbox / radio items', () => {
  const items: MenuItem[] = [
    { value: 'wrap', kind: 'checkbox' },
    { value: 'bold', kind: 'radio', group: 'style' },
    { value: 'italic', kind: 'radio', group: 'style' },
  ]

  it('selecting a checkbox toggles checked and does NOT close', () => {
    const s0 = { ...init({ items }), open: true }
    const [s1] = update(s0, { type: 'select', value: 'wrap' })
    expect(s1.open).toBe(true)
    expect(s1.checked).toContain('wrap')
    const [s2] = update(s1, { type: 'select', value: 'wrap' })
    expect(s2.checked).not.toContain('wrap')
  })

  it('checkbox closeOnSelect:true closes after toggle', () => {
    const s0 = { ...init({ items, closeOnSelect: true }), open: true }
    const [s1] = update(s0, { type: 'select', value: 'wrap' })
    expect(s1.open).toBe(false)
    expect(s1.checked).toContain('wrap')
  })

  it('radio selection is mutually exclusive within a group', () => {
    const s0 = { ...init({ items }), open: true }
    const [s1] = update(s0, { type: 'select', value: 'bold' })
    expect(s1.checked).toContain('bold')
    const [s2] = update(s1, { type: 'select', value: 'italic' })
    expect(s2.checked).toContain('italic')
    expect(s2.checked).not.toContain('bold')
  })

  it('radio selection does not close by default', () => {
    const s0 = { ...init({ items }), open: true }
    const [s1] = update(s0, { type: 'select', value: 'bold' })
    expect(s1.open).toBe(true)
  })
})

describe('menu submenu reducer', () => {
  const tree: MenuItem[] = [
    { value: 'new', kind: 'action' },
    {
      value: 'share',
      kind: 'action',
      children: [
        { value: 'email', kind: 'action' },
        { value: 'link', kind: 'action' },
      ],
    },
  ]

  it('openSub pushes onto openPath and highlights first child', () => {
    const s0 = { ...init({ items: tree }), open: true }
    const [s] = update(s0, { type: 'openSub', value: 'share' })
    expect(s.openPath).toEqual(['share'])
    expect(s.highlights['share']).toBe('email')
  })

  it('closeSub pops the deepest level', () => {
    const s0 = { ...init({ items: tree }), open: true, openPath: ['share'] }
    s0.highlights['share'] = 'email'
    const [s] = update(s0, { type: 'closeSub' })
    expect(s.openPath).toEqual([])
    expect(s.highlights['share']).toBeUndefined()
  })

  it('selecting a parent action with children opens its submenu instead of closing', () => {
    const s0 = { ...init({ items: tree }), open: true }
    const [s] = update(s0, { type: 'select', value: 'share' })
    expect(s.open).toBe(true)
    expect(s.openPath).toEqual(['share'])
  })

  it('selecting a leaf inside a submenu closes the whole menu', () => {
    const s0 = { ...init({ items: tree }), open: true, openPath: ['share'] }
    const [s] = update(s0, { type: 'select', value: 'email' })
    expect(s.open).toBe(false)
    expect(s.openPath).toEqual([])
  })

  it('highlightNext at a submenu level navigates children only', () => {
    const s0 = { ...init({ items: tree }), open: true, openPath: ['share'] }
    s0.highlights['share'] = 'email'
    const [s] = update(s0, { type: 'highlightNext', level: 'share' })
    expect(s.highlights['share']).toBe('link')
  })

  it('typeahead is scoped to a level and skips separators', () => {
    const items: MenuItem[] = [
      { value: 'apple', kind: 'action' },
      { value: 'sep', kind: 'separator' },
      { value: 'banana', kind: 'action' },
      { value: 'apricot', kind: 'action' },
    ]
    const s0 = { ...init({ items }), open: true }
    s0.highlights[''] = 'apple'
    const [s] = update(s0, { type: 'typeahead', level: '', char: 'a', now: 1000 })
    expect(s.highlights['']).toBe('apricot')
  })
})

describe('menu.connect', () => {
  const parts = connect(rootSignal(), vi.fn(), { id: 'm1' })

  it('trigger aria-haspopup=menu', () => {
    expect(parts.trigger['aria-haspopup']).toBe('menu')
  })

  it('trigger aria-expanded tracks open', () => {
    expect(read(parts.trigger['aria-expanded'], { ...init({ items: flat }), open: true })).toBe(
      true,
    )
    expect(read(parts.trigger['aria-expanded'], init({ items: flat }))).toBe(false)
  })

  it('trigger click toggles', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'x' })
    p.trigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'toggle' })
  })

  it('trigger ArrowDown opens menu', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'x' })
    const ev = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true })
    p.trigger.onKeyDown(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(send).toHaveBeenCalledWith({ type: 'open' })
  })

  it('content ArrowDown highlights next at root level', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'x' })
    p.content.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }))
    expect(send).toHaveBeenCalledWith({ type: 'highlightNext', level: '' })
  })

  it('content Enter selects highlighted at root level', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'x' })
    p.content.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))
    expect(send).toHaveBeenCalledWith({ type: 'selectHighlighted', level: '' })
  })

  it('content Escape closes when no submenu open', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'x' })
    p.content.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
    expect(send).toHaveBeenCalledWith({ type: 'close' })
  })

  it('content single-char sends typeahead scoped to root', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'x' })
    p.content.onKeyDown(new KeyboardEvent('keydown', { key: 'a' }))
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'typeahead', char: 'a', level: '' }),
    )
  })

  it('item click sends select + invokes onSelect callback', () => {
    const send = vi.fn()
    const onSelect = vi.fn()
    const p = connect(rootSignal(), send, { id: 'x', onSelect })
    p.item('a').item.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'select', value: 'a' })
    expect(onSelect).toHaveBeenCalledWith('a')
  })

  it('item data-state highlighted reflects state', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'x' })
    const itemA = p.item('a').item
    const s1 = { ...init({ items: flat }) }
    s1.highlights[''] = 'a'
    const s2 = { ...init({ items: flat }) }
    s2.highlights[''] = 'b'
    expect(read(itemA['data-state'], s1)).toBe('highlighted')
    expect(read(itemA['data-state'], s2)).toBeUndefined()
  })
})

describe('menu.connect checkbox / radio roles', () => {
  const items: MenuItem[] = [
    { value: 'wrap', kind: 'checkbox' },
    { value: 'bold', kind: 'radio', group: 'style' },
  ]

  it('checkboxItem has role menuitemcheckbox + reactive aria-checked', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'x' })
    const ci = p.checkboxItem('wrap').item
    expect(ci.role).toBe('menuitemcheckbox')
    const checkedState = { ...init({ items }), checked: ['wrap'] }
    const uncheckedState = { ...init({ items }), checked: [] }
    expect(read(ci['aria-checked'], checkedState)).toBe('true')
    expect(read(ci['aria-checked'], uncheckedState)).toBe('false')
  })

  it('radioItem has role menuitemradio + reactive aria-checked', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'x' })
    const ri = p.radioItem('bold').item
    expect(ri.role).toBe('menuitemradio')
    const checkedState = { ...init({ items }), checked: ['bold'] }
    expect(read(ri['aria-checked'], checkedState)).toBe('true')
  })
})

describe('menu.connect groups + separators', () => {
  it('group part has role group + aria-labelledby pointing at the label', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'x' })
    const g = p.group('edit')
    expect(g.group.role).toBe('group')
    expect(g.group['aria-labelledby']).toBe(g.label.id)
  })

  it('separator part has role separator', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'x' })
    expect(p.separator().role).toBe('separator')
  })
})

describe('menu.connect submenu parts', () => {
  it('subTrigger has aria-haspopup=menu + reactive aria-expanded', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'x' })
    const st = p.subTrigger('share')
    expect(st['aria-haspopup']).toBe('menu')
    const openState = { ...init({ items: flat }), openPath: ['share'] }
    const closedState = { ...init({ items: flat }), openPath: [] }
    expect(read(st['aria-expanded'], openState)).toBe(true)
    expect(read(st['aria-expanded'], closedState)).toBe(false)
  })

  it('subTrigger ArrowRight opens the submenu', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'x' })
    const ev = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true })
    p.subTrigger('share').onKeyDown(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(send).toHaveBeenCalledWith({ type: 'openSub', value: 'share' })
  })

  it('subContent ArrowLeft closes the deepest submenu', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'x' })
    const ev = new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true })
    p.subContent('share').onKeyDown(ev)
    expect(send).toHaveBeenCalledWith({ type: 'closeSub' })
  })

  it('subContent Escape closes the deepest submenu (unwinds one level)', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'x' })
    p.subContent('share').onKeyDown(
      new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }),
    )
    expect(send).toHaveBeenCalledWith({ type: 'closeSub' })
  })

  it('subContent has role menu + data-part subcontent', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'x' })
    const sc = p.subContent('share')
    expect(sc.role).toBe('menu')
    expect(sc['data-part']).toBe('subcontent')
  })

  it('subPositioner exposes positioner part for the submenu', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'x' })
    const sp = p.subPositioner('share')
    expect(sp['data-part']).toBe('subpositioner')
  })
})
