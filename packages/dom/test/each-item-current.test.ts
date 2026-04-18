import { describe, it, expect } from 'vitest'
import { mountApp } from '../src/mount'
import { each } from '../src/primitives/each'
import { text } from '../src/primitives/text'
import { div, ul, li, span } from '../src/elements'
import type { ComponentDef } from '../src/types'

// Regression test for ItemAccessor<T>.current() — reading a primitive or
// whole-item value from the render bag without routing through the
// callable-with-selector form.

describe('ItemAccessor.current() — primitive T', () => {
  it('reads a primitive item directly', () => {
    type State = { numbers: number[] }
    const def: ComponentDef<State, never, never> = {
      name: 'Nums',
      init: () => [{ numbers: [10, 20, 30] }, []],
      update: (s) => [s, []],
      view: () => [
        ul(
          {},
          each<State, number, never>({
            items: (s) => s.numbers,
            key: (n) => n,
            render: ({ item }) => [
              li({ 'data-testid': 'num' }, [text(() => String(item.current()))]),
            ],
          }),
        ),
      ],
    }

    const container = document.createElement('div')
    const handle = mountApp(container, def)
    const cells = container.querySelectorAll('[data-testid="num"]')
    expect(Array.from(cells).map((c) => c.textContent)).toEqual(['10', '20', '30'])
    handle.dispose()
  })

  it('reads a string primitive', () => {
    type State = { tags: string[] }
    const def: ComponentDef<State, never, never> = {
      name: 'Tags',
      init: () => [{ tags: ['a', 'b', 'c'] }, []],
      update: (s) => [s, []],
      view: () => [
        div(
          {},
          each<State, string, never>({
            items: (s) => s.tags,
            key: (t) => t,
            render: ({ item }) => [span({ 'data-testid': 'tag' }, [text(() => item.current())])],
          }),
        ),
      ],
    }

    const container = document.createElement('div')
    const handle = mountApp(container, def)
    const tags = container.querySelectorAll('[data-testid="tag"]')
    expect(Array.from(tags).map((t) => t.textContent)).toEqual(['a', 'b', 'c'])
    handle.dispose()
  })
})

describe('ItemAccessor.current() — object T', () => {
  it('reads the whole object item', () => {
    type Item = { id: string; label: string }
    type State = { items: Item[] }
    const def: ComponentDef<State, never, never> = {
      name: 'Items',
      init: () => [{ items: [{ id: '1', label: 'one' }] }, []],
      update: (s) => [s, []],
      view: () => [
        div(
          {},
          each<State, Item, never>({
            items: (s) => s.items,
            key: (i) => i.id,
            render: ({ item }) => [
              span({ 'data-testid': 'row' }, [
                text(() => `${item.current().id}:${item.current().label}`),
              ]),
            ],
          }),
        ),
      ],
    }

    const container = document.createElement('div')
    const handle = mountApp(container, def)
    const row = container.querySelector('[data-testid="row"]')
    expect(row?.textContent).toBe('1:one')
    handle.dispose()
  })
})
