import { describe, it, expect } from 'vitest'
import { mountApp } from '../src/mount'
import { each } from '../src/primitives/each'
import { text } from '../src/primitives/text'
import { div } from '../src/elements'
import type { ComponentDef } from '../src/types'

type Item = { id: string; label: string }
type State = { items: Item[] }
type Msg =
  | { type: 'setItems'; items: Item[] }
  | { type: 'append'; item: Item }
  | { type: 'remove'; id: string }
  | { type: 'updateLabel'; id: string; label: string }
  | { type: 'swap'; i: number; j: number }

function listDef(): ComponentDef<State, Msg, never> {
  return {
    name: 'List',
    init: () => [
      {
        items: [
          { id: '1', label: 'one' },
          { id: '2', label: 'two' },
          { id: '3', label: 'three' },
        ],
      },
      [],
    ],
    update: (state, msg) => {
      switch (msg.type) {
        case 'setItems':
          return [{ items: msg.items }, []]
        case 'append':
          return [{ items: [...state.items, msg.item] }, []]
        case 'remove':
          return [{ items: state.items.filter((i) => i.id !== msg.id) }, []]
        case 'updateLabel':
          return [
            {
              items: state.items.map((i) => (i.id === msg.id ? { ...i, label: msg.label } : i)),
            },
            [],
          ]
        case 'swap': {
          const items = [...state.items]
          const tmp = items[msg.i]!
          items[msg.i] = items[msg.j]!
          items[msg.j] = tmp
          return [{ items }, []]
        }
      }
    },
    view: () =>
      each<State, Item>({
        items: (s) => s.items,
        key: (item) => item.id,
        render: ({ item }) => [div({ 'data-id': item((t) => t.id) }, [text(item((t) => t.label))])],
      }),
    __dirty: (o, n) => (Object.is(o.items, n.items) ? 0 : 1),
  }
}

function getIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-id]')).map(
    (el) => el.getAttribute('data-id')!,
  )
}

function getLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-id]')).map((el) => el.textContent!)
}

describe('each()', () => {
  let sendFn: (msg: Msg) => void

  function mount() {
    const def = listDef()
    const origView = def.view
    def.view = (send) => {
      sendFn = send
      return origView(send)
    }
    const container = document.createElement('div')
    const handle = mountApp(container, def)
    return { container, handle }
  }

  it('renders the initial list', () => {
    const { container } = mount()
    expect(getIds(container)).toEqual(['1', '2', '3'])
    expect(getLabels(container)).toEqual(['one', 'two', 'three'])
  })

  it('appends a new item', () => {
    const { container, handle } = mount()
    sendFn({ type: 'append', item: { id: '4', label: 'four' } })
    handle.flush()
    expect(getIds(container)).toEqual(['1', '2', '3', '4'])
    expect(getLabels(container)).toEqual(['one', 'two', 'three', 'four'])
  })

  it('removes an item', () => {
    const { container, handle } = mount()
    sendFn({ type: 'remove', id: '2' })
    handle.flush()
    expect(getIds(container)).toEqual(['1', '3'])
  })

  it('preserves DOM nodes for unchanged items on append', () => {
    const { container, handle } = mount()
    const firstDiv = container.querySelector('[data-id="1"]')!
    sendFn({ type: 'append', item: { id: '4', label: 'four' } })
    handle.flush()
    // Same DOM node should be reused
    expect(container.querySelector('[data-id="1"]')).toBe(firstDiv)
  })

  it('swaps two items', () => {
    const { container, handle } = mount()
    const node1 = container.querySelector('[data-id="1"]')!
    const node3 = container.querySelector('[data-id="3"]')!
    sendFn({ type: 'swap', i: 0, j: 2 })
    handle.flush()
    expect(getIds(container)).toEqual(['3', '2', '1'])
    // DOM nodes should be the same objects, just reordered
    expect(container.querySelector('[data-id="1"]')).toBe(node1)
    expect(container.querySelector('[data-id="3"]')).toBe(node3)
  })

  it('updates a single item label without rebuilding others', () => {
    const { container, handle } = mount()
    const node1 = container.querySelector('[data-id="1"]')!
    const node3 = container.querySelector('[data-id="3"]')!
    sendFn({ type: 'updateLabel', id: '2', label: 'TWO' })
    handle.flush()
    expect(getLabels(container)).toEqual(['one', 'TWO', 'three'])
    // Other nodes untouched
    expect(container.querySelector('[data-id="1"]')).toBe(node1)
    expect(container.querySelector('[data-id="3"]')).toBe(node3)
  })

  it('replaces entire list', () => {
    const { container, handle } = mount()
    sendFn({
      type: 'setItems',
      items: [
        { id: 'a', label: 'alpha' },
        { id: 'b', label: 'beta' },
      ],
    })
    handle.flush()
    expect(getIds(container)).toEqual(['a', 'b'])
    expect(getLabels(container)).toEqual(['alpha', 'beta'])
  })

  it('clears all items', () => {
    const { container, handle } = mount()
    sendFn({ type: 'setItems', items: [] })
    handle.flush()
    expect(getIds(container)).toEqual([])
  })
})
