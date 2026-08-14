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

/**
 * The row index of the HEADER row. The header is part of the grid's roving
 * sequence — APG's data-grid examples make column headers focusable exactly
 * because they carry controls (sort here, plus the select-all checkbox) — so it
 * needs a coordinate. `-1` is the natural one: `aria-rowindex` already models
 * the header as row 1 with data row `i` at `i + 2`, so the header sits one row
 * above data row 0.
 */
export const HEADER_ROW_INDEX = -1

export interface TableCellCoord {
  /** Row index into `rows`, or {@link HEADER_ROW_INDEX} for the header row. */
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

/**
 * Clamp a coordinate into the grid.
 *
 * `minRow` is the top of the addressable row space. It is {@link
 * HEADER_ROW_INDEX} for everything that ROVES (arrow moves, page moves, and the
 * DOM→state focus sync) — the header row is the top of the grid, so ArrowUp from
 * data row 0 lands on it and ArrowUp from it stays put. It stays `0` for the
 * "jump to a data corner" messages (`gridStart`/`gridEnd`), whose contract is the
 * first/last DATA cell.
 *
 * Returns `null` when nothing is addressable: no columns at all, or no row in
 * `[minRow, rows.length - 1]`. Note that with `minRow === HEADER_ROW_INDEX` a
 * grid with zero data rows still has its header row, which is what keeps an
 * empty grid keyboard-reachable.
 */
function clampCell(
  state: TableState,
  cell: TableCellCoord,
  minRow: number = 0,
): TableCellCoord | null {
  if (state.columns.length === 0) return null
  const maxRow = state.rows.length - 1
  if (maxRow < minRow) return null
  return {
    rowIndex: clamp(cell.rowIndex, minRow, maxRow),
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
      // Re-clamped against the roving row space: a grid whose rows all go away
      // keeps its focus on the header rather than losing it entirely.
      const focusedCell = state.focusedCell
        ? clampCell({ ...state, rows: msg.rows }, state.focusedCell, HEADER_ROW_INDEX)
        : null
      return [{ ...state, rows: msg.rows, selection, focusedCell, rangeAnchor: null }, []]
    }
    case 'setColumns': {
      const focusedCell = state.focusedCell
        ? clampCell({ ...state, columns: msg.columns }, state.focusedCell, HEADER_ROW_INDEX)
        : null
      return [{ ...state, columns: msg.columns, focusedCell }, []]
    }
    case 'focusCell':
      // The DOM→state half of the roving tabindex, so it must accept every
      // focusable coordinate — the header row included.
      return [
        {
          ...state,
          focusedCell: clampCell(
            state,
            { rowIndex: msg.rowIndex, colIndex: msg.colIndex },
            HEADER_ROW_INDEX,
          ),
        },
        [],
      ]
    case 'moveCell': {
      const base = state.focusedCell ?? { rowIndex: 0, colIndex: 0 }
      const target = state.focusedCell
        ? { rowIndex: base.rowIndex + msg.dRow, colIndex: base.colIndex + msg.dCol }
        : base
      return [{ ...state, focusedCell: clampCell(state, target, HEADER_ROW_INDEX) }, []]
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
    // gridStart/gridEnd keep the DATA corners: Ctrl+Home/Ctrl+End are documented
    // as "first/last cell of the grid body", and the header is reached by
    // arrowing up rather than by a corner jump.
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
    // Page moves rove, so they share the arrow keys' row space: APG's "if focus
    // is in the first row of the grid, focus does not move" — and with a
    // focusable header the header IS the first row.
    case 'pageDown': {
      const base = state.focusedCell ?? { rowIndex: 0, colIndex: 0 }
      return [
        {
          ...state,
          focusedCell: clampCell(
            state,
            { ...base, rowIndex: base.rowIndex + state.pageSize },
            HEADER_ROW_INDEX,
          ),
        },
        [],
      ]
    }
    case 'pageUp': {
      const base = state.focusedCell ?? { rowIndex: 0, colIndex: 0 }
      return [
        {
          ...state,
          focusedCell: clampCell(
            state,
            { ...base, rowIndex: base.rowIndex - state.pageSize },
            HEADER_ROW_INDEX,
          ),
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
  /**
   * Roving tab stop. The header row participates in the grid's single-tab-stop
   * sequence, because it hosts controls — the sort toggle on every sortable
   * column, and the select-all checkbox — that are otherwise unreachable by
   * keyboard.
   */
  tabindex: Signal<number>
  'data-scope': 'table'
  'data-part': 'column-header'
  'data-column': string
  /** Always {@link HEADER_ROW_INDEX} — addresses the header for roving DOM focus. */
  'data-row-index': typeof HEADER_ROW_INDEX
  /** 0-based column index (`-1` for a column not in `columns`). */
  'data-col-index': Signal<number>
  'data-focused': Signal<'' | undefined>
  'data-sortable': Signal<'' | undefined>
  'data-sort': Signal<SortDirection | undefined>
  onFocus: (e: FocusEvent) => void
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
  /** 0-based row index — addresses the cell for roving DOM focus. */
  'data-row-index': number
  /** 0-based column index — addresses the cell for roving DOM focus. */
  'data-col-index': number
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
  /** Always `-1`: a `role="grid"` has exactly ONE tab stop, the roving cell. */
  tabindex: -1
  onClick: (e: MouseEvent) => void
  onKeyDown: (e: KeyboardEvent) => void
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
  /**
   * Id of the column whose `columnheader` hosts the select-all checkbox.
   *
   * The select-all has no gridcell of its own, and every part inside a
   * `role="grid"` other than the one roving stop is `tabindex="-1"` — so naming
   * the column is what makes it operable: Enter/Space on that header sends
   * `toggleAll`. Leave it unset and the select-all stays mouse-only.
   *
   * The column must be present in `columns` (that is what gives it a colIndex to
   * rove to). If it is also `sortable`, select-all wins on Enter/Space — put the
   * checkbox in a column of its own.
   */
  selectAllColumnId?: string
}

export function connect(
  state: Signal<TableState>,
  send: Send<TableMsg>,
  opts: ConnectOptions,
): TableParts {
  const rootId = `${opts.id}:root`
  const headerId = (columnId: string): string => `${opts.id}:colheader:${columnId}`
  const colIndexOf = (s: TableState, columnId: string): number =>
    s.columns.findIndex((c) => c.id === columnId)

  /** The messages every roving part may send. */
  const NAV_MSGS = [
    'moveCell',
    'rowStart',
    'rowEnd',
    'gridStart',
    'gridEnd',
    'pageDown',
    'pageUp',
  ] as const

  // The focused grid cell is tracked in state (roving tabindex), but AT and
  // keyboard focus follow the real DOM — so after every move we must focus the
  // newly-active part, addressed by its data-row-index/data-col-index. Both the
  // cells and the column headers carry that coordinate pair, which is what lets
  // the header row join the sequence.
  const focusFocusedCell = (origin: Element | null): void => {
    if (origin === null) return
    const fc = state.peek().focusedCell
    if (fc === null) return
    const root: ParentNode =
      origin.closest('[data-scope="table"][data-part="root"]') ?? origin.ownerDocument ?? origin
    const part = fc.rowIndex === HEADER_ROW_INDEX ? 'column-header' : 'cell'
    const el = root.querySelector(
      `[data-scope="table"][data-part="${part}"][data-row-index="${fc.rowIndex}"][data-col-index="${fc.colIndex}"]`,
    )
    if (el instanceof HTMLElement) el.focus()
  }

  /**
   * The navigation half of the roving sequence, shared by cells and column
   * headers. Returns whether the key was claimed, so each part can layer its own
   * activation keys (Space/Enter) on top.
   */
  const handleNavKey = (e: KeyboardEvent): boolean => {
    const origin = e.currentTarget as Element | null
    const move = (msg: TableMsg): true => {
      e.preventDefault()
      send(msg)
      focusFocusedCell(origin)
      return true
    }
    switch (e.key) {
      case 'ArrowRight':
        return move({ type: 'moveCell', dRow: 0, dCol: 1 })
      case 'ArrowLeft':
        return move({ type: 'moveCell', dRow: 0, dCol: -1 })
      case 'ArrowDown':
        return move({ type: 'moveCell', dRow: 1, dCol: 0 })
      case 'ArrowUp':
        return move({ type: 'moveCell', dRow: -1, dCol: 0 })
      case 'Home':
        return move(e.ctrlKey || e.metaKey ? { type: 'gridStart' } : { type: 'rowStart' })
      case 'End':
        return move(e.ctrlKey || e.metaKey ? { type: 'gridEnd' } : { type: 'rowEnd' })
      case 'PageDown':
        return move({ type: 'pageDown' })
      case 'PageUp':
        return move({ type: 'pageUp' })
      default:
        return false
    }
  }

  const cellOnKeyDown = (rowIndex: number): ((e: KeyboardEvent) => void) =>
    tagSend(send, [...NAV_MSGS, 'toggleRow', 'activateRow'], (e) => {
      if (handleNavKey(e)) return
      const id = state.peek().rows[rowIndex]
      switch (e.key) {
        case ' ':
          e.preventDefault()
          if (id !== undefined) send({ type: 'toggleRow', id, index: rowIndex })
          return
        case 'Enter':
          e.preventDefault()
          if (id !== undefined) send({ type: 'activateRow', id, index: rowIndex })
          return
      }
    })

  // Enter/Space on a focused header activates whatever that header hosts. The
  // select-all wins where the consumer named its column: it has no gridcell of
  // its own, so the header is a keyboard user's ONLY route to it, whereas a
  // sortable column's sort is also reachable by pointer on the same element.
  const headerOnKeyDown = (columnId: string): ((e: KeyboardEvent) => void) =>
    tagSend(send, [...NAV_MSGS, 'toggleSort', 'toggleAll'], (e) => {
      if (handleNavKey(e)) return
      if (e.key !== 'Enter' && e.key !== ' ') return
      const s = state.peek()
      if (opts.selectAllColumnId !== undefined && opts.selectAllColumnId === columnId) {
        if (s.selectionMode !== 'multiple') return
        e.preventDefault()
        send({ type: 'toggleAll' })
        return
      }
      if (!isSortable(s, columnId)) return
      e.preventDefault()
      send({ type: 'toggleSort', columnId })
    })

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
      tabindex: state.map((s) => {
        const colIndex = colIndexOf(s, columnId)
        if (colIndex < 0) return -1
        if (s.focusedCell === null) {
          // Nothing focused yet: cell(0,0) is the grid's entry tab stop. With no
          // data rows there is no cell to carry it, and a grid with zero tab
          // stops is unreachable — sort and select-all included — so the first
          // header takes it instead.
          return s.rows.length === 0 && colIndex === 0 ? 0 : -1
        }
        return s.focusedCell.rowIndex === HEADER_ROW_INDEX && s.focusedCell.colIndex === colIndex
          ? 0
          : -1
      }),
      'data-scope': 'table',
      'data-part': 'column-header',
      'data-column': columnId,
      'data-row-index': HEADER_ROW_INDEX,
      'data-col-index': state.map((s) => colIndexOf(s, columnId)),
      'data-focused': state.map((s) =>
        s.focusedCell !== null &&
        s.focusedCell.rowIndex === HEADER_ROW_INDEX &&
        s.focusedCell.colIndex === colIndexOf(s, columnId)
          ? ''
          : undefined,
      ),
      'data-sortable': state.map((s) => (isSortable(s, columnId) ? '' : undefined)),
      'data-sort': state.map((s) => sortDirectionFor(s, columnId) ?? undefined),
      onFocus: tagSend(send, ['focusCell'], () => {
        const colIndex = colIndexOf(state.peek(), columnId)
        if (colIndex < 0) return
        send({ type: 'focusCell', rowIndex: HEADER_ROW_INDEX, colIndex })
      }),
      onClick: tagSend(send, ['toggleSort'], () => {
        if (isSortable(state.peek(), columnId)) send({ type: 'toggleSort', columnId })
      }),
      onKeyDown: headerOnKeyDown(columnId),
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
      'data-row-index': rowIndex,
      'data-col-index': colIndex,
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
      // Out of the tab sequence, like every part inside `role="grid"` except the
      // one roving stop. The select-all has no cell of its own — it lives in a
      // `columnheader` — so its keyboard route is the ROVING HEADER: name its
      // column via `ConnectOptions.selectAllColumnId` and Enter/Space on the
      // focused header toggles it (#122). The Space handler below still applies
      // when the checkbox itself is focused programmatically.
      tabindex: -1,
      // The checkbox is a self-contained control; stop the click from bubbling
      // to an enclosing clickable header cell (which would also toggle sort).
      onClick: tagSend(send, ['toggleAll'], (e) => {
        e.stopPropagation()
        send({ type: 'toggleAll' })
      }),
      // Same containment hazard on the keyboard: the enclosing column header
      // also acts on Space (toggle sort), so claim the key here.
      onKeyDown: tagSend(send, ['toggleAll'], (e) => {
        if (e.key !== ' ') return
        e.preventDefault()
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
      // Out of the tab sequence. A tab stop per row would put N of them inside a
      // `role="grid"`, which contradicts APG's single-tab-stop Grid pattern —
      // and it is unnecessary: the enclosing gridcell's Space already toggles
      // the row from the grid's one tab stop. The handler below stays for a
      // programmatically-focused checkbox (#122).
      tabindex: -1,
      // The checkbox lives INSIDE the clickable row, which also toggles the row
      // on click. Without stopping propagation the click would fire twice
      // (checkbox + row), cancelling out to a no-op. Stop it here so a click on
      // the checkbox toggles exactly once.
      onClick: tagSend(send, ['toggleRow', 'selectRange'], (e) => {
        e.stopPropagation()
        if (e.shiftKey) send({ type: 'selectRange', index })
        else send({ type: 'toggleRow', id, index })
      }),
      // The enclosing gridcell's own Space handler also toggles the row, so the
      // same double-fire-cancels-out hazard applies to the keyboard.
      onKeyDown: tagSend(send, ['toggleRow', 'selectRange'], (e) => {
        if (e.key !== ' ') return
        e.preventDefault()
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
