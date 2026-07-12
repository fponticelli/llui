import { describe, it, expect, vi } from 'vitest'
import { init, update, connect, isPresent, type MenuItem } from '../../src/components/menu'
import { rootSignal, signalOf, read } from '../_signal'

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
    const s0 = { ...init({ items: flat, open: true }) }
    s0.highlights[''] = 'c'
    const [s] = update(s0, { type: 'highlightNext', level: '' })
    expect(s.highlights['']).toBe('a')
  })

  it('highlightNext skips disabled', () => {
    const s0 = {
      ...init({
        open: true,
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
        open: true,
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
    const s0 = { ...init({ items: flat, open: true }) }
    s0.highlights[''] = 'a'
    const [s] = update(s0, { type: 'highlightPrev', level: '' })
    expect(s.highlights['']).toBe('c')
  })

  it('highlight directly sets value', () => {
    const [s] = update(init({ items: flat, open: true }), {
      type: 'highlight',
      level: '',
      value: 'b',
    })
    expect(s.highlights['']).toBe('b')
  })

  // Finding 5: highlight/typeahead are open-only — a stray message (e.g. a
  // queued hover timer) must not mutate a CLOSED menu.
  it('highlight is ignored when the menu is closed', () => {
    const [s] = update(init({ items: flat }), { type: 'highlight', level: '', value: 'b' })
    expect(s.highlights['']).toBeNull()
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

describe('menu presence lifecycle', () => {
  it('init defaults to skipAnimations + status closed', () => {
    const s = init({ items: flat })
    expect(s.skipAnimations).toBe(true)
    expect(s.status).toBe('closed')
  })

  it('init({ open: true }) starts at status open', () => {
    expect(init({ items: flat, open: true }).status).toBe('open')
  })

  it('opening moves status to open (no enter animation wired)', () => {
    const [s] = update(init({ items: flat }), { type: 'open' })
    expect(s.status).toBe('open')
  })

  it('non-animated close (default) jumps straight to closed — no hang', () => {
    const s0 = { ...init({ items: flat }), open: true, status: 'open' as const }
    const [s] = update(s0, { type: 'close' })
    expect(s.open).toBe(false)
    expect(s.status).toBe('closed')
  })

  it('animated close goes to closing, stays mounted, then animationEnd → closed', () => {
    const s0 = {
      ...init({ items: flat, skipAnimations: false }),
      open: true,
      status: 'open' as const,
    }
    const [closing] = update(s0, { type: 'close' })
    expect(closing.open).toBe(false)
    expect(closing.status).toBe('closing')
    expect(isPresent(closing)).toBe(true) // still mounted during the exit animation

    const [closed] = update(closing, { type: 'animationEnd' })
    expect(closed.status).toBe('closed')
    expect(isPresent(closed)).toBe(false)
  })

  it('animationEnd is inert outside a transition', () => {
    const s0 = { ...init({ items: flat }), open: true, status: 'open' as const }
    const [s] = update(s0, { type: 'animationEnd' })
    expect(s).toBe(s0)
  })

  it('selecting an action leaf routes the close through presence (animated)', () => {
    const s0 = {
      ...init({ items: flat, skipAnimations: false }),
      open: true,
      status: 'open' as const,
    }
    s0.highlights[''] = 'a'
    const [s] = update(s0, { type: 'select', value: 'a' })
    expect(s.open).toBe(false)
    expect(s.status).toBe('closing')
  })

  it('isPresent is true for opening/open/closing, false for closed', () => {
    const base = init({ items: flat })
    expect(isPresent({ ...base, status: 'opening' })).toBe(true)
    expect(isPresent({ ...base, status: 'open' })).toBe(true)
    expect(isPresent({ ...base, status: 'closing' })).toBe(true)
    expect(isPresent({ ...base, status: 'closed' })).toBe(false)
  })

  it('connect content data-state reflects the presence status incl. closing', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'x' })
    const ds = p.content['data-state']
    expect(read(ds, { ...init({ items: flat }), status: 'open' })).toBe('open')
    expect(read(ds, { ...init({ items: flat }), status: 'closing' })).toBe('closing')
    expect(read(ds, { ...init({ items: flat }), status: 'closed' })).toBe('closed')
  })

  it('connect content onAnimationEnd sends animationEnd', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'x' })
    p.content.onAnimationEnd({} as AnimationEvent)
    expect(send).toHaveBeenCalledWith({ type: 'animationEnd' })
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

  // Finding 2: virtual-focus menus keep DOM focus on the container, so the
  // highlighted item must be announced via aria-activedescendant.
  it('content aria-activedescendant points at the root-level highlighted item', () => {
    const s = { ...init({ items: flat, open: true }), highlights: { '': 'b' } }
    expect(read(parts.content['aria-activedescendant'], s)).toBe('m1:item:b')
    const none = { ...init({ items: flat, open: true }), highlights: { '': null } }
    expect(read(parts.content['aria-activedescendant'], none)).toBeUndefined()
  })

  it('subContent aria-activedescendant points at that level highlighted item', () => {
    const sub = parts.subContent('parent')
    const s = { ...init({ items: flat, open: true }), highlights: { '': null, parent: 'child' } }
    expect(read(sub['aria-activedescendant'], s)).toBe('m1:item:child')
  })

  // Finding 9: group() takes an opaque id — never raw label text — so the id and
  // aria-labelledby stay valid for multi-word labels.
  it('group() builds ids from an opaque id, not label text', () => {
    const g = parts.group('file-ops')
    expect(g.label.id).toBe('m1:group:file-ops:label')
    expect(g.group['aria-labelledby']).toBe('m1:group:file-ops:label')
  })

  // Finding 18: a highlight already at the target returns the same state ref.
  it('highlight to the already-highlighted value returns the same reference', () => {
    const s0 = { ...init({ items: flat, open: true }), highlights: { '': 'b' } }
    const [s1] = update(s0, { type: 'highlight', level: '', value: 'b' })
    expect(s1).toBe(s0)
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
    const p = connect(signalOf(init({ items: flat })), send, { id: 'x' })
    const ev = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true })
    p.subTrigger('share').onKeyDown(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(send).toHaveBeenCalledWith({ type: 'openSub', value: 'share' })
  })

  it('subContent ArrowLeft closes the deepest submenu', () => {
    const send = vi.fn()
    const p = connect(signalOf(init({ items: flat })), send, { id: 'x' })
    const ev = new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true })
    p.subContent('share').onKeyDown(ev)
    expect(send).toHaveBeenCalledWith({ type: 'closeSub' })
  })

  it('subContent Escape closes the deepest submenu (unwinds one level)', () => {
    const send = vi.fn()
    const p = connect(signalOf(init({ items: flat })), send, { id: 'x' })
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

describe('menu.connect submenu nav via root content (virtual focus)', () => {
  // Virtual focus keeps DOM focus on the root content, so rootKeyNav (bound to
  // content.onKeyDown) is the ONLY handler that fires — it must drive the open
  // submenu on the deepest level.
  const subTree: MenuItem[] = [
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

  const rootHighlighting = (value: string) => ({
    ...init({ items: subTree, open: true }),
    highlights: { '': value },
  })

  const submenuOpen = (highlight: string) => ({
    ...init({ items: subTree, open: true }),
    openPath: ['share'],
    highlights: { '': 'share', share: highlight },
  })

  const key = (k: string) => new KeyboardEvent('keydown', { key: k, cancelable: true })

  it('ArrowRight on a highlighted subtrigger opens the submenu', () => {
    const send = vi.fn()
    const p = connect(signalOf(rootHighlighting('share')), send, { id: 'x' })
    const ev = key('ArrowRight')
    p.content.onKeyDown(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(send).toHaveBeenCalledWith({ type: 'openSub', value: 'share' })
  })

  it('ArrowRight on a leaf item is a no-op', () => {
    const send = vi.fn()
    const p = connect(signalOf(rootHighlighting('new')), send, { id: 'x' })
    const ev = key('ArrowRight')
    p.content.onKeyDown(ev)
    expect(send).not.toHaveBeenCalled()
    expect(ev.defaultPrevented).toBe(false)
  })

  it('ArrowDown routes to the deepest open submenu level', () => {
    const send = vi.fn()
    const p = connect(signalOf(submenuOpen('email')), send, { id: 'x' })
    p.content.onKeyDown(key('ArrowDown'))
    expect(send).toHaveBeenCalledWith({ type: 'highlightNext', level: 'share' })
  })

  it('Enter selects the highlighted item at the deepest level', () => {
    const send = vi.fn()
    const p = connect(signalOf(submenuOpen('email')), send, { id: 'x' })
    p.content.onKeyDown(key('Enter'))
    expect(send).toHaveBeenCalledWith({ type: 'selectHighlighted', level: 'share' })
  })

  it('ArrowLeft closes the deepest open submenu', () => {
    const send = vi.fn()
    const p = connect(signalOf(submenuOpen('email')), send, { id: 'x' })
    const ev = key('ArrowLeft')
    p.content.onKeyDown(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(send).toHaveBeenCalledWith({ type: 'closeSub' })
  })

  it('ArrowLeft at the root (no submenu open) is a no-op', () => {
    const send = vi.fn()
    const p = connect(signalOf(rootHighlighting('new')), send, { id: 'x' })
    p.content.onKeyDown(key('ArrowLeft'))
    expect(send).not.toHaveBeenCalled()
  })

  it('Escape closes the deepest submenu before the whole menu', () => {
    const send = vi.fn()
    const p = connect(signalOf(submenuOpen('email')), send, { id: 'x' })
    p.content.onKeyDown(key('Escape'))
    expect(send).toHaveBeenCalledWith({ type: 'closeSub' })
  })

  it('typeahead is scoped to the deepest open submenu level', () => {
    const send = vi.fn()
    const p = connect(signalOf(submenuOpen('email')), send, { id: 'x' })
    p.content.onKeyDown(new KeyboardEvent('keydown', { key: 'l' }))
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'typeahead', level: 'share', char: 'l' }),
    )
  })

  it('content aria-activedescendant reflects the deepest open level highlight', () => {
    const parts = connect(rootSignal(), vi.fn(), { id: 'm1' })
    expect(read(parts.content['aria-activedescendant'], submenuOpen('link'))).toBe('m1:item:link')
  })
})

describe('menu RTL', () => {
  it('init defaults dir to ltr; respects opts.dir', () => {
    expect(init({ items: flat }).dir).toBe('ltr')
    expect(init({ items: flat, dir: 'rtl' }).dir).toBe('rtl')
  })

  it('setDir updates the reading direction', () => {
    const [s] = update(init({ items: flat }), { type: 'setDir', dir: 'rtl' })
    expect(s.dir).toBe('rtl')
  })

  it('ltr: subTrigger ArrowRight opens, ArrowLeft is inert', () => {
    const send = vi.fn()
    const p = connect(signalOf(init({ items: flat })), send, { id: 'x' })
    p.subTrigger('share').onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    expect(send).toHaveBeenCalledWith({ type: 'openSub', value: 'share' })
    send.mockClear()
    p.subTrigger('share').onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))
    expect(send).not.toHaveBeenCalled()
  })

  it('rtl: arrows swap — ArrowLeft opens the submenu, ArrowRight is inert', () => {
    const send = vi.fn()
    const p = connect(signalOf(init({ items: flat, dir: 'rtl' })), send, { id: 'x' })
    p.subTrigger('share').onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))
    expect(send).toHaveBeenCalledWith({ type: 'openSub', value: 'share' })
    send.mockClear()
    p.subTrigger('share').onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    expect(send).not.toHaveBeenCalled()
  })

  it('ltr: subContent ArrowLeft closes the submenu', () => {
    const send = vi.fn()
    const p = connect(signalOf(init({ items: flat })), send, { id: 'x' })
    p.subContent('share').onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))
    expect(send).toHaveBeenCalledWith({ type: 'closeSub' })
  })

  it('rtl: subContent ArrowRight closes the submenu (ArrowLeft does not)', () => {
    const send = vi.fn()
    const p = connect(signalOf(init({ items: flat, dir: 'rtl' })), send, { id: 'x' })
    p.subContent('share').onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    expect(send).toHaveBeenCalledWith({ type: 'closeSub' })
    send.mockClear()
    // ArrowLeft now means "open/forward", so it must NOT close the submenu.
    p.subContent('share').onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))
    expect(send).not.toHaveBeenCalledWith({ type: 'closeSub' })
  })

  it('vertical arrows are never flipped under rtl', () => {
    const send = vi.fn()
    const p = connect(signalOf(init({ items: flat, dir: 'rtl' })), send, { id: 'x' })
    p.subContent('share').onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    expect(send).toHaveBeenCalledWith({ type: 'highlightNext', level: 'share' })
    send.mockClear()
    p.subContent('share').onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowUp' }))
    expect(send).toHaveBeenCalledWith({ type: 'highlightPrev', level: 'share' })
  })
})
