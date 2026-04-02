import { describe, it, expect } from 'vitest'
import { mountApp } from '../packages/core/src/mount'
import { div, span, button } from '../packages/core/src/elements'
import { text } from '../packages/core/src/primitives/text'
import { each } from '../packages/core/src/primitives/each'
import { component } from '../packages/core/src/component'
import type { ComponentDef } from '../packages/core/src/types'

type Item = { id: string; label: string; done: boolean }

function makeItems(n: number): Item[] {
  return Array.from({ length: n }, (_, i) => ({
    id: String(i),
    label: `Item ${i}`,
    done: i % 3 === 0,
  }))
}

type ListState = { items: Item[]; selected: string | null }
type ListMsg =
  | { type: 'setItems'; items: Item[] }
  | { type: 'select'; id: string }
  | { type: 'updateLabel'; id: string; label: string }
  | { type: 'append'; item: Item }
  | { type: 'remove'; id: string }

function listDef(initial: Item[]): ComponentDef<ListState, ListMsg, never> {
  return component({
    name: 'List',
    init: () => [{ items: initial, selected: null }, []],
    update: (state, msg) => {
      switch (msg.type) {
        case 'setItems':
          return [{ ...state, items: msg.items }, []]
        case 'select':
          return [{ ...state, selected: msg.id }, []]
        case 'updateLabel':
          return [
            {
              ...state,
              items: state.items.map((i) =>
                i.id === msg.id ? { ...i, label: msg.label } : i,
              ),
            },
            [],
          ]
        case 'append':
          return [{ ...state, items: [...state.items, msg.item] }, []]
        case 'remove':
          return [{ ...state, items: state.items.filter((i) => i.id !== msg.id) }, []]
      }
    },
    view: (_state, send) => [
      div({ class: 'list' }, [
        ...each<ListState, Item>({
          items: (s) => s.items,
          key: (item) => item.id,
          render: (item) => [
            div(
              {
                class: item((t) => (t.done ? 'done' : '')),
                'data-id': item((t) => t.id),
              },
              [
                span({}, [text(item((t) => t.label))]),
                button({ onClick: () => send({ type: 'remove', id: item((t) => t.id)() }) }, [
                  text('x'),
                ]),
              ],
            ),
          ],
        }),
      ]),
    ],
    __dirty: (o, n) =>
      (Object.is(o.items, n.items) ? 0 : 0b01) |
      (Object.is(o.selected, n.selected) ? 0 : 0b10),
  })
}

function mountList(n: number) {
  let sendFn!: (msg: ListMsg) => void
  const def = listDef(makeItems(n))
  const origView = def.view
  def.view = (state, send) => {
    sendFn = send
    return origView(state, send)
  }
  const container = document.createElement('div')
  const handle = mountApp(container, def)
  return { container, handle, send: sendFn }
}

function measure(name: string, runs: number, fn: () => void): number {
  // warmup
  for (let i = 0; i < 3; i++) fn()

  const times: number[] = []
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now()
    fn()
    times.push(performance.now() - t0)
  }

  times.sort((a, b) => a - b)
  const median = times[Math.floor(times.length / 2)]!
  const min = times[0]!
  const p95 = times[Math.floor(times.length * 0.95)]!

  console.log(
    `  ${name.padEnd(40)} min=${min.toFixed(2)}ms  median=${median.toFixed(2)}ms  p95=${p95.toFixed(2)}ms`,
  )

  return median
}

describe('runtime benchmarks', () => {
  it('reports performance numbers', () => {
    console.log('\n=== Runtime Performance (jsdom, 10 runs) ===\n')

    measure('mount 1,000 rows', 10, () => {
      const container = document.createElement('div')
      const handle = mountApp(container, listDef(makeItems(1000)))
      handle.dispose()
    })

    measure('mount 100 rows', 10, () => {
      const container = document.createElement('div')
      const handle = mountApp(container, listDef(makeItems(100)))
      handle.dispose()
    })

    const list1k = mountList(1000)
    let updateCounter = 0

    measure('update every 10th row (1k)', 10, () => {
      updateCounter++
      for (let j = 0; j < 1000; j += 10) {
        list1k.send({ type: 'updateLabel', id: String(j), label: `U${updateCounter}-${j}` })
      }
      list1k.handle.flush()
    })

    measure('select one row (1k)', 10, () => {
      list1k.send({ type: 'select', id: '500' })
      list1k.handle.flush()
    })

    measure('append 1 row (1k)', 10, () => {
      list1k.send({ type: 'append', item: { id: `new-${Date.now()}`, label: 'new', done: false } })
      list1k.handle.flush()
    })

    measure('remove 1 row (1k)', 10, () => {
      list1k.send({ type: 'remove', id: '0' })
      list1k.handle.flush()
    })

    list1k.handle.dispose()

    const list1kFresh = mountList(1000)

    measure('replace all 1,000 rows', 10, () => {
      list1kFresh.send({ type: 'setItems', items: makeItems(1000) })
      list1kFresh.handle.flush()
    })

    measure('clear 1,000 rows', 10, () => {
      list1kFresh.send({ type: 'setItems', items: [] })
      list1kFresh.handle.flush()
      list1kFresh.send({ type: 'setItems', items: makeItems(1000) })
      list1kFresh.handle.flush()
    })

    list1kFresh.handle.dispose()

    console.log()
    expect(true).toBe(true)
  })
})
