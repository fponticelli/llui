import { afterEach, describe, expect, it } from 'vitest'
import {
  component,
  each,
  mountApp,
  table as tableEl,
  tbody,
  td,
  text,
  tr,
  type Mountable,
} from '@llui/dom'
import * as table from '../../src/components/table'

interface State {
  table: table.TableState
}
type Msg = { type: 'table'; msg: table.TableMsg }

let app: ReturnType<typeof mountApp<State, Msg>> | null = null

afterEach(() => {
  app?.dispose()
  app = null
  document.body.replaceChildren()
})

function mount(rows: string[]): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  app = mountApp(
    host,
    component<State, Msg>({
      name: 'ReactiveIndexTableFixture',
      init: () => [
        { table: table.init({ columns: [{ id: 'name' }], rows, selectionMode: 'multiple' }) },
        [],
      ],
      update: (state, msg) => [{ table: table.update(state.table, msg.msg)[0] }, []],
      view: ({ state, send }): readonly Mountable[] => {
        const parts = table.connect(state.at('table'), (m) => send({ type: 'table', msg: m }), {
          id: 't',
        })
        return [
          tableEl({ ...parts.root }, [
            tbody([
              // A keyed `each` over the machine's own row-id order: rows are
              // REUSED (moved, not rebuilt) on reorder, so `index` is passed
              // straight through as the row's reactive Signal handle — never
              // `.peek()`'d — matching the shape a real sortable table takes.
              each(state.at('table.rows'), {
                key: (id) => id,
                render: (idSignal, index) => {
                  const id = idSignal.peek()
                  return [
                    tr({ ...parts.row(id, index) }, [td({ ...parts.cell(index, 0) }, [text(id)])]),
                  ]
                },
              }),
            ]),
          ]),
        ]
      },
    }),
  )
  return host
}

const rowEl = (host: HTMLElement, id: string): HTMLElement =>
  host.querySelector(`[data-part="row"][data-row="${id}"]`) as HTMLElement

describe('table row/cell index stays live across reorder (not frozen at build time)', () => {
  it('updates aria-rowindex and data-row-index in place when rows are reordered', () => {
    const host = mount(['r1', 'r2', 'r3'])
    const r1 = rowEl(host, 'r1')
    expect(r1.getAttribute('aria-rowindex')).toBe('2') // index 0 -> 0 + 2
    const r1Cell = r1.querySelector('[data-part="cell"]') as HTMLElement
    expect(r1Cell.dataset['rowIndex']).toBe('0')

    // Reorder: r1 moves from index 0 to index 1. `each` REUSES r1's row (it is
    // still the identical DOM node), so a build-time-frozen index would leave
    // aria-rowindex/data-row-index stuck at their original values.
    app!.send({ type: 'table', msg: { type: 'setRows', rows: ['r3', 'r1', 'r2'] } })

    const r1After = rowEl(host, 'r1')
    expect(r1After).toBe(r1) // same node: each reused it rather than rebuilding
    expect(r1After.getAttribute('aria-rowindex')).toBe('3') // now index 1 -> 1 + 2
    const r1CellAfter = r1After.querySelector('[data-part="cell"]') as HTMLElement
    expect(r1CellAfter.dataset['rowIndex']).toBe('1')
  })

  it("dispatches the row's CURRENT index, not the one it was built with, after reorder", () => {
    const host = mount(['r1', 'r2', 'r3'])
    app!.send({ type: 'table', msg: { type: 'setRows', rows: ['r3', 'r1', 'r2'] } })

    // r1 is now at index 1. Clicking its row must select it AND set the
    // range-selection anchor to its CURRENT index (1), not the stale build-time
    // index (0) — a frozen index would corrupt the next Shift+click's range.
    rowEl(host, 'r1').click()

    expect(app!.getState().table.selection).toEqual(['r1'])
    expect(app!.getState().table.rangeAnchor).toBe(1)
  })
})
