import { describe, it, expect, vi } from 'vitest'
import { init, update, connect, visibleItems } from '../../src/components/breadcrumbs'
import { rootSignal, read } from '../_signal'

const trail = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `c${i}`, label: `Crumb ${i}` }))

describe('breadcrumbs reducer', () => {
  it('initializes empty by default', () => {
    expect(init()).toEqual({ items: [], maxVisible: null, expanded: false })
  })

  it('setItems replaces the trail and resets expansion', () => {
    const s0 = init({ items: trail(2), expanded: true })
    const [s] = update(s0, { type: 'setItems', items: trail(3) })
    expect(s.items).toHaveLength(3)
    expect(s.expanded).toBe(false)
  })

  it('expand / collapse toggle the flag', () => {
    const s0 = init({ items: trail(5), maxVisible: 3 })
    const [expanded] = update(s0, { type: 'expand' })
    expect(expanded.expanded).toBe(true)
    const [collapsed] = update(expanded, { type: 'collapse' })
    expect(collapsed.expanded).toBe(false)
  })
})

describe('visibleItems', () => {
  it('returns empty for no items', () => {
    expect(visibleItems(init())).toEqual([])
  })

  it('shows the full trail when under maxVisible', () => {
    const out = visibleItems(init({ items: trail(3), maxVisible: 5 }))
    expect(out.map((i) => i.type)).toEqual(['item', 'item', 'item'])
  })

  it('shows the full trail when maxVisible is null', () => {
    const out = visibleItems(init({ items: trail(6) }))
    expect(out).toHaveLength(6)
    expect(out.every((i) => i.type === 'item')).toBe(true)
  })

  it('marks only the last item as current', () => {
    const out = visibleItems(init({ items: trail(3) }))
    const items = out.filter((i): i is Extract<typeof i, { type: 'item' }> => i.type === 'item')
    expect(items.map((i) => i.current)).toEqual([false, false, true])
  })

  it('collapses the middle to first + ellipsis + last N when exceeded', () => {
    // 6 items, maxVisible 3 => first item + ellipsis + last 2 items
    const out = visibleItems(init({ items: trail(6), maxVisible: 3 }))
    expect(out.map((i) => i.type)).toEqual(['item', 'ellipsis', 'item', 'item'])
    const ids = out.flatMap((i) => (i.type === 'item' ? [i.id] : []))
    expect(ids).toEqual(['c0', 'c4', 'c5'])
    // current is still the very last item
    const last = out[out.length - 1]
    expect(last).toMatchObject({ type: 'item', id: 'c5', current: true })
  })

  it('expanding reveals the full trail again', () => {
    const collapsed = visibleItems(init({ items: trail(6), maxVisible: 3 }))
    expect(collapsed).toHaveLength(4)
    const expanded = visibleItems(init({ items: trail(6), maxVisible: 3, expanded: true }))
    expect(expanded).toHaveLength(6)
    expect(expanded.every((i) => i.type === 'item')).toBe(true)
  })
})

describe('breadcrumbs.connect', () => {
  const parts = connect(rootSignal(), vi.fn())

  it('root is a labelled landmark', () => {
    expect(parts.root['aria-label']).toBe('Breadcrumb')
    expect(parts.root['data-part']).toBe('root')
  })

  it('respects a custom label', () => {
    const p = connect(rootSignal(), vi.fn(), { label: 'You are here' })
    expect(p.root['aria-label']).toBe('You are here')
  })

  it('list carries list-part semantics', () => {
    expect(parts.list['data-part']).toBe('list')
  })

  it('separator is presentational', () => {
    expect(parts.separator['aria-hidden']).toBe('true')
  })

  it('link aria-current=page only on the last item', () => {
    const state = init({ items: trail(3) })
    expect(read(parts.link('c2')['aria-current'], state)).toBe('page')
    expect(read(parts.link('c0')['aria-current'], state)).toBeUndefined()
    expect(read(parts.link('c1')['aria-current'], state)).toBeUndefined()
  })

  it('link data-current mirrors aria-current', () => {
    const state = init({ items: trail(2) })
    expect(read(parts.link('c1')['data-current'], state)).toBe('')
    expect(read(parts.link('c0')['data-current'], state)).toBeUndefined()
  })

  it('ellipsisTrigger is a labelled button that dispatches expand', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send)
    expect(p.ellipsisTrigger.type).toBe('button')
    expect(p.ellipsisTrigger['aria-label']).toBeTruthy()
    p.ellipsisTrigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'expand' })
  })
})
