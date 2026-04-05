import { describe, it, expect } from 'vitest'
import { mountApp } from '../src/mount'
import { div, span, button, text, each } from '../src/index'
import { component } from '../src/component'

describe('select performance — only 2 rows should update', () => {
  type Item = { id: number; label: string }
  type State = { items: Item[]; selected: number | null }
  type Msg = { type: 'select'; id: number }

  it('correctly updates selected class on two rows', () => {
    const items = Array.from({ length: 100 }, (_, i) => ({ id: i, label: `item ${i}` }))

    let sendFn: (msg: Msg) => void

    const def = component<State, Msg, never>({
      name: 'SelectTest',
      init: () => [{ items, selected: null }, []],
      update: (state, msg) => {
        switch (msg.type) {
          case 'select':
            return [{ ...state, selected: msg.id }, []]
        }
      },
      view: ({ send }) => {
        sendFn = send
        return each<State, Item>({
          items: (s) => s.items,
          key: (item) => item.id,
          render: ({ item }) => [
            div(
              {
                'data-id': item((t) => String(t.id)),
                class: (s: State) => (s.selected === item((t) => t.id)() ? 'selected' : ''),
              },
              [text(item((t) => t.label))],
            ),
          ],
        })
      },
      __dirty: (o, n) =>
        (Object.is(o.items, n.items) ? 0 : 0b01) | (Object.is(o.selected, n.selected) ? 0 : 0b10),
    })

    const container = document.createElement('div')
    const handle = mountApp(container, def)

    // Select item 5
    sendFn!({ type: 'select', id: 5 })
    handle.flush()

    expect(container.querySelector('[data-id="5"]')?.className).toBe('selected')
    expect(container.querySelector('[data-id="0"]')?.className).toBe('')

    // Select item 10 — item 5 loses selection
    sendFn!({ type: 'select', id: 10 })
    handle.flush()

    expect(container.querySelector('[data-id="5"]')?.className).toBe('')
    expect(container.querySelector('[data-id="10"]')?.className).toBe('selected')
  })
})
