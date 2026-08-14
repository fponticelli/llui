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

/**
 * #122 — the header row joins the roving sequence.
 *
 * `columnHeader` shipped an `onKeyDown` handling Enter/Space for sort but no
 * `tabindex`, so nothing could ever focus it: the sort control was
 * KEYBOARD-DEAD, and the select-all checkbox inside a header cell was
 * unreachable for the same reason. Arrowing up from row 0 now lands on the
 * header, which is the grid's single tab stop while it holds focus.
 */
describe('table integration — the header row is reachable by keyboard', () => {
  let app: ReturnType<typeof mountApp> | null = null
  let container: HTMLElement

  const HCOLS = [{ id: 'sel' }, { id: 'name', sortable: true }, { id: 'note' }]

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

  function mountWithHeader() {
    const def = component<S, TableMsg, never>({
      name: 'TH',
      init: () => [
        {
          t: table.init({
            columns: HCOLS,
            rows: ROWS,
            selectionMode: 'multiple',
            focusedCell: { rowIndex: 0, colIndex: 0 },
          }),
        },
        [],
      ],
      update: (s, m) => [{ t: table.update(s.t, m)[0] }, []],
      view: ({ state, send }) => {
        const parts = table.connect(state.at('t'), send, { id: 'tbl', selectAllColumnId: 'sel' })
        return [
          div({ ...parts.root }, [
            div(
              { role: 'row' },
              HCOLS.map((c) =>
                div({ ...parts.columnHeader(c.id) }, [
                  c.id === 'sel' ? div({ ...parts.selectAllCheckbox }, []) : text(c.id),
                ]),
              ),
            ),
            ...ROWS.map((id, rowIndex) =>
              div(
                { ...parts.row(id, rowIndex) },
                HCOLS.map((_c, colIndex) =>
                  div({ ...parts.cell(rowIndex, colIndex) }, [text(`${rowIndex},${colIndex}`)]),
                ),
              ),
            ),
          ]),
        ]
      },
    })
    app = mountApp(container, def)
  }

  const hcell = (r: number, c: number): HTMLElement =>
    container.querySelector(
      `[data-part="cell"][data-row-index="${r}"][data-col-index="${c}"]`,
    ) as HTMLElement
  const header = (c: number): HTMLElement =>
    container.querySelector(`[data-part="column-header"][data-col-index="${c}"]`) as HTMLElement
  const tabStops = (): Element[] => Array.from(container.querySelectorAll('[tabindex="0"]'))

  it('ArrowUp from the first data row moves DOM focus to the column header', () => {
    mountWithHeader()
    hcell(0, 1).focus()
    key(hcell(0, 1), 'ArrowUp')
    expect(document.activeElement).toBe(header(1))
  })

  it('the focused header is the grid ONE tab stop, and ArrowUp there stays put', () => {
    mountWithHeader()
    hcell(0, 1).focus()
    key(hcell(0, 1), 'ArrowUp')
    expect(tabStops()).toEqual([header(1)])
    key(header(1), 'ArrowUp')
    expect(document.activeElement).toBe(header(1))
    expect(tabStops()).toEqual([header(1)])
  })

  it('Enter on the reachable header sorts the column', () => {
    mountWithHeader()
    hcell(0, 1).focus()
    key(hcell(0, 1), 'ArrowUp')
    expect(document.activeElement).toBe(header(1))
    key(document.activeElement as Element, 'Enter')
    expect(header(1).getAttribute('aria-sort')).toBe('ascending')
  })

  it('Space on the reachable select-all header selects every row', () => {
    mountWithHeader()
    hcell(0, 0).focus()
    key(hcell(0, 0), 'ArrowUp')
    expect(document.activeElement).toBe(header(0))
    key(document.activeElement as Element, ' ')
    const checkbox = container.querySelector('[data-part="select-all"]') as HTMLElement
    expect(checkbox.getAttribute('aria-checked')).toBe('true')
  })

  it('ArrowDown from the header returns to the first data row', () => {
    mountWithHeader()
    hcell(0, 2).focus()
    key(hcell(0, 2), 'ArrowUp')
    expect(document.activeElement).toBe(header(2))
    key(header(2), 'ArrowDown')
    expect(document.activeElement).toBe(hcell(0, 2))
  })
})
