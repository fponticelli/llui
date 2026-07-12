import { describe, it, expect } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import { signalText, el, signalVirtualEach, type RowCtx } from '../../src/signals/dom'

interface Item {
  id: number
  label: string
}
interface S {
  items: Item[]
}
type M = { type: 'set'; items: Item[] }

const ITEM_HEIGHT = 20
const CONTAINER_HEIGHT = 100 // -> 5 fully-visible rows
const OVERSCAN = 3

function makeItems(n: number): Item[] {
  return Array.from({ length: n }, (_, i) => ({ id: i, label: `row-${i}` }))
}

function setup(n: number) {
  const container = document.createElement('div')
  const h = mountSignalComponent<S, M>(container, {
    init: () => ({ items: makeItems(n) }),
    update: (_s, m) => ({ items: m.items }),
    view: () => [
      signalVirtualEach<Item>({
        items: (s) => (s as S).items,
        deps: ['items'],
        key: (it) => it.id,
        itemHeight: ITEM_HEIGHT,
        containerHeight: CONTAINER_HEIGHT,
        overscan: OVERSCAN,
        class: 'vlist',
        renderRow: () => [
          el('div', { class: 'row' }, [
            signalText((ctx) => (ctx as RowCtx<Item>).item.label, ['item.label']),
          ]),
        ],
      }),
    ],
  })
  const scroll = container.querySelector('[data-virtual-container]') as HTMLElement
  const spacer = scroll.querySelector('[data-virtual-spacer]') as HTMLElement
  const rows = (): HTMLElement[] => [...scroll.querySelectorAll('.row')] as HTMLElement[]
  const labels = (): string[] => rows().map((r) => r.textContent ?? '')
  // jsdom doesn't lay out — scrollTop is a writable number, fine for our handler.
  const scrollTo = (top: number): void => {
    scroll.scrollTop = top
    scroll.dispatchEvent(new Event('scroll'))
  }
  return { container, h, scroll, spacer, rows, labels, scrollTo }
}

describe('signalVirtualEach — windowed list', () => {
  it('renders only the visible window, not every item', () => {
    const { rows, labels } = setup(1000)
    // visible window = ceil(containerHeight/itemHeight) + overscan*2 (clamped at top)
    const visible = Math.ceil(CONTAINER_HEIGHT / ITEM_HEIGHT) // 5
    const expectedMax = visible + OVERSCAN * 2 // 11
    expect(rows().length).toBeLessThanOrEqual(expectedMax)
    expect(rows().length).toBeLessThan(1000)
    // at scrollTop 0, the window starts at item 0
    expect(labels()[0]).toBe('row-0')
  })

  it('spacer height equals items.length * itemHeight', () => {
    const { spacer } = setup(1000)
    expect(spacer.style.height).toBe(`${1000 * ITEM_HEIGHT}px`)
  })

  it('windows new rows in when the container scrolls', () => {
    const { labels, scrollTo } = setup(1000)
    expect(labels()[0]).toBe('row-0')
    // scroll down 100 rows worth
    scrollTo(100 * ITEM_HEIGHT)
    // window now starts around item 100 (minus overscan)
    const first = labels()[0]!
    const firstIndex = Number(first.slice('row-'.length))
    expect(firstIndex).toBeGreaterThanOrEqual(100 - OVERSCAN)
    expect(firstIndex).toBeLessThanOrEqual(100)
    expect(labels()).toContain('row-100')
    expect(labels()).not.toContain('row-0')
  })

  it('re-windows + resizes the spacer when items change', () => {
    const { h, spacer, rows } = setup(1000)
    h.send({ type: 'set', items: makeItems(10) })
    expect(spacer.style.height).toBe(`${10 * ITEM_HEIGHT}px`)
    // only 10 items now -> all (<= window cap) render
    expect(rows().length).toBeLessThanOrEqual(10)
  })

  it('reuses row nodes by key across a scroll that keeps some visible', () => {
    const { rows, scrollTo } = setup(1000)
    const before = new Map<string, HTMLElement>()
    for (const r of rows()) before.set(r.textContent ?? '', r)
    // tiny scroll: most of the window stays
    scrollTo(ITEM_HEIGHT)
    for (const r of rows()) {
      const prev = before.get(r.textContent ?? '')
      if (prev) expect(r).toBe(prev) // same kept row node, not recreated
    }
  })

  it('disposes all rows when the component is disposed', () => {
    const { h, scroll, rows } = setup(1000)
    expect(rows().length).toBeGreaterThan(0)
    h.dispose()
    // dispose tears down the owned region's teardowns; rows are removed
    expect(scroll.querySelectorAll('.row').length).toBe(0)
  })

  it('handles an empty list (no rows, zero-height spacer)', () => {
    const { h, spacer, rows } = setup(1000)
    h.send({ type: 'set', items: [] })
    expect(rows().length).toBe(0)
    expect(spacer.style.height).toBe('0px')
  })
})

describe('signalVirtualEach — variable row heights (itemHeight function)', () => {
  interface VItem {
    id: number
    h: number
  }
  interface VS {
    items: VItem[]
  }
  type VM = { type: 'set'; items: VItem[] }

  // heights: 20,40,20,40,... → cumulative offsets 0,20,60,80,120,140,180,200,...
  const items = (n: number): VItem[] =>
    Array.from({ length: n }, (_, i) => ({ id: i, h: i % 2 === 0 ? 20 : 40 }))

  function setup(n: number) {
    const container = document.createElement('div')
    const h = mountSignalComponent<VS, VM>(container, {
      init: () => ({ items: items(n) }),
      update: (_s, m) => ({ items: m.items }),
      view: () => [
        signalVirtualEach<VItem>({
          items: (s) => (s as VS).items,
          deps: ['items'],
          key: (it) => it.id,
          itemHeight: (it) => it.h, // per-item height
          containerHeight: 100,
          overscan: 0, // deterministic window
          renderRow: () => [
            el('div', { class: 'row' }, [
              signalText((ctx) => String((ctx as RowCtx<VItem>).item.id), ['item.id']),
            ]),
          ],
        }),
      ],
    })
    const scroll = container.querySelector('[data-virtual-container]') as HTMLElement
    const spacer = scroll.querySelector('[data-virtual-spacer]') as HTMLElement
    const rowEls = (): HTMLElement[] => [...scroll.querySelectorAll('.row')] as HTMLElement[]
    const wrappers = (): HTMLElement[] =>
      [...scroll.querySelectorAll('[data-virtual-item]')] as HTMLElement[]
    const scrollTo = (top: number): void => {
      scroll.scrollTop = top
      scroll.dispatchEvent(new Event('scroll'))
    }
    return { container, h, scroll, spacer, rowEls, wrappers, scrollTo }
  }

  it('sizes the spacer to the sum of all row heights', () => {
    const { spacer } = setup(10) // 5*20 + 5*40 = 300
    expect(spacer.style.height).toBe('300px')
  })

  it('positions each visible row at its cumulative offset with its own height', () => {
    const { wrappers } = setup(10)
    // At scrollTop 0, containerHeight 100, overscan 0: rows 0..3 (row 3 top=80 < 100).
    const w = wrappers()
    expect(w.map((el) => el.getAttribute('data-virtual-key'))).toEqual(['0', '1', '2', '3'])
    expect(w[0]!.style.transform).toBe('translateY(0px)')
    expect(w[0]!.style.height).toBe('20px')
    expect(w[1]!.style.transform).toBe('translateY(20px)')
    expect(w[1]!.style.height).toBe('40px')
    expect(w[2]!.style.transform).toBe('translateY(60px)')
    expect(w[3]!.style.transform).toBe('translateY(80px)')
    expect(w[3]!.style.height).toBe('40px')
  })

  it('windows correctly when scrolled to a variable-height offset', () => {
    const { wrappers, scrollTo } = setup(10)
    // Scroll so the viewport top sits at offset 120 (start of row 4).
    scrollTo(120)
    const keys = wrappers().map((el) => el.getAttribute('data-virtual-key'))
    // row containing 120 is index 4 (offset 120); viewport bottom 220 → up to row 7
    // (offset 200 < 220, row 8 offset 240 ≥ 220). Window [4, 8).
    expect(keys).toEqual(['4', '5', '6', '7'])
  })
})
