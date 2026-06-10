import { describe, it, expect, vi } from 'vitest'
import {
  init,
  update,
  connect,
  totalPages,
  pageItems,
  onControlKeyDown,
} from '../../src/components/pagination'
import { rootSignal, signalOf, read } from '../_signal'

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

  it('defaults dir to ltr', () => {
    expect(init().dir).toBe('ltr')
  })

  it('init accepts an explicit dir', () => {
    expect(init({ dir: 'rtl' }).dir).toBe('rtl')
  })

  it('setDir updates the reading direction', () => {
    const [s] = update(init(), { type: 'setDir', dir: 'rtl' })
    expect(s.dir).toBe('rtl')
  })

  it('setDir applies even when disabled', () => {
    const s0 = init({ disabled: true })
    const [s] = update(s0, { type: 'setDir', dir: 'rtl' })
    expect(s.dir).toBe('rtl')
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
    const items = pageItems(
      init({ total: 1000, pageSize: 10, page: 50, siblings: 1, boundaries: 1 }),
    )
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
  const parts = connect(rootSignal(), vi.fn())

  it('root has role=navigation', () => {
    expect(parts.root.role).toBe('navigation')
  })

  it('prev disabled on first page', () => {
    expect(read(parts.prevTrigger.disabled, init({ page: 1, total: 50 }))).toBe(true)
    expect(read(parts.prevTrigger.disabled, init({ page: 2, total: 50 }))).toBe(false)
  })

  it('next disabled on last page', () => {
    expect(read(parts.nextTrigger.disabled, init({ page: 5, total: 50, pageSize: 10 }))).toBe(true)
    expect(read(parts.nextTrigger.disabled, init({ page: 3, total: 50, pageSize: 10 }))).toBe(false)
  })

  it('item aria-current=page when selected', () => {
    expect(read(parts.item(3)['aria-current'], init({ page: 3 }))).toBe('page')
    expect(read(parts.item(3)['aria-current'], init({ page: 5 }))).toBeUndefined()
  })

  it('item click sends goTo', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send)
    p.item(4).onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'goTo', page: 4 })
  })

  it('roving tabindex: only the current page item is a tab stop', () => {
    const p = connect(rootSignal(), vi.fn())
    const st = init({ total: 100, pageSize: 10, page: 3 })
    expect(read(p.item(3).tabindex, st)).toBe(0)
    expect(read(p.item(2).tabindex, st)).toBe(-1)
    expect(read(p.item(4).tabindex, st)).toBe(-1)
    expect(read(p.prevTrigger.tabindex, st)).toBe(-1)
    expect(read(p.nextTrigger.tabindex, st)).toBe(-1)
  })
})

describe('pagination roving focus', () => {
  // Build the real markup connect() implies: prev, page buttons + ellipsis
  // spans, next. Ellipsis is a <span> (not focusable); disabled prev/next
  // carry the native `disabled` attribute.
  function buildPagination(opts: {
    pages: number[]
    ellipsisAfter?: number[]
    prevDisabled?: boolean
    nextDisabled?: boolean
  }): { root: HTMLElement; controls: HTMLButtonElement[] } {
    const root = document.createElement('nav')
    root.setAttribute('data-scope', 'pagination')
    root.setAttribute('data-part', 'root')

    const prev = document.createElement('button')
    prev.setAttribute('data-scope', 'pagination')
    prev.setAttribute('data-part', 'prev-trigger')
    if (opts.prevDisabled) prev.disabled = true
    root.appendChild(prev)

    for (const page of opts.pages) {
      const btn = document.createElement('button')
      btn.setAttribute('data-scope', 'pagination')
      btn.setAttribute('data-part', 'item')
      btn.setAttribute('data-value', String(page))
      root.appendChild(btn)
      if (opts.ellipsisAfter?.includes(page)) {
        const span = document.createElement('span')
        span.setAttribute('data-scope', 'pagination')
        span.setAttribute('data-part', 'ellipsis')
        span.setAttribute('aria-hidden', 'true')
        root.appendChild(span)
      }
    }

    const next = document.createElement('button')
    next.setAttribute('data-scope', 'pagination')
    next.setAttribute('data-part', 'next-trigger')
    if (opts.nextDisabled) next.disabled = true
    root.appendChild(next)

    document.body.appendChild(root)
    const controls = Array.from(root.querySelectorAll<HTMLButtonElement>('button:not([disabled])'))
    return { root, controls }
  }

  function press(el: HTMLElement, key: string): KeyboardEvent {
    const ev = new KeyboardEvent('keydown', { key, cancelable: true })
    Object.defineProperty(ev, 'currentTarget', { value: el, writable: false })
    onControlKeyDown(ev)
    return ev
  }

  it('ArrowRight skips ellipsis boundary, focusing the next page button', () => {
    // Controls: prev, [1] … [50] [51] … [100], next  (1 and 100 flank ellipses)
    const { root, controls } = buildPagination({
      pages: [1, 50, 51, 100],
      ellipsisAfter: [1, 51],
    })
    const page1 = controls.find((c) => c.getAttribute('data-value') === '1')!
    page1.focus()
    const ev = press(page1, 'ArrowRight')
    expect(ev.defaultPrevented).toBe(true)
    // The ellipsis between 1 and 50 is a <span>, so focus lands on page 50.
    expect(document.activeElement?.getAttribute('data-value')).toBe('50')
    document.body.removeChild(root)
  })

  it('ArrowLeft skips ellipsis boundary backwards', () => {
    const { root, controls } = buildPagination({
      pages: [1, 50, 51, 100],
      ellipsisAfter: [1, 51],
    })
    const page50 = controls.find((c) => c.getAttribute('data-value') === '50')!
    page50.focus()
    press(page50, 'ArrowLeft')
    expect(document.activeElement?.getAttribute('data-value')).toBe('1')
    document.body.removeChild(root)
  })

  it('Home/End jump to the first and last focusable control', () => {
    const { root, controls } = buildPagination({
      pages: [1, 50, 51, 100],
      ellipsisAfter: [1, 51],
    })
    const page50 = controls.find((c) => c.getAttribute('data-value') === '50')!
    page50.focus()
    press(page50, 'Home')
    // First control is prev-trigger (enabled here).
    expect(document.activeElement?.getAttribute('data-part')).toBe('prev-trigger')

    press(document.activeElement as HTMLElement, 'End')
    expect(document.activeElement?.getAttribute('data-part')).toBe('next-trigger')
    document.body.removeChild(root)
  })

  it('disabled prev/next are skipped by Home/End and arrows', () => {
    // On page 1: prev disabled. Home from a page button lands on first page, not prev.
    const { root, controls } = buildPagination({
      pages: [1, 2, 3],
      prevDisabled: true,
    })
    const page2 = controls.find((c) => c.getAttribute('data-value') === '2')!
    page2.focus()
    press(page2, 'Home')
    expect(document.activeElement?.getAttribute('data-value')).toBe('1')

    // ArrowLeft from page 1 finds no enabled control before it (prev disabled).
    const page1 = controls.find((c) => c.getAttribute('data-value') === '1')!
    page1.focus()
    const ev = press(page1, 'ArrowLeft')
    expect(ev.defaultPrevented).toBe(false)
    expect(document.activeElement?.getAttribute('data-value')).toBe('1')
    document.body.removeChild(root)
  })

  it('Enter/Space are left to native button behavior', () => {
    const { root, controls } = buildPagination({ pages: [1, 2, 3] })
    const page2 = controls.find((c) => c.getAttribute('data-value') === '2')!
    page2.focus()
    const enter = press(page2, 'Enter')
    const space = press(page2, ' ')
    expect(enter.defaultPrevented).toBe(false)
    expect(space.defaultPrevented).toBe(false)
    // Focus did not move.
    expect(document.activeElement?.getAttribute('data-value')).toBe('2')
    document.body.removeChild(root)
  })
})

describe('pagination roving focus (RTL)', () => {
  // Same markup as the LTR roving block, but focus is driven through the
  // `connect()`-produced `onKeyDown`, which routes the flip through the `dir`
  // stored in State (the single source of truth `flipArrow` consumes).
  function buildPagination(pages: number[]): {
    root: HTMLElement
    controls: HTMLButtonElement[]
  } {
    const root = document.createElement('nav')
    root.setAttribute('data-scope', 'pagination')
    root.setAttribute('data-part', 'root')
    const prev = document.createElement('button')
    prev.setAttribute('data-scope', 'pagination')
    prev.setAttribute('data-part', 'prev-trigger')
    root.appendChild(prev)
    for (const page of pages) {
      const btn = document.createElement('button')
      btn.setAttribute('data-scope', 'pagination')
      btn.setAttribute('data-part', 'item')
      btn.setAttribute('data-value', String(page))
      root.appendChild(btn)
    }
    const next = document.createElement('button')
    next.setAttribute('data-scope', 'pagination')
    next.setAttribute('data-part', 'next-trigger')
    root.appendChild(next)
    document.body.appendChild(root)
    const controls = Array.from(root.querySelectorAll<HTMLButtonElement>('button:not([disabled])'))
    return { root, controls }
  }

  function pressVia(
    onKeyDown: (e: KeyboardEvent) => void,
    el: HTMLElement,
    key: string,
  ): KeyboardEvent {
    const ev = new KeyboardEvent('keydown', { key, cancelable: true })
    Object.defineProperty(ev, 'currentTarget', { value: el, writable: false })
    onKeyDown(ev)
    return ev
  }

  it('ltr: ArrowRight moves to the next control (unchanged)', () => {
    const p = connect(signalOf(init({ total: 30, pageSize: 10, page: 2, dir: 'ltr' })), vi.fn())
    const { root, controls } = buildPagination([1, 2, 3])
    const page2 = controls.find((c) => c.getAttribute('data-value') === '2')!
    page2.focus()
    pressVia(p.item(2).onKeyDown, page2, 'ArrowRight')
    expect(document.activeElement?.getAttribute('data-value')).toBe('3')
    document.body.removeChild(root)
  })

  it('rtl: ArrowRight moves to the PREVIOUS control (flipped)', () => {
    const p = connect(signalOf(init({ total: 30, pageSize: 10, page: 2, dir: 'rtl' })), vi.fn())
    const { root, controls } = buildPagination([1, 2, 3])
    const page2 = controls.find((c) => c.getAttribute('data-value') === '2')!
    page2.focus()
    const ev = pressVia(p.item(2).onKeyDown, page2, 'ArrowRight')
    expect(ev.defaultPrevented).toBe(true)
    expect(document.activeElement?.getAttribute('data-value')).toBe('1')
    document.body.removeChild(root)
  })

  it('rtl: ArrowLeft moves to the NEXT control (flipped)', () => {
    const p = connect(signalOf(init({ total: 30, pageSize: 10, page: 2, dir: 'rtl' })), vi.fn())
    const { root, controls } = buildPagination([1, 2, 3])
    const page2 = controls.find((c) => c.getAttribute('data-value') === '2')!
    page2.focus()
    pressVia(p.item(2).onKeyDown, page2, 'ArrowLeft')
    expect(document.activeElement?.getAttribute('data-value')).toBe('3')
    document.body.removeChild(root)
  })

  it('rtl: Home/End are NOT flipped', () => {
    const p = connect(signalOf(init({ total: 30, pageSize: 10, page: 2, dir: 'rtl' })), vi.fn())
    const { root, controls } = buildPagination([1, 2, 3])
    const page2 = controls.find((c) => c.getAttribute('data-value') === '2')!
    page2.focus()
    pressVia(p.item(2).onKeyDown, page2, 'Home')
    expect(document.activeElement?.getAttribute('data-part')).toBe('prev-trigger')
    pressVia(p.nextTrigger.onKeyDown, document.activeElement as HTMLElement, 'End')
    expect(document.activeElement?.getAttribute('data-part')).toBe('next-trigger')
    document.body.removeChild(root)
  })
})
