import { afterEach, describe, expect, it } from 'vitest'
import { component, mountApp, text, type Mountable } from '@llui/dom'
import * as table from '@llui/components/table'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../llui/ui/table'

const COLUMNS = [{ id: 'name', sortable: true }, { id: 'status' }]
const ROWS = ['alpha', 'beta']
let app: ReturnType<typeof mountApp> | null = null

afterEach(() => {
  app?.dispose()
  app = null
  document.body.innerHTML = ''
})

function mount(): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  const definition = component<{ table: table.TableState }, table.TableMsg>({
    name: 'RegistryTableMachine',
    init: () => [{ table: table.init({ columns: COLUMNS, rows: ROWS }) }, []],
    update: (state, msg) => [{ table: table.update(state.table, msg)[0] }, []],
    view: ({ state, send }): readonly Mountable[] => {
      const parts = table.connect(state.at('table'), send, { id: 'registry-table' })
      return [
        Table(
          { ...parts.root },
          [
            TableHeader([
              TableRow(
                COLUMNS.map((column) =>
                  TableHead({ ...parts.columnHeader(column.id) }, [text(column.id)]),
                ),
              ),
            ]),
            TableBody(
              ROWS.map((row, rowIndex) =>
                TableRow(
                  { ...parts.row(row, rowIndex) },
                  COLUMNS.map((_column, colIndex) =>
                    TableCell({ ...parts.cell(rowIndex, colIndex) }, [
                      text(`${rowIndex}:${colIndex}`),
                    ]),
                  ),
                ),
              ),
            ),
          ],
          { viewport: parts.viewport },
        ),
      ]
    },
  })
  app = mountApp(host, definition)
  return host
}

const cell = (host: HTMLElement, row: number, column: number): HTMLTableCellElement =>
  host.querySelector(
    `[data-part="cell"][data-row-index="${row}"][data-col-index="${column}"]`,
  ) as HTMLTableCellElement
const head = (host: HTMLElement, column: number): HTMLTableCellElement =>
  host.querySelector(
    `[data-part="column-header"][data-col-index="${column}"]`,
  ) as HTMLTableCellElement
const press = (element: Element, key: string): void => {
  element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
}

describe('registry table consumes the machine roving-focus contract', () => {
  it('spreads coordinates and maintains exactly one real tab stop', () => {
    const host = mount()
    const root = host.querySelector('[data-part="root"]')!
    expect(root.tagName).toBe('TABLE')
    expect(root.parentElement?.getAttribute('data-part')).toBe('viewport')
    expect(host.querySelectorAll('[data-part="viewport"]')).toHaveLength(1)
    expect([...host.querySelectorAll('[tabindex="0"]')]).toEqual([cell(host, 0, 0)])
    expect(head(host, 0).getAttribute('data-row-index')).toBe('-1')
    expect(cell(host, 0, 0).getAttribute('role')).toBe('gridcell')
  })

  it('moves actual focus through cell and header stops', () => {
    const host = mount()
    cell(host, 0, 0).focus()
    press(cell(host, 0, 0), 'ArrowUp')
    expect(document.activeElement).toBe(head(host, 0))
    expect([...host.querySelectorAll('[tabindex="0"]')]).toEqual([head(host, 0)])

    press(head(host, 0), 'ArrowRight')
    expect(document.activeElement).toBe(head(host, 1))
    press(head(host, 1), 'ArrowDown')
    expect(document.activeElement).toBe(cell(host, 0, 1))
    expect([...host.querySelectorAll('[tabindex="0"]')]).toEqual([cell(host, 0, 1)])
  })
})
