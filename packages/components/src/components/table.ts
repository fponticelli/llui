import { tagSend } from '@llui/dom'
import type { Send, Signal } from '@llui/dom'

/**
 * Table / data grid — a headless machine for sortable columns, row
 * selection, and APG grid keyboard navigation. It is NOT a rendering
 * engine: row DATA stays in the consumer; the machine tracks only row
 * IDs (in display order), sort state, the selected-id set, and the
 * focused cell coordinate. The consumer renders the grid (via `each` or
 * `virtualEach`) and performs the actual data sort — so server-side sort
 * works by feeding pre-sorted `rows` back in. `focusedCell` is addressed
 * by index, robust to virtualization.
 */

export type SortDirection = 'asc' | 'desc'

export type TableSelectionMode = 'none' | 'single' | 'multiple'

export interface TableColumn {
  /** Opaque column id. */
  id: string
  /** Whether this column participates in sorting. Defaults to false. */
  sortable?: boolean
}

export interface TableSort {
  columnId: string
  direction: SortDirection
}

export interface TableCellCoord {
  rowIndex: number
  colIndex: number
}

export interface TableState {
  /** Column descriptors in display order. */
  columns: TableColumn[]
  /** Row IDs in display order. Row DATA stays in the consumer. */
  rows: string[]
  /** Active sort, or null when unsorted. */
  sort: TableSort | null
  /** Selected row IDs. */
  selection: string[]
  selectionMode: TableSelectionMode
  /** Focused cell coordinate (header row excluded; rowIndex addresses `rows`). */
  focusedCell: TableCellCoord | null
  /** Index of the last row toggled — the anchor for shift-range selection. */
  rangeAnchor: number | null
  /** Rows moved per PageUp/PageDown. */
  pageSize: number
  /** When true, the sort cycle starts at desc instead of asc. */
  descFirst: boolean
  disabled: boolean
}

export type TableMsg =
  /** @intent("Cycle the sort on the given column (asc → desc → none, or desc → asc → none when descFirst)") */
  | { type: 'toggleSort'; columnId: string }
  /** @intent("Set an explicit sort, or null to clear sorting") */
  | { type: 'setSort'; sort: TableSort | null }
  /** @intent("Toggle selection of the row with the given id at the given display index") */
  | { type: 'toggleRow'; id: string; index: number }
  /** @intent("Select every row (multiple mode only)") */
  | { type: 'selectAll' }
  /** @intent("Clear the entire selection") */
  | { type: 'clearSelection' }
  /** @intent("Toggle between select-all and clear, based on whether every row is selected") */
  | { type: 'toggleAll' }
  /** @intent("Replace the selected-id set with the provided list") */
  | { type: 'setSelection'; ids: string[] }
  /** @intent("Select the inclusive range from the current anchor to the given index (Shift+click)") */
  | { type: 'selectRange'; index: number }
  /** @intent("Activate (open/confirm) the row with the given id at the given index") */
  | { type: 'activateRow'; id: string; index: number }
  /** @intent("Replace the row-id list (display order); drops selection for ids no longer present") */
  | { type: 'setRows'; rows: string[] }
  /** @intent("Replace the column descriptors") */
  | { type: 'setColumns'; columns: TableColumn[] }
  /** @humanOnly */
  | { type: 'focusCell'; rowIndex: number; colIndex: number }
  /** @humanOnly */
  | { type: 'moveCell'; dRow: number; dCol: number }
  /** @humanOnly */
  | { type: 'rowStart' }
  /** @humanOnly */
  | { type: 'rowEnd' }
  /** @humanOnly */
  | { type: 'gridStart' }
  /** @humanOnly */
  | { type: 'gridEnd' }
  /** @humanOnly */
  | { type: 'pageDown' }
  /** @humanOnly */
  | { type: 'pageUp' }

export interface TableInit {
  columns?: TableColumn[]
  rows?: string[]
  sort?: TableSort | null
  selection?: string[]
  selectionMode?: TableSelectionMode
  focusedCell?: TableCellCoord | null
  pageSize?: number
  descFirst?: boolean
  disabled?: boolean
}

export function init(opts: TableInit = {}): TableState {
  return {
    columns: opts.columns ?? [],
    rows: opts.rows ?? [],
    sort: opts.sort ?? null,
    selection: opts.selection ?? [],
    selectionMode: opts.selectionMode ?? 'none',
    focusedCell: opts.focusedCell ?? null,
    rangeAnchor: null,
    pageSize: opts.pageSize ?? 10,
    descFirst: opts.descFirst ?? false,
    disabled: opts.disabled ?? false,
  }
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n))

function isSortable(state: TableState, columnId: string): boolean {
  const col = state.columns.find((c) => c.id === columnId)
  return col !== undefined && col.sortable === true
}

function cycleSort(state: TableState, columnId: string): TableSort | null {
  const first: SortDirection = state.descFirst ? 'desc' : 'asc'
  const second: SortDirection = state.descFirst ? 'asc' : 'desc'
  if (state.sort === null || state.sort.columnId !== columnId) {
    return { columnId, direction: first }
  }
  if (state.sort.direction === first) return { columnId, direction: second }
  return null
}

function clampCell(state: TableState, cell: TableCellCoord): TableCellCoord | null {
  if (state.rows.length === 0 || state.columns.length === 0) return null
  return {
    rowIndex: clamp(cell.rowIndex, 0, state.rows.length - 1),
    colIndex: clamp(cell.colIndex, 0, state.columns.length - 1),
  }
}

function moveSelection(state: TableState, id: string): string[] {
  if (state.selectionMode === 'none') return state.selection
  if (state.selectionMode === 'single') {
    return state.selection.length === 1 && state.selection[0] === id ? [] : [id]
  }
  return state.selection.includes(id)
    ? state.selection.filter((s) => s !== id)
    : [...state.selection, id]
}

export function update(state: TableState, msg: TableMsg): [TableState, never[]] {
  // setRows / setColumns are structural updates the consumer must always be
  // able to apply (e.g. after a server fetch), even while disabled.
  if (state.disabled && msg.type !== 'setRows' && msg.type !== 'setColumns') {
    return [state, []]
  }
  switch (msg.type) {
    case 'toggleSort': {
      if (!isSortable(state, msg.columnId)) return [state, []]
      return [{ ...state, sort: cycleSort(state, msg.columnId) }, []]
    }
    case 'setSort':
      return [{ ...state, sort: msg.sort }, []]
    case 'toggleRow':
      return [{ ...state, selection: moveSelection(state, msg.id), rangeAnchor: msg.index }, []]
    case 'selectAll':
      if (state.selectionMode !== 'multiple') return [state, []]
      return [{ ...state, selection: [...state.rows] }, []]
    case 'clearSelection':
      return [{ ...state, selection: [] }, []]
    case 'toggleAll': {
      if (state.selectionMode !== 'multiple') return [state, []]
      return [{ ...state, selection: isAllSelected(state) ? [] : [...state.rows] }, []]
    }
    case 'setSelection':
      return [{ ...state, selection: msg.ids }, []]
    case 'selectRange': {
      if (state.selectionMode !== 'multiple') return [state, []]
      const anchor = state.rangeAnchor
      if (anchor === null) {
        const id = state.rows[msg.index]
        return [{ ...state, selection: id === undefined ? [] : [id], rangeAnchor: msg.index }, []]
      }
      const lo = Math.min(anchor, msg.index)
      const hi = Math.max(anchor, msg.index)
      const range = state.rows.slice(lo, hi + 1)
      const merged = Array.from(new Set([...state.selection, ...range]))
      return [{ ...state, selection: merged }, []]
    }
    case 'activateRow':
      return [state, []]
    case 'setRows': {
      const selection = state.selection.filter((id) => msg.rows.includes(id))
      const focusedCell = state.focusedCell
        ? clampCell({ ...state, rows: msg.rows }, state.focusedCell)
        : null
      return [{ ...state, rows: msg.rows, selection, focusedCell, rangeAnchor: null }, []]
    }
    case 'setColumns': {
      const focusedCell = state.focusedCell
        ? clampCell({ ...state, columns: msg.columns }, state.focusedCell)
        : null
      return [{ ...state, columns: msg.columns, focusedCell }, []]
    }
    case 'focusCell':
      return [
        {
          ...state,
          focusedCell: clampCell(state, { rowIndex: msg.rowIndex, colIndex: msg.colIndex }),
        },
        [],
      ]
    case 'moveCell': {
      const base = state.focusedCell ?? { rowIndex: 0, colIndex: 0 }
      const target = state.focusedCell
        ? { rowIndex: base.rowIndex + msg.dRow, colIndex: base.colIndex + msg.dCol }
        : base
      return [{ ...state, focusedCell: clampCell(state, target) }, []]
    }
    case 'rowStart': {
      if (state.focusedCell === null) return [state, []]
      return [{ ...state, focusedCell: { ...state.focusedCell, colIndex: 0 } }, []]
    }
    case 'rowEnd': {
      if (state.focusedCell === null) return [state, []]
      return [
        { ...state, focusedCell: { ...state.focusedCell, colIndex: state.columns.length - 1 } },
        [],
      ]
    }
    case 'gridStart':
      return [{ ...state, focusedCell: clampCell(state, { rowIndex: 0, colIndex: 0 }) }, []]
    case 'gridEnd':
      return [
        {
          ...state,
          focusedCell: clampCell(state, {
            rowIndex: state.rows.length - 1,
            colIndex: state.columns.length - 1,
          }),
        },
        [],
      ]
    case 'pageDown': {
      const base = state.focusedCell ?? { rowIndex: 0, colIndex: 0 }
      return [
        {
          ...state,
          focusedCell: clampCell(state, { ...base, rowIndex: base.rowIndex + state.pageSize }),
        },
        [],
      ]
    }
    case 'pageUp': {
      const base = state.focusedCell ?? { rowIndex: 0, colIndex: 0 }
      return [
        {
          ...state,
          focusedCell: clampCell(state, { ...base, rowIndex: base.rowIndex - state.pageSize }),
        },
        [],
      ]
    }
  }
}

export function isRowSelected(state: TableState, id: string): boolean {
  return state.selection.includes(id)
}

export function isAllSelected(state: TableState): boolean {
  return state.rows.length > 0 && state.rows.every((id) => state.selection.includes(id))
}

export function isSomeSelected(state: TableState): boolean {
  return state.selection.length > 0 && !isAllSelected(state)
}

export function sortDirectionFor(state: TableState, columnId: string): SortDirection | null {
  return state.sort && state.sort.columnId === columnId ? state.sort.direction : null
}

export interface TableColumnHeaderParts {
  role: 'columnheader'
  id: string
  'aria-sort': Signal<'ascending' | 'descending' | 'none' | undefined>
  'data-scope': 'table'
  'data-part': 'column-header'
  'data-column': string
  'data-sortable': Signal<'' | undefined>
  'data-sort': Signal<SortDirection | undefined>
  onClick: (e: MouseEvent) => void
  onKeyDown: (e: KeyboardEvent) => void
}

export interface TableRowParts {
  role: 'row'
  'aria-selected': Signal<boolean | undefined>
  'aria-rowindex': number
  'data-scope': 'table'
  'data-part': 'row'
  'data-row': string
  'data-selected': Signal<'' | undefined>
  onClick: (e: MouseEvent) => void
}

export interface TableCellParts {
  role: 'gridcell'
  'aria-colindex': number
  tabindex: Signal<number>
  'data-scope': 'table'
  'data-part': 'cell'
  'data-focused': Signal<'' | undefined>
  onFocus: (e: FocusEvent) => void
  onKeyDown: (e: KeyboardEvent) => void
}

export interface TableCheckboxParts {
  role: 'checkbox'
  'aria-checked': Signal<'true' | 'false' | 'mixed'>
  'data-scope': 'table'
  'data-part': 'select-all' | 'row-checkbox'
  'data-state': Signal<'checked' | 'unchecked' | 'indeterminate'>
  onClick: (e: MouseEvent) => void
}

export interface TableParts {
  root: {
    role: 'grid'
    id: string
    'aria-multiselectable': Signal<'true' | undefined>
    'aria-rowcount': Signal<number>
    'aria-colcount': Signal<number>
    'aria-disabled': Signal<'true' | undefined>
    'data-scope': 'table'
    'data-part': 'root'
    'data-disabled': Signal<'' | undefined>
  }
  columnHeader: (columnId: string) => TableColumnHeaderParts
  row: (id: string, index: number) => TableRowParts
  cell: (rowIndex: number, colIndex: number) => TableCellParts
  selectAllCheckbox: TableCheckboxParts
  rowCheckbox: (id: string, index: number) => TableCheckboxParts
}

export interface ConnectOptions {
  id: string
}

export function connect(
  state: Signal<TableState>,
  send: Send<TableMsg>,
  opts: ConnectOptions,
): TableParts {
  const rootId = `${opts.id}:root`
  const headerId = (columnId: string): string => `${opts.id}:colheader:${columnId}`

  const cellOnKeyDown = (rowIndex: number): ((e: KeyboardEvent) => void) =>
    tagSend(
      send,
      [
        'moveCell',
        'rowStart',
        'rowEnd',
        'gridStart',
        'gridEnd',
        'pageDown',
        'pageUp',
        'toggleRow',
        'activateRow',
      ],
      (e) => {
        const s = state.peek()
        const id = s.rows[rowIndex]
        switch (e.key) {
          case 'ArrowRight':
            e.preventDefault()
            send({ type: 'moveCell', dRow: 0, dCol: 1 })
            return
          case 'ArrowLeft':
            e.preventDefault()
            send({ type: 'moveCell', dRow: 0, dCol: -1 })
            return
          case 'ArrowDown':
            e.preventDefault()
            send({ type: 'moveCell', dRow: 1, dCol: 0 })
            return
          case 'ArrowUp':
            e.preventDefault()
            send({ type: 'moveCell', dRow: -1, dCol: 0 })
            return
          case 'Home':
            e.preventDefault()
            send(e.ctrlKey || e.metaKey ? { type: 'gridStart' } : { type: 'rowStart' })
            return
          case 'End':
            e.preventDefault()
            send(e.ctrlKey || e.metaKey ? { type: 'gridEnd' } : { type: 'rowEnd' })
            return
          case 'PageDown':
            e.preventDefault()
            send({ type: 'pageDown' })
            return
          case 'PageUp':
            e.preventDefault()
            send({ type: 'pageUp' })
            return
          case ' ':
            e.preventDefault()
            if (id !== undefined) send({ type: 'toggleRow', id, index: rowIndex })
            return
          case 'Enter':
            e.preventDefault()
            if (id !== undefined) send({ type: 'activateRow', id, index: rowIndex })
            return
        }
      },
    )

  return {
    root: {
      role: 'grid',
      id: rootId,
      'aria-multiselectable': state.map((s) =>
        s.selectionMode === 'multiple' ? 'true' : undefined,
      ),
      // Includes the header row.
      'aria-rowcount': state.map((s) => s.rows.length + 1),
      'aria-colcount': state.map((s) => s.columns.length),
      'aria-disabled': state.map((s) => (s.disabled ? 'true' : undefined)),
      'data-scope': 'table',
      'data-part': 'root',
      'data-disabled': state.map((s) => (s.disabled ? '' : undefined)),
    },
    columnHeader: (columnId: string): TableColumnHeaderParts => ({
      role: 'columnheader',
      id: headerId(columnId),
      'aria-sort': state.map((s) => {
        if (!isSortable(s, columnId)) return undefined
        const dir = sortDirectionFor(s, columnId)
        if (dir === 'asc') return 'ascending'
        if (dir === 'desc') return 'descending'
        return 'none'
      }),
      'data-scope': 'table',
      'data-part': 'column-header',
      'data-column': columnId,
      'data-sortable': state.map((s) => (isSortable(s, columnId) ? '' : undefined)),
      'data-sort': state.map((s) => sortDirectionFor(s, columnId) ?? undefined),
      onClick: tagSend(send, ['toggleSort'], () => {
        if (isSortable(state.peek(), columnId)) send({ type: 'toggleSort', columnId })
      }),
      onKeyDown: tagSend(send, ['toggleSort'], (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        if (!isSortable(state.peek(), columnId)) return
        e.preventDefault()
        send({ type: 'toggleSort', columnId })
      }),
    }),
    row: (id: string, index: number): TableRowParts => ({
      role: 'row',
      'aria-selected': state.map((s) =>
        s.selectionMode === 'none' ? undefined : isRowSelected(s, id),
      ),
      // 1-based and header-row-offset (header occupies aria-rowindex 1).
      'aria-rowindex': index + 2,
      'data-scope': 'table',
      'data-part': 'row',
      'data-row': id,
      'data-selected': state.map((s) => (isRowSelected(s, id) ? '' : undefined)),
      onClick: tagSend(send, ['toggleRow', 'selectRange'], (e) => {
        if (state.peek().selectionMode === 'none') return
        if (e.shiftKey) send({ type: 'selectRange', index })
        else send({ type: 'toggleRow', id, index })
      }),
    }),
    cell: (rowIndex: number, colIndex: number): TableCellParts => ({
      role: 'gridcell',
      'aria-colindex': colIndex + 1,
      tabindex: state.map((s) => {
        if (s.focusedCell === null) return rowIndex === 0 && colIndex === 0 ? 0 : -1
        return s.focusedCell.rowIndex === rowIndex && s.focusedCell.colIndex === colIndex ? 0 : -1
      }),
      'data-scope': 'table',
      'data-part': 'cell',
      'data-focused': state.map((s) =>
        s.focusedCell !== null &&
        s.focusedCell.rowIndex === rowIndex &&
        s.focusedCell.colIndex === colIndex
          ? ''
          : undefined,
      ),
      onFocus: tagSend(send, ['focusCell'], () => send({ type: 'focusCell', rowIndex, colIndex })),
      onKeyDown: cellOnKeyDown(rowIndex),
    }),
    selectAllCheckbox: {
      role: 'checkbox',
      'aria-checked': state.map((s) => {
        if (isAllSelected(s)) return 'true'
        if (isSomeSelected(s)) return 'mixed'
        return 'false'
      }),
      'data-scope': 'table',
      'data-part': 'select-all',
      'data-state': state.map((s) => {
        if (isAllSelected(s)) return 'checked'
        if (isSomeSelected(s)) return 'indeterminate'
        return 'unchecked'
      }),
      // The checkbox is a self-contained control; stop the click from bubbling
      // to an enclosing clickable header cell (which would also toggle sort).
      onClick: tagSend(send, ['toggleAll'], (e) => {
        e.stopPropagation()
        send({ type: 'toggleAll' })
      }),
    },
    rowCheckbox: (id: string, index: number): TableCheckboxParts => ({
      role: 'checkbox',
      'aria-checked': state.map((s) => (isRowSelected(s, id) ? 'true' : 'false')),
      'data-scope': 'table',
      'data-part': 'row-checkbox',
      'data-state': state.map((s) => (isRowSelected(s, id) ? 'checked' : 'unchecked')),
      // The checkbox lives INSIDE the clickable row, which also toggles the row
      // on click. Without stopping propagation the click would fire twice
      // (checkbox + row), cancelling out to a no-op. Stop it here so a click on
      // the checkbox toggles exactly once.
      onClick: tagSend(send, ['toggleRow', 'selectRange'], (e) => {
        e.stopPropagation()
        if (e.shiftKey) send({ type: 'selectRange', index })
        else send({ type: 'toggleRow', id, index })
      }),
    }),
  }
}

export const table = {
  init,
  update,
  connect,
  isRowSelected,
  isAllSelected,
  isSomeSelected,
  sortDirectionFor,
}
