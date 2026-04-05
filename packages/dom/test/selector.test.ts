import { describe, it, expect } from 'vitest'
import { mountApp, component, div, text, each, flush, selector } from '../src/index'

describe('selector()', () => {
  type State = { items: Array<{ id: number; label: string }>; selected: number }
  type Msg = { type: 'select'; id: number } | { type: 'updateLabel'; id: number; label: string }

  function createApp() {
    let sendFn: (msg: Msg) => void

    const App = component<State, Msg, never>({
      name: 'SelectorTest',
      init: () => [
        {
          items: [
            { id: 1, label: 'one' },
            { id: 2, label: 'two' },
            { id: 3, label: 'three' },
          ],
          selected: 0,
        },
        [],
      ],
      update: (s, msg) => {
        switch (msg.type) {
          case 'select':
            return [{ ...s, selected: msg.id }, []]
          case 'updateLabel':
            return [
              {
                ...s,
                items: s.items.map((i) => (i.id === msg.id ? { ...i, label: msg.label } : i)),
              },
              [],
            ]
        }
      },
      view: ({ send }) => {
        sendFn = send
        const sel = selector<State, number>((s) => s.selected)

        return each<State, { id: number; label: string }, Msg>({
          items: (s) => s.items,
          key: (i) => i.id,
          render: ({ item, send }) => {
            const rowId = item((i) => i.id)()
            const el = div({ class: 'row' }, [text(item((i) => i.label))])
            sel.bind(el, rowId, 'class', 'class', (match) => (match ? 'row selected' : 'row'))
            return [el]
          },
        })
      },
      __dirty: (o, n) =>
        (Object.is(o.items, n.items) ? 0 : 0b01) | (Object.is(o.selected, n.selected) ? 0 : 0b10),
    })

    const container = document.createElement('div')
    mountApp(container, App)
    return { container, send: () => sendFn }
  }

  it('applies initial class based on selected state', () => {
    const { container } = createApp()
    const rows = container.querySelectorAll('.row')
    expect(rows.length).toBe(3)
    // None selected initially (selected = 0, no matching id)
    for (const row of rows) {
      expect(row.className).toBe('row')
    }
  })

  it('selects a row — only that row gets the selected class', () => {
    const { container, send } = createApp()
    send()({ type: 'select', id: 2 })
    flush()

    const rows = container.querySelectorAll('[class]')
    const classes = [...rows].map((r) => r.className)
    expect(classes).toEqual(['row', 'row selected', 'row'])
  })

  it('switching selection updates only 2 rows (old and new)', () => {
    const { container, send } = createApp()

    // Select row 1
    send()({ type: 'select', id: 1 })
    flush()
    expect(container.querySelector('.row')!.className).toBe('row selected')

    // Switch to row 3
    send()({ type: 'select', id: 3 })
    flush()
    const rows = container.querySelectorAll('[class]')
    const classes = [...rows].map((r) => r.className)
    expect(classes).toEqual(['row', 'row', 'row selected'])
  })

  it('deselecting (setting to non-existent id) clears the class', () => {
    const { container, send } = createApp()
    send()({ type: 'select', id: 1 })
    flush()
    expect(container.querySelector('.row')!.className).toBe('row selected')

    send()({ type: 'select', id: 999 })
    flush()
    const rows = container.querySelectorAll('[class]')
    const classes = [...rows].map((r) => r.className)
    expect(classes).toEqual(['row', 'row', 'row'])
  })
})
