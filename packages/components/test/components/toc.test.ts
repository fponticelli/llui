import { describe, it, expect, vi } from 'vitest'
import { init, update, connect, isActive, isExpanded } from '../../src/components/toc'
import type { TocState, TocEntry } from '../../src/components/toc'

type Ctx = { t: TocState }
const wrap = (t: TocState): Ctx => ({ t })

const entries: TocEntry[] = [
  { id: 'intro', label: 'Introduction', level: 1 },
  { id: 'install', label: 'Installation', level: 1 },
  { id: 'install-npm', label: 'npm', level: 2 },
  { id: 'api', label: 'API', level: 1 },
]

describe('toc reducer', () => {
  it('initializes with no active and no expanded', () => {
    expect(init()).toMatchObject({ activeId: null, expanded: [] })
  })

  it('setItems replaces the list', () => {
    const [s] = update(init(), { type: 'setItems', items: entries })
    expect(s.items).toHaveLength(4)
  })

  it('setActive updates activeId', () => {
    const [s] = update(init(), { type: 'setActive', id: 'intro' })
    expect(s.activeId).toBe('intro')
  })

  it('setActive is idempotent', () => {
    const s0 = init({ activeId: 'intro' })
    const [s] = update(s0, { type: 'setActive', id: 'intro' })
    expect(s).toBe(s0)
  })

  it('toggleExpanded flips membership', () => {
    const [s1] = update(init(), { type: 'toggleExpanded', id: 'install' })
    expect(s1.expanded).toEqual(['install'])
    const [s2] = update(s1, { type: 'toggleExpanded', id: 'install' })
    expect(s2.expanded).toEqual([])
  })

  it('expandAll + collapseAll', () => {
    const s0 = init({ items: entries })
    const [s1] = update(s0, { type: 'expandAll' })
    expect(s1.expanded.sort()).toEqual(['api', 'install', 'install-npm', 'intro'])
    const [s2] = update(s1, { type: 'collapseAll' })
    expect(s2.expanded).toEqual([])
  })
})

describe('toc.connect', () => {
  it('link aria-current=location when active', () => {
    const p = connect<Ctx>((s) => s.t, vi.fn())
    const link = p.item(entries[0]!).link
    expect(link['aria-current'](wrap(init({ activeId: 'intro' })))).toBe('location')
    expect(link['aria-current'](wrap(init()))).toBeUndefined()
  })

  it('link href uses prefix', () => {
    const p1 = connect<Ctx>((s) => s.t, vi.fn())
    expect(p1.item(entries[0]!).link.href).toBe('#intro')
    const p2 = connect<Ctx>((s) => s.t, vi.fn(), { hrefPrefix: '/docs#' })
    expect(p2.item(entries[0]!).link.href).toBe('/docs#intro')
  })

  it('item data-level reflects nesting', () => {
    const p = connect<Ctx>((s) => s.t, vi.fn())
    expect(p.item(entries[0]!).item['data-level']).toBe('1')
    expect(p.item(entries[2]!).item['data-level']).toBe('2')
  })

  it('expandTrigger dispatches toggleExpanded', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.t, send)
    p.item(entries[1]!).expandTrigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'toggleExpanded', id: 'install' })
  })

  it('root has navigation role', () => {
    const p = connect<Ctx>((s) => s.t, vi.fn(), { label: 'Contents' })
    expect(p.root.role).toBe('navigation')
    expect(p.root['aria-label']).toBe('Contents')
  })
})

describe('helpers', () => {
  it('isActive + isExpanded', () => {
    const s = init({ activeId: 'intro', expanded: ['install'] })
    expect(isActive(s, 'intro')).toBe(true)
    expect(isActive(s, 'other')).toBe(false)
    expect(isExpanded(s, 'install')).toBe(true)
    expect(isExpanded(s, 'intro')).toBe(false)
  })
})
