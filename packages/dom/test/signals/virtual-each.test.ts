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
