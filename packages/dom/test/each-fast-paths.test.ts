import { describe, it, expect, vi } from 'vitest'
import { mountApp } from '../src/mount'
import { each } from '../src/primitives/each'
import { text } from '../src/primitives/text'
import { div } from '../src/elements'
import type { ComponentDef } from '../src/types'

type Item = { id: string; label: string }
type State = { items: Item[] }
type Msg = { type: 'setItems'; items: Item[] }

function listDef(initial: Item[]): ComponentDef<State, Msg, never> {
  return {
    name: 'List',
    init: () => [{ items: initial }, []],
    update: (state, msg) => {
      switch (msg.type) {
        case 'setItems':
          return [{ items: msg.items }, []]
      }
    },
    view: () =>
      each<State, Item>({
        items: (s) => s.items,
        key: (item) => item.id,
        render: (item) => [
          div({ 'data-id': item((t) => t.id) }, [text(item((t) => t.label))]),
        ],
      }),
    __dirty: (o, n) => (Object.is(o.items, n.items) ? 0 : 1),
  }
}

function getIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-id]')).map(
    (el) => el.getAttribute('data-id')!,
  )
}

function mount(items: Item[]) {
  let sendFn!: (msg: Msg) => void
  const def = listDef(items)
  const origView = def.view
  def.view = (state, send) => {
    sendFn = send
    return origView(state, send)
  }
  const container = document.createElement('div')
  const handle = mountApp(container, def)
  return { container, handle, send: sendFn }
}

const items3: Item[] = [
  { id: '1', label: 'one' },
  { id: '2', label: 'two' },
  { id: '3', label: 'three' },
]

describe('same-ref skip', () => {
  it('does no DOM work when array reference is unchanged', () => {
    const { container, handle, send } = mount(items3)
    const node1 = container.querySelector('[data-id="1"]')!

    // Send the same array reference
    send({ type: 'setItems', items: items3 })
    handle.flush()

    expect(getIds(container)).toEqual(['1', '2', '3'])
    expect(container.querySelector('[data-id="1"]')).toBe(node1)
  })
})

describe('append-only', () => {
  it('appends without touching existing nodes', () => {
    const { container, handle, send } = mount(items3)
    const node1 = container.querySelector('[data-id="1"]')!
    const node2 = container.querySelector('[data-id="2"]')!
    const node3 = container.querySelector('[data-id="3"]')!

    send({
      type: 'setItems',
      items: [...items3, { id: '4', label: 'four' }, { id: '5', label: 'five' }],
    })
    handle.flush()

    expect(getIds(container)).toEqual(['1', '2', '3', '4', '5'])
    // Existing nodes must be the same DOM objects
    expect(container.querySelector('[data-id="1"]')).toBe(node1)
    expect(container.querySelector('[data-id="2"]')).toBe(node2)
    expect(container.querySelector('[data-id="3"]')).toBe(node3)
  })
})

describe('two-element swap', () => {
  it('swaps two items with minimal DOM moves', () => {
    const { container, handle, send } = mount(items3)
    const node1 = container.querySelector('[data-id="1"]')!
    const node2 = container.querySelector('[data-id="2"]')!
    const node3 = container.querySelector('[data-id="3"]')!

    // Swap 1 ↔ 3
    send({
      type: 'setItems',
      items: [items3[2]!, items3[1]!, items3[0]!],
    })
    handle.flush()

    expect(getIds(container)).toEqual(['3', '2', '1'])
    // Same DOM nodes, just reordered
    expect(container.querySelector('[data-id="1"]')).toBe(node1)
    expect(container.querySelector('[data-id="2"]')).toBe(node2)
    expect(container.querySelector('[data-id="3"]')).toBe(node3)
  })

  it('swap on 1k list preserves all nodes', () => {
    const bigItems = Array.from({ length: 1000 }, (_, i) => ({
      id: String(i),
      label: `item ${i}`,
    }))
    const { container, handle, send } = mount(bigItems)

    const node1 = container.querySelector('[data-id="1"]')!
    const node998 = container.querySelector('[data-id="998"]')!

    const swapped = bigItems.slice()
    const tmp = swapped[1]!
    swapped[1] = swapped[998]!
    swapped[998] = tmp

    send({ type: 'setItems', items: swapped })
    handle.flush()

    const ids = getIds(container)
    expect(ids[1]).toBe('998')
    expect(ids[998]).toBe('1')
    expect(container.querySelector('[data-id="1"]')).toBe(node1)
    expect(container.querySelector('[data-id="998"]')).toBe(node998)
  })
})

describe('bulk clear', () => {
  it('clears all items efficiently', () => {
    const { container, handle, send } = mount(items3)
    expect(getIds(container)).toEqual(['1', '2', '3'])

    send({ type: 'setItems', items: [] })
    handle.flush()

    expect(getIds(container)).toEqual([])
  })
})

describe('detectSwap edge cases', () => {
  it('falls back to general path when 3+ positions differ', () => {
    const { container, handle, send } = mount(items3)

    // Reverse all 3 — 3 positions differ, not a swap
    send({
      type: 'setItems',
      items: [items3[2]!, items3[0]!, items3[1]!],
    })
    handle.flush()

    expect(getIds(container)).toEqual(['3', '1', '2'])
  })

  it('falls back when 2 positions differ but keys are not exchanged', () => {
    const items4: Item[] = [
      { id: '1', label: 'one' },
      { id: '2', label: 'two' },
      { id: '3', label: 'three' },
      { id: '4', label: 'four' },
    ]
    const { container, handle, send } = mount(items4)

    // Positions 1 and 2 differ but keys rotate (2→3, 3→4) — not a swap
    send({
      type: 'setItems',
      items: [
        { id: '1', label: 'one' },
        { id: '3', label: 'three' },
        { id: '4', label: 'four' },
        { id: '2', label: 'two' },
      ],
    })
    handle.flush()

    expect(getIds(container)).toEqual(['1', '3', '4', '2'])
  })
})

describe('survivors in order — batch insert new entries between survivors', () => {
  it('inserts new items between existing ones without full rebuild', () => {
    const { container, handle, send } = mount(items3)
    const node1 = container.querySelector('[data-id="1"]')!
    const node2 = container.querySelector('[data-id="2"]')!
    const node3 = container.querySelector('[data-id="3"]')!

    // Insert new items between existing survivors (order preserved)
    send({
      type: 'setItems',
      items: [
        items3[0]!,
        { id: 'a', label: 'alpha' },
        items3[1]!,
        { id: 'b', label: 'beta' },
        items3[2]!,
      ],
    })
    handle.flush()

    expect(getIds(container)).toEqual(['1', 'a', '2', 'b', '3'])
    // Original nodes preserved
    expect(container.querySelector('[data-id="1"]')).toBe(node1)
    expect(container.querySelector('[data-id="2"]')).toBe(node2)
    expect(container.querySelector('[data-id="3"]')).toBe(node3)
  })

  it('appends new items after all survivors', () => {
    const items2: Item[] = [
      { id: '1', label: 'one' },
      { id: '3', label: 'three' },
    ]
    const { container, handle, send } = mount(items3)
    const node1 = container.querySelector('[data-id="1"]')!
    const node3 = container.querySelector('[data-id="3"]')!

    // Remove item 2, add new item at end — survivors (1, 3) stay in order
    send({
      type: 'setItems',
      items: [
        items3[0]!,
        items3[2]!,
        { id: 'c', label: 'gamma' },
      ],
    })
    handle.flush()

    expect(getIds(container)).toEqual(['1', '3', 'c'])
    expect(container.querySelector('[data-id="1"]')).toBe(node1)
    expect(container.querySelector('[data-id="3"]')).toBe(node3)
  })
})
