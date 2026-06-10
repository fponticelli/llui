import { describe, it, expect, vi } from 'vitest'
import { init, update, connect, type ContextMenuItem } from '../../src/components/context-menu'
import { rootSignal, read } from '../_signal'

const flat: ContextMenuItem[] = [
  { value: 'a', kind: 'action' },
  { value: 'b', kind: 'action' },
]

describe('context-menu reducer', () => {
  it('initializes closed at 0,0', () => {
    const s = init()
    expect(s.open).toBe(false)
    expect(s.x).toBe(0)
    expect(s.y).toBe(0)
    expect(s.openPath).toEqual([])
  })

  it('openAt sets position and open, highlights first item', () => {
    const s0 = init({ items: flat })
    const [s] = update(s0, { type: 'openAt', x: 100, y: 200 })
    expect(s.open).toBe(true)
    expect(s.x).toBe(100)
    expect(s.y).toBe(200)
    expect(s.highlights['']).toBe('a')
  })

  it('openAt skips separators for initial highlight', () => {
    const s0 = init({
      items: [
        { value: 'sep', kind: 'separator' },
        { value: 'a', kind: 'action' },
      ],
    })
    const [s] = update(s0, { type: 'openAt', x: 0, y: 0 })
    expect(s.highlights['']).toBe('a')
  })

  it('close clears open + highlighted + openPath', () => {
    const s0 = { ...init({ items: flat }), open: true, openPath: ['x'] }
    s0.highlights[''] = 'a'
    const [s] = update(s0, { type: 'close' })
    expect(s.open).toBe(false)
    expect(s.highlights['']).toBeNull()
    expect(s.openPath).toEqual([])
  })

  it('highlightNext wraps', () => {
    const s0 = { ...init({ items: flat }) }
    s0.highlights[''] = 'b'
    const [s] = update(s0, { type: 'highlightNext', level: '' })
    expect(s.highlights['']).toBe('a')
  })

  it('select (action) closes menu', () => {
    const s0 = { ...init({ items: flat }), open: true }
    s0.highlights[''] = 'a'
    const [s] = update(s0, { type: 'select', value: 'a' })
    expect(s.open).toBe(false)
  })

  it('select ignored for disabled', () => {
    const s0 = { ...init({ items: [{ value: 'a', kind: 'action', disabled: true }] }), open: true }
    const [s] = update(s0, { type: 'select', value: 'a' })
    expect(s.open).toBe(true)
  })
})

describe('context-menu checkbox / radio', () => {
  const items: ContextMenuItem[] = [
    { value: 'wrap', kind: 'checkbox' },
    { value: 'r1', kind: 'radio', group: 'g' },
    { value: 'r2', kind: 'radio', group: 'g' },
  ]

  it('checkbox toggles and stays open', () => {
    const s0 = { ...init({ items }), open: true }
    const [s1] = update(s0, { type: 'select', value: 'wrap' })
    expect(s1.open).toBe(true)
    expect(s1.checked).toContain('wrap')
  })

  it('radio is mutually exclusive within a group', () => {
    const s0 = { ...init({ items }), open: true }
    const [s1] = update(s0, { type: 'select', value: 'r1' })
    const [s2] = update(s1, { type: 'select', value: 'r2' })
    expect(s2.checked).toContain('r2')
    expect(s2.checked).not.toContain('r1')
  })
})

describe('context-menu submenu reducer', () => {
  const tree: ContextMenuItem[] = [
    { value: 'a', kind: 'action' },
    {
      value: 'more',
      kind: 'action',
      children: [
        { value: 'x', kind: 'action' },
        { value: 'y', kind: 'action' },
      ],
    },
  ]

  it('openSub pushes onto openPath and highlights first child', () => {
    const s0 = { ...init({ items: tree }), open: true }
    const [s] = update(s0, { type: 'openSub', value: 'more' })
    expect(s.openPath).toEqual(['more'])
    expect(s.highlights['more']).toBe('x')
  })

  it('closeSub pops the deepest level', () => {
    const s0 = { ...init({ items: tree }), open: true, openPath: ['more'] }
    const [s] = update(s0, { type: 'closeSub' })
    expect(s.openPath).toEqual([])
  })

  it('selecting a leaf in a submenu closes everything', () => {
    const s0 = { ...init({ items: tree }), open: true, openPath: ['more'] }
    const [s] = update(s0, { type: 'select', value: 'x' })
    expect(s.open).toBe(false)
    expect(s.openPath).toEqual([])
  })
})

describe('context-menu.connect', () => {
  const p = connect(rootSignal(), vi.fn(), { id: 'cm1' })

  it('trigger contextmenu sends openAt with coordinates', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send, { id: 'x' })
    const ev = new MouseEvent('contextmenu', { clientX: 150, clientY: 75, cancelable: true })
    pc.trigger.onContextMenu(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(send).toHaveBeenCalledWith({ type: 'openAt', x: 150, y: 75 })
  })

  it('positioner style uses x/y', () => {
    const style = read(p.positioner.style, { ...init({ items: flat }), open: true, x: 42, y: 99 })
    expect(style).toContain('top:99px')
    expect(style).toContain('left:42px')
  })

  it('content ArrowDown sends highlightNext scoped to root', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send, { id: 'x' })
    pc.content.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }))
    expect(send).toHaveBeenCalledWith({ type: 'highlightNext', level: '' })
  })

  it('content Escape closes', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send, { id: 'x' })
    pc.content.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
    expect(send).toHaveBeenCalledWith({ type: 'close' })
  })

  it('item click sends select + invokes onSelect', () => {
    const send = vi.fn()
    const onSelect = vi.fn()
    const pc = connect(rootSignal(), send, { id: 'x', onSelect })
    pc.item('a').item.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'select', value: 'a' })
    expect(onSelect).toHaveBeenCalledWith('a')
  })

  it('checkboxItem role menuitemcheckbox + aria-checked', () => {
    const pc = connect(rootSignal(), vi.fn(), { id: 'x' })
    const ci = pc.checkboxItem('wrap').item
    expect(ci.role).toBe('menuitemcheckbox')
    expect(read(ci['aria-checked'], { ...init({ items: flat }), checked: ['wrap'] })).toBe('true')
  })

  it('radioItem role menuitemradio', () => {
    const pc = connect(rootSignal(), vi.fn(), { id: 'x' })
    expect(pc.radioItem('r1').item.role).toBe('menuitemradio')
  })

  it('group role group + aria-labelledby, separator role separator', () => {
    const pc = connect(rootSignal(), vi.fn(), { id: 'x' })
    const g = pc.group('g')
    expect(g.group.role).toBe('group')
    expect(g.group['aria-labelledby']).toBe(g.label.id)
    expect(pc.separator().role).toBe('separator')
  })

  it('subTrigger ArrowRight opens, subContent ArrowLeft/Escape closes', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send, { id: 'x' })
    pc.subTrigger('more').onKeyDown(
      new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }),
    )
    expect(send).toHaveBeenCalledWith({ type: 'openSub', value: 'more' })
    pc.subContent('more').onKeyDown(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true }),
    )
    expect(send).toHaveBeenCalledWith({ type: 'closeSub' })
  })
})
