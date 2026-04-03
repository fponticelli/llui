import { describe, it, expect } from 'vitest'
import { mountApp } from '../src/mount'
import { each, text, component } from '../src/index'
import { elTemplate } from '../src/el-template'
import { flush } from '../src/runtime'

describe('elTemplate', () => {
  it('clones a template and applies patch function to specific nodes', () => {
    type State = { items: Array<{ id: number; label: string }> }
    type Msg = never

    const def = component<State, Msg, never>({
      name: 'TemplateTest',
      init: () => [{ items: [{ id: 1, label: 'one' }, { id: 2, label: 'two' }] }, []],
      update: (s) => [s, []],
      view: () =>
        each<State, { id: number; label: string }>({
          items: (s) => s.items,
          key: (t) => t.id,
          render: (item) => [
            elTemplate(
              '<tr><td class="col-md-1"></td><td class="col-md-4"><a></a></td></tr>',
              (root) => {
                const td1 = root.childNodes[0] as HTMLElement
                const a = (root.childNodes[1] as HTMLElement).childNodes[0] as HTMLElement

                td1.textContent = String(item((t) => t.id)())
                a.textContent = item((t) => t.label)()
              },
            ),
          ],
        }),
      __dirty: (o, n) => (Object.is(o.items, n.items) ? 0 : 1),
    })

    const container = document.createElement('div')
    mountApp(container, def)

    const rows = container.querySelectorAll('tr')
    expect(rows.length).toBe(2)
    expect(rows[0]!.querySelector('td')!.textContent).toBe('1')
    expect(rows[0]!.querySelector('a')!.textContent).toBe('one')
    expect(rows[1]!.querySelector('td')!.textContent).toBe('2')
    expect(rows[1]!.querySelector('a')!.textContent).toBe('two')
  })

  it('reuses the same template element across multiple clones', () => {
    const html = '<div class="test"><span></span></div>'
    const nodes: HTMLElement[] = []

    type State = { items: number[] }
    const def = component<State, never, never>({
      name: 'ReuseTest',
      init: () => [{ items: [1, 2, 3] }, []],
      update: (s) => [s, []],
      view: () =>
        each<State, number>({
          items: (s) => s.items,
          key: (n) => n,
          render: (item) => [
            elTemplate(html, (root) => {
              nodes.push(root as HTMLElement)
              ;(root as HTMLElement).querySelector('span')!.textContent = String(item((n) => n)())
            }),
          ],
        }),
      __dirty: () => 1,
    })

    const container = document.createElement('div')
    mountApp(container, def)

    // All 3 nodes are different DOM elements (cloned, not shared)
    expect(nodes[0]).not.toBe(nodes[1])
    expect(nodes[1]).not.toBe(nodes[2])

    // But all have the same structure
    expect(nodes[0]!.className).toBe('test')
    expect(container.querySelectorAll('.test').length).toBe(3)
  })

  it('bind helper registers reactive bindings that update on state change', () => {
    type State = { items: Array<{ id: number; label: string }>; selected: number }
    type Msg = { type: 'select'; id: number }

    const def = component<State, Msg, never>({
      name: 'BindTest',
      init: () => [{ items: [{ id: 1, label: 'one' }, { id: 2, label: 'two' }], selected: 0 }, []],
      update: (s, msg) => {
        if (msg.type === 'select') return [{ ...s, selected: msg.id }, []]
        return [s, []]
      },
      view: (_s, send) =>
        each<State, { id: number; label: string }>({
          items: (s) => s.items,
          key: (t) => t.id,
          render: (item) => {
            const rowId = item((t) => t.id)()
            return [
              elTemplate(
                '<tr><td></td></tr>',
                (root, bind) => {
                  const td = root.childNodes[0] as HTMLElement
                  td.textContent = String(rowId)

                  // Click handler to trigger selection
                  ;(root as HTMLElement).onclick = () => {
                    send({ type: 'select', id: rowId })
                    flush()
                  }

                  // Register a class binding on the tr
                  bind(root, -1, 'class', 'class', ((s: State) =>
                    s.selected === rowId ? 'danger' : '') as (s: never) => unknown)

                  // Register a per-item text binding
                  const t = document.createTextNode(item((r) => r.label)())
                  td.appendChild(t)
                  bind(t, -1, 'text', undefined, item((r) => r.label) as (s: never) => unknown)
                },
              ),
            ]
          },
        }),
      __dirty: (o, n) =>
        (Object.is(o.items, n.items) ? 0 : 0b01) |
        (Object.is(o.selected, n.selected) ? 0 : 0b10),
    })

    const container = document.createElement('div')
    mountApp(container, def)

    // Initial state: no selection
    const rows = container.querySelectorAll('tr')
    expect(rows[0]!.className).toBe('')
    expect(rows[1]!.className).toBe('')

    // Select row 1 via click
    ;(rows[0] as HTMLElement).click()
    expect(rows[0]!.className).toBe('danger')
    expect(rows[1]!.className).toBe('')

    // Select row 2 via click
    ;(rows[1] as HTMLElement).click()
    expect(rows[0]!.className).toBe('')
    expect(rows[1]!.className).toBe('danger')
  })
})
