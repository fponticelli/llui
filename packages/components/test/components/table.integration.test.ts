import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { component, mountApp, div, text } from '@llui/dom'
import { table, type TableState, type TableMsg } from '../../src/components/table'

type S = { t: TableState }

const COLS = [{ id: 'name' }, { id: 'age' }, { id: 'note' }]
const ROWS = ['r1', 'r2', 'r3']

function key(el: Element, k: string, mods: KeyboardEventInit = {}): void {
  el.dispatchEvent(
    new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...mods }),
  )
}

describe('table integration — grid cell DOM focus follows keyboard', () => {
  let app: ReturnType<typeof mountApp> | null = null
  let container: HTMLElement

  beforeEach(() => {
    document.body.innerHTML = ''
    container = document.createElement('div')
    document.body.appendChild(container)
  })
  afterEach(() => {
    app?.dispose()
    app = null
    document.body.innerHTML = ''
  })

  function mount() {
    const def = component<S, TableMsg, never>({
      name: 'T',
      init: () => [
        {
          t: table.init({ columns: COLS, rows: ROWS, focusedCell: { rowIndex: 0, colIndex: 0 } }),
        },
        [],
      ],
      update: (s, m) => [{ t: table.update(s.t, m)[0] }, []],
      view: ({ state, send }) => {
        const parts = table.connect(state.at('t'), send, { id: 'tbl' })
        return [
          div(
            { ...parts.root },
            ROWS.map((id, rowIndex) =>
              div(
                { ...parts.row(id, rowIndex) },
                COLS.map((_c, colIndex) =>
                  div({ ...parts.cell(rowIndex, colIndex) }, [text(`${rowIndex},${colIndex}`)]),
                ),
              ),
            ),
          ),
        ]
      },
    })
    app = mountApp(container, def)
  }

  const cell = (r: number, c: number): HTMLElement =>
    container.querySelector(
      `[data-part="cell"][data-row-index="${r}"][data-col-index="${c}"]`,
    ) as HTMLElement

  it('ArrowRight moves DOM focus to the next column', () => {
    mount()
    cell(0, 0).focus()
    key(cell(0, 0), 'ArrowRight')
    expect(document.activeElement).toBe(cell(0, 1))
  })

  it('ArrowDown moves DOM focus to the next row', () => {
    mount()
    cell(0, 0).focus()
    key(cell(0, 0), 'ArrowDown')
    expect(document.activeElement).toBe(cell(1, 0))
  })

  it('End moves DOM focus to the last column of the row', () => {
    mount()
    cell(0, 0).focus()
    key(cell(0, 0), 'End')
    expect(document.activeElement).toBe(cell(0, 2))
  })

  it('Ctrl+End moves DOM focus to the last cell of the grid', () => {
    mount()
    cell(0, 0).focus()
    key(cell(0, 0), 'End', { ctrlKey: true })
    expect(document.activeElement).toBe(cell(2, 2))
  })
})
