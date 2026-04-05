import { describe, it, expect, vi } from 'vitest'
import { init, update, connect, totalPages, pageItems } from '../../src/components/pagination'
import type { PaginationState } from '../../src/components/pagination'

type Ctx = { p: PaginationState }
const wrap = (p: PaginationState): Ctx => ({ p })

describe('pagination reducer', () => {
  it('initializes on page 1', () => {
    expect(init({ total: 50 })).toMatchObject({ page: 1, pageSize: 10, total: 50 })
  })

  it('goTo clamps to valid range', () => {
    const s0 = init({ total: 50, pageSize: 10 })
    expect(update(s0, { type: 'goTo', page: 100 })[0].page).toBe(5)
    expect(update(s0, { type: 'goTo', page: -5 })[0].page).toBe(1)
  })

  it('next/prev/first/last', () => {
    const s0 = init({ total: 50, pageSize: 10, page: 3 })
    expect(update(s0, { type: 'next' })[0].page).toBe(4)
    expect(update(s0, { type: 'prev' })[0].page).toBe(2)
    expect(update(s0, { type: 'first' })[0].page).toBe(1)
    expect(update(s0, { type: 'last' })[0].page).toBe(5)
  })

  it('next at last page stays', () => {
    const [s] = update(init({ total: 10, pageSize: 10, page: 1 }), { type: 'next' })
    expect(s.page).toBe(1)
  })

  it('setPageSize keeps first visible item', () => {
    const s0 = init({ total: 50, pageSize: 10, page: 3 }) // first item index = 20
    const [s] = update(s0, { type: 'setPageSize', pageSize: 5 })
    // With pageSize=5, item 20 is on page 5
    expect(s.page).toBe(5)
    expect(s.pageSize).toBe(5)
  })

  it('setTotal clamps page', () => {
    const s0 = init({ total: 50, pageSize: 10, page: 5 })
    const [s] = update(s0, { type: 'setTotal', total: 20 })
    expect(s.page).toBe(2)
  })

  it('disabled blocks mutations', () => {
    const s0 = init({ total: 50, pageSize: 10, page: 3, disabled: true })
    const [s] = update(s0, { type: 'next' })
    expect(s.page).toBe(3)
  })
})

describe('totalPages', () => {
  it('rounds up', () => {
    expect(totalPages(init({ total: 51, pageSize: 10 }))).toBe(6)
    expect(totalPages(init({ total: 50, pageSize: 10 }))).toBe(5)
  })

  it('returns 0 when total=0', () => {
    expect(totalPages(init({ total: 0 }))).toBe(0)
  })
})

describe('pageItems', () => {
  it('returns all pages when few', () => {
    const items = pageItems(init({ total: 30, pageSize: 10 }))
    expect(items).toEqual([
      { type: 'page', page: 1 },
      { type: 'page', page: 2 },
      { type: 'page', page: 3 },
    ])
  })

  it('inserts ellipses for large ranges', () => {
    const items = pageItems(init({ total: 1000, pageSize: 10, page: 50, siblings: 1, boundaries: 1 }))
    const types = items.map((i) => i.type)
    expect(types).toContain('ellipsis')
    // First and last page always present
    expect(items[0]).toMatchObject({ type: 'page', page: 1 })
    expect(items[items.length - 1]).toMatchObject({ type: 'page', page: 100 })
  })

  it('no ellipsis at start when current is near beginning', () => {
    const items = pageItems(init({ total: 100, pageSize: 10, page: 2, siblings: 1, boundaries: 1 }))
    // Should not show leading ellipsis
    expect(items.find((i) => i.type === 'ellipsis' && i.position === 'start')).toBeUndefined()
  })
})

describe('pagination.connect', () => {
  const parts = connect<Ctx>((s) => s.p, vi.fn())

  it('root has role=navigation', () => {
    expect(parts.root.role).toBe('navigation')
  })

  it('prev disabled on first page', () => {
    expect(parts.prevTrigger.disabled(wrap(init({ page: 1, total: 50 })))).toBe(true)
    expect(parts.prevTrigger.disabled(wrap(init({ page: 2, total: 50 })))).toBe(false)
  })

  it('next disabled on last page', () => {
    expect(parts.nextTrigger.disabled(wrap(init({ page: 5, total: 50, pageSize: 10 })))).toBe(true)
    expect(parts.nextTrigger.disabled(wrap(init({ page: 3, total: 50, pageSize: 10 })))).toBe(false)
  })

  it('item aria-current=page when selected', () => {
    expect(parts.item(3)['aria-current'](wrap(init({ page: 3 })))).toBe('page')
    expect(parts.item(3)['aria-current'](wrap(init({ page: 5 })))).toBeUndefined()
  })

  it('item click sends goTo', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.p, send)
    p.item(4).onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'goTo', page: 4 })
  })
})
