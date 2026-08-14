import { describe, it, expect, vi } from 'vitest'
import {
  init,
  update,
  connect,
  isRowSelected,
  isAllSelected,
  HEADER_ROW_INDEX,
} from '../../src/components/table'
import { rootSignal, read } from '../_signal'

const COLS = [{ id: 'name', sortable: true }, { id: 'age', sortable: true }, { id: 'note' }]
const ROWS = ['r1', 'r2', 'r3', 'r4']

describe('table reducer — sorting', () => {
  it('initializes with no sort', () => {
    expect(init({ columns: COLS, rows: ROWS }).sort).toBeNull()
  })

  it('toggleSort cycles asc → desc → none', () => {
    const s0 = init({ columns: COLS, rows: ROWS })
    const [s1] = update(s0, { type: 'toggleSort', columnId: 'name' })
    expect(s1.sort).toEqual({ columnId: 'name', direction: 'asc' })
    const [s2] = update(s1, { type: 'toggleSort', columnId: 'name' })
    expect(s2.sort).toEqual({ columnId: 'name', direction: 'desc' })
    const [s3] = update(s2, { type: 'toggleSort', columnId: 'name' })
    expect(s3.sort).toBeNull()
  })

  it('toggleSort on a different column starts fresh at asc', () => {
    const s0 = init({ columns: COLS, rows: ROWS, sort: { columnId: 'name', direction: 'desc' } })
    const [s] = update(s0, { type: 'toggleSort', columnId: 'age' })
    expect(s.sort).toEqual({ columnId: 'age', direction: 'asc' })
  })

  it('toggleSort ignores non-sortable columns', () => {
    const s0 = init({ columns: COLS, rows: ROWS })
    const [s] = update(s0, { type: 'toggleSort', columnId: 'note' })
    expect(s.sort).toBeNull()
  })

  it('toggleSort ignores unknown columns', () => {
    const s0 = init({ columns: COLS, rows: ROWS })
    const [s] = update(s0, { type: 'toggleSort', columnId: 'nope' })
    expect(s.sort).toBeNull()
  })

  it('setSort sets explicit sort', () => {
    const [s] = update(init({ columns: COLS, rows: ROWS }), {
      type: 'setSort',
      sort: { columnId: 'age', direction: 'desc' },
    })
    expect(s.sort).toEqual({ columnId: 'age', direction: 'desc' })
  })

  it('descFirst init reverses the cycle to desc → asc → none', () => {
    const s0 = init({ columns: COLS, rows: ROWS, descFirst: true })
    const [s1] = update(s0, { type: 'toggleSort', columnId: 'name' })
    expect(s1.sort).toEqual({ columnId: 'name', direction: 'desc' })
    const [s2] = update(s1, { type: 'toggleSort', columnId: 'name' })
    expect(s2.sort).toEqual({ columnId: 'name', direction: 'asc' })
    const [s3] = update(s2, { type: 'toggleSort', columnId: 'name' })
    expect(s3.sort).toBeNull()
  })
})

describe('table reducer — selection', () => {
  it('single select replaces', () => {
    const s0 = init({ columns: COLS, rows: ROWS, selectionMode: 'single', selection: ['r1'] })
    const [s] = update(s0, { type: 'toggleRow', id: 'r2', index: 1 })
    expect(s.selection).toEqual(['r2'])
  })

  it('single toggle off when re-selected', () => {
    const s0 = init({ columns: COLS, rows: ROWS, selectionMode: 'single', selection: ['r2'] })
    const [s] = update(s0, { type: 'toggleRow', id: 'r2', index: 1 })
    expect(s.selection).toEqual([])
  })

  it('multiple toggles add/remove', () => {
    const s0 = init({ columns: COLS, rows: ROWS, selectionMode: 'multiple' })
    const [s1] = update(s0, { type: 'toggleRow', id: 'r1', index: 0 })
    const [s2] = update(s1, { type: 'toggleRow', id: 'r3', index: 2 })
    expect(s2.selection.sort()).toEqual(['r1', 'r3'])
    const [s3] = update(s2, { type: 'toggleRow', id: 'r1', index: 0 })
    expect(s3.selection).toEqual(['r3'])
  })

  it('selectionMode none ignores toggleRow', () => {
    const s0 = init({ columns: COLS, rows: ROWS, selectionMode: 'none' })
    const [s] = update(s0, { type: 'toggleRow', id: 'r1', index: 0 })
    expect(s.selection).toEqual([])
  })

  it('selectAll selects every row (multiple)', () => {
    const s0 = init({ columns: COLS, rows: ROWS, selectionMode: 'multiple' })
    const [s] = update(s0, { type: 'selectAll' })
    expect(s.selection.sort()).toEqual([...ROWS].sort())
  })

  it('selectAll is a no-op in single mode', () => {
    const s0 = init({ columns: COLS, rows: ROWS, selectionMode: 'single' })
    const [s] = update(s0, { type: 'selectAll' })
    expect(s.selection).toEqual([])
  })

  it('clearSelection empties', () => {
    const s0 = init({ columns: COLS, rows: ROWS, selectionMode: 'multiple', selection: ROWS })
    const [s] = update(s0, { type: 'clearSelection' })
    expect(s.selection).toEqual([])
  })

  it('toggleAll selects all when none selected, clears when all selected', () => {
    const s0 = init({ columns: COLS, rows: ROWS, selectionMode: 'multiple' })
    const [s1] = update(s0, { type: 'toggleAll' })
    expect(s1.selection.sort()).toEqual([...ROWS].sort())
    const [s2] = update(s1, { type: 'toggleAll' })
    expect(s2.selection).toEqual([])
  })

  it('setSelection replaces', () => {
    const [s] = update(init({ columns: COLS, rows: ROWS, selectionMode: 'multiple' }), {
      type: 'setSelection',
      ids: ['r2', 'r4'],
    })
    expect(s.selection).toEqual(['r2', 'r4'])
  })

  it('shift-range selects from anchor to target inclusive', () => {
    const s0 = init({ columns: COLS, rows: ROWS, selectionMode: 'multiple' })
    const [s1] = update(s0, { type: 'toggleRow', id: 'r1', index: 0 })
    // shift-click on r4 should select r1..r4
    const [s2] = update(s1, { type: 'selectRange', index: 3 })
    expect(s2.selection.sort()).toEqual(['r1', 'r2', 'r3', 'r4'])
  })

  it('shift-range works backwards and merges with existing selection', () => {
    const s0 = init({ columns: COLS, rows: ROWS, selectionMode: 'multiple' })
    const [s1] = update(s0, { type: 'toggleRow', id: 'r3', index: 2 })
    const [s2] = update(s1, { type: 'selectRange', index: 0 })
    expect(s2.selection.sort()).toEqual(['r1', 'r2', 'r3'])
  })

  it('shift-range with no anchor selects just the target', () => {
    const s0 = init({ columns: COLS, rows: ROWS, selectionMode: 'multiple' })
    const [s] = update(s0, { type: 'selectRange', index: 2 })
    expect(s.selection).toEqual(['r3'])
  })
})

describe('table reducer — tri-state select-all', () => {
  it('isAllSelected true only when every row selected', () => {
    expect(isAllSelected(init({ columns: COLS, rows: ROWS, selection: ROWS }))).toBe(true)
    expect(isAllSelected(init({ columns: COLS, rows: ROWS, selection: ['r1'] }))).toBe(false)
    expect(isAllSelected(init({ columns: COLS, rows: ROWS, selection: [] }))).toBe(false)
  })

  it('selectAll checkbox aria-checked tri-state', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 't' })
    const cb = p.selectAllCheckbox
    const none = init({ columns: COLS, rows: ROWS, selectionMode: 'multiple', selection: [] })
    const some = init({ columns: COLS, rows: ROWS, selectionMode: 'multiple', selection: ['r1'] })
    const all = init({ columns: COLS, rows: ROWS, selectionMode: 'multiple', selection: ROWS })
    expect(read(cb['aria-checked'], none)).toBe('false')
    expect(read(cb['aria-checked'], some)).toBe('mixed')
    expect(read(cb['aria-checked'], all)).toBe('true')
  })
})

describe('table reducer — focus / keyboard grid nav', () => {
  it('focusCell sets coordinates', () => {
    const [s] = update(init({ columns: COLS, rows: ROWS }), {
      type: 'focusCell',
      rowIndex: 1,
      colIndex: 2,
    })
    expect(s.focusedCell).toEqual({ rowIndex: 1, colIndex: 2 })
  })

  it('moveCell right/left clamps to column bounds', () => {
    const s0 = { ...init({ columns: COLS, rows: ROWS }), focusedCell: { rowIndex: 0, colIndex: 0 } }
    const [r] = update(s0, { type: 'moveCell', dRow: 0, dCol: 1 })
    expect(r.focusedCell).toEqual({ rowIndex: 0, colIndex: 1 })
    const [l] = update({ ...s0 }, { type: 'moveCell', dRow: 0, dCol: -1 })
    expect(l.focusedCell).toEqual({ rowIndex: 0, colIndex: 0 })
    const end = {
      ...init({ columns: COLS, rows: ROWS }),
      focusedCell: { rowIndex: 0, colIndex: 2 },
    }
    const [r2] = update(end, { type: 'moveCell', dRow: 0, dCol: 1 })
    expect(r2.focusedCell).toEqual({ rowIndex: 0, colIndex: 2 })
  })

  // The clamp property is unchanged; the TOP boundary moved. The header row is
  // `rowIndex: -1` and is part of the roving sequence (#122), so ArrowUp from
  // the first data row reaches it and ArrowUp from it stays put.
  it('moveCell down/up clamps to row bounds, with the header row as the top', () => {
    const s0 = { ...init({ columns: COLS, rows: ROWS }), focusedCell: { rowIndex: 0, colIndex: 1 } }
    const [d] = update(s0, { type: 'moveCell', dRow: 1, dCol: 0 })
    expect(d.focusedCell).toEqual({ rowIndex: 1, colIndex: 1 })
    const [u] = update(s0, { type: 'moveCell', dRow: -1, dCol: 0 })
    expect(u.focusedCell).toEqual({ rowIndex: HEADER_ROW_INDEX, colIndex: 1 })
    const header = {
      ...init({ columns: COLS, rows: ROWS }),
      focusedCell: { rowIndex: HEADER_ROW_INDEX, colIndex: 1 },
    }
    const [u2] = update(header, { type: 'moveCell', dRow: -1, dCol: 0 })
    expect(u2.focusedCell).toEqual({ rowIndex: HEADER_ROW_INDEX, colIndex: 1 })
    const [back] = update(header, { type: 'moveCell', dRow: 1, dCol: 0 })
    expect(back.focusedCell).toEqual({ rowIndex: 0, colIndex: 1 })
    const last = {
      ...init({ columns: COLS, rows: ROWS }),
      focusedCell: { rowIndex: 3, colIndex: 1 },
    }
    const [d2] = update(last, { type: 'moveCell', dRow: 1, dCol: 0 })
    expect(d2.focusedCell).toEqual({ rowIndex: 3, colIndex: 1 })
  })

  it('the header row is addressable even with no data rows', () => {
    const empty = init({ columns: COLS, rows: [] })
    const [s] = update(empty, { type: 'moveCell', dRow: -1, dCol: 0 })
    expect(s.focusedCell).toEqual({ rowIndex: HEADER_ROW_INDEX, colIndex: 0 })
    // …but a grid with no COLUMNS has nothing to address at all.
    const [none] = update(init({ columns: [], rows: [] }), { type: 'moveCell', dRow: -1, dCol: 0 })
    expect(none.focusedCell).toBeNull()
  })

  it('focusCell accepts the header row (DOM focus drives the roving state)', () => {
    const [s] = update(init({ columns: COLS, rows: ROWS }), {
      type: 'focusCell',
      rowIndex: HEADER_ROW_INDEX,
      colIndex: 2,
    })
    expect(s.focusedCell).toEqual({ rowIndex: HEADER_ROW_INDEX, colIndex: 2 })
    // Still clamped: nothing above the header row exists.
    const [above] = update(init({ columns: COLS, rows: ROWS }), {
      type: 'focusCell',
      rowIndex: -9,
      colIndex: 0,
    })
    expect(above.focusedCell).toEqual({ rowIndex: HEADER_ROW_INDEX, colIndex: 0 })
  })

  it('moveCell from null seeds at (0,0)', () => {
    const [s] = update(init({ columns: COLS, rows: ROWS }), { type: 'moveCell', dRow: 1, dCol: 0 })
    expect(s.focusedCell).toEqual({ rowIndex: 0, colIndex: 0 })
  })

  it('rowStart / rowEnd jump to column bounds in current row', () => {
    const s0 = { ...init({ columns: COLS, rows: ROWS }), focusedCell: { rowIndex: 2, colIndex: 1 } }
    const [home] = update(s0, { type: 'rowStart' })
    expect(home.focusedCell).toEqual({ rowIndex: 2, colIndex: 0 })
    const [end] = update(s0, { type: 'rowEnd' })
    expect(end.focusedCell).toEqual({ rowIndex: 2, colIndex: 2 })
  })

  it('gridStart / gridEnd jump to grid corners', () => {
    const s0 = { ...init({ columns: COLS, rows: ROWS }), focusedCell: { rowIndex: 2, colIndex: 1 } }
    const [start] = update(s0, { type: 'gridStart' })
    expect(start.focusedCell).toEqual({ rowIndex: 0, colIndex: 0 })
    const [end] = update(s0, { type: 'gridEnd' })
    expect(end.focusedCell).toEqual({ rowIndex: 3, colIndex: 2 })
  })

  it('pageDown / pageUp move by page size clamped', () => {
    const rows = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    const s0 = {
      ...init({ columns: COLS, rows, pageSize: 3 }),
      focusedCell: { rowIndex: 0, colIndex: 1 },
    }
    const [d] = update(s0, { type: 'pageDown' })
    expect(d.focusedCell).toEqual({ rowIndex: 3, colIndex: 1 })
    const [d2] = update(d, { type: 'pageDown' })
    expect(d2.focusedCell).toEqual({ rowIndex: 6, colIndex: 1 })
    const [d3] = update(d2, { type: 'pageDown' })
    expect(d3.focusedCell).toEqual({ rowIndex: 7, colIndex: 1 })
    const [u] = update(d3, { type: 'pageUp' })
    expect(u.focusedCell).toEqual({ rowIndex: 4, colIndex: 1 })
  })

  it('setRows updates rows and drops out-of-range selection', () => {
    const s0 = init({
      columns: COLS,
      rows: ROWS,
      selectionMode: 'multiple',
      selection: ['r1', 'r4'],
    })
    const [s] = update(s0, { type: 'setRows', rows: ['r1', 'r2'] })
    expect(s.rows).toEqual(['r1', 'r2'])
    expect(s.selection).toEqual(['r1'])
  })

  it('setColumns updates columns', () => {
    const [s] = update(init({ columns: COLS, rows: ROWS }), {
      type: 'setColumns',
      columns: [{ id: 'x', sortable: true }],
    })
    expect(s.columns).toEqual([{ id: 'x', sortable: true }])
  })

  it('disabled blocks mutations except setRows/setColumns', () => {
    const s0 = init({ columns: COLS, rows: ROWS, selectionMode: 'multiple', disabled: true })
    const [s1] = update(s0, { type: 'toggleRow', id: 'r1', index: 0 })
    expect(s1.selection).toEqual([])
    const [s2] = update(s0, { type: 'setRows', rows: ['x'] })
    expect(s2.rows).toEqual(['x'])
  })
})

describe('table.connect — parts', () => {
  const p = connect(rootSignal(), vi.fn(), { id: 't1' })

  it('root role=grid', () => {
    expect(p.root.role).toBe('grid')
  })

  it('root aria-multiselectable true only in multiple mode', () => {
    expect(
      read(
        p.root['aria-multiselectable'],
        init({ columns: COLS, rows: ROWS, selectionMode: 'multiple' }),
      ),
    ).toBe('true')
    expect(
      read(
        p.root['aria-multiselectable'],
        init({ columns: COLS, rows: ROWS, selectionMode: 'single' }),
      ),
    ).toBeUndefined()
  })

  it('root aria-rowcount / aria-colcount reflect dimensions (incl header row)', () => {
    const s = init({ columns: COLS, rows: ROWS })
    // header row + data rows
    expect(read(p.root['aria-rowcount'], s)).toBe(ROWS.length + 1)
    expect(read(p.root['aria-colcount'], s)).toBe(COLS.length)
  })

  it('columnHeader aria-sort cycles with state', () => {
    const h = p.columnHeader('name')
    expect(read(h['aria-sort'], init({ columns: COLS, rows: ROWS }))).toBe('none')
    expect(
      read(
        h['aria-sort'],
        init({ columns: COLS, rows: ROWS, sort: { columnId: 'name', direction: 'asc' } }),
      ),
    ).toBe('ascending')
    expect(
      read(
        h['aria-sort'],
        init({ columns: COLS, rows: ROWS, sort: { columnId: 'name', direction: 'desc' } }),
      ),
    ).toBe('descending')
    // a different sorted column reports none on this header
    expect(
      read(
        h['aria-sort'],
        init({ columns: COLS, rows: ROWS, sort: { columnId: 'age', direction: 'asc' } }),
      ),
    ).toBe('none')
  })

  it('non-sortable columnHeader has undefined aria-sort', () => {
    const h = p.columnHeader('note')
    expect(read(h['aria-sort'], init({ columns: COLS, rows: ROWS }))).toBeUndefined()
  })

  it('columnHeader onClick triggers toggleSort for sortable column', () => {
    const send = vi.fn()
    const pc = connect(signalState(init({ columns: COLS, rows: ROWS })), send, { id: 't' })
    pc.columnHeader('name').onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'toggleSort', columnId: 'name' })
  })

  it('columnHeader onClick is inert for non-sortable column', () => {
    const send = vi.fn()
    const pc = connect(signalState(init({ columns: COLS, rows: ROWS })), send, { id: 't' })
    pc.columnHeader('note').onClick(new MouseEvent('click'))
    expect(send).not.toHaveBeenCalled()
  })

  it('row aria-selected reflects selection', () => {
    const r = p.row('r2', 1)
    expect(
      read(
        r['aria-selected'],
        init({ columns: COLS, rows: ROWS, selectionMode: 'multiple', selection: ['r2'] }),
      ),
    ).toBe(true)
    expect(
      read(
        r['aria-selected'],
        init({ columns: COLS, rows: ROWS, selectionMode: 'multiple', selection: ['r1'] }),
      ),
    ).toBe(false)
  })

  it('row aria-selected undefined when selection mode none', () => {
    const r = p.row('r2', 1)
    expect(
      read(r['aria-selected'], init({ columns: COLS, rows: ROWS, selectionMode: 'none' })),
    ).toBeUndefined()
  })

  it('cell tabindex is 0 only for the focused cell (single tab stop)', () => {
    const c00 = p.cell(0, 0)
    const c11 = p.cell(1, 1)
    const focused = init({ columns: COLS, rows: ROWS, focusedCell: { rowIndex: 1, colIndex: 1 } })
    expect(read(c00.tabindex, focused)).toBe(-1)
    expect(read(c11.tabindex, focused)).toBe(0)
  })

  it('cell tabindex defaults to first cell when nothing focused', () => {
    const c00 = p.cell(0, 0)
    const c01 = p.cell(0, 1)
    const none = init({ columns: COLS, rows: ROWS, focusedCell: null })
    expect(read(c00.tabindex, none)).toBe(0)
    expect(read(c01.tabindex, none)).toBe(-1)
  })

  // #122 — the column header carries the grid's sort control (Enter/Space) but
  // shipped NO tabindex, so it was keyboard-dead: nothing could ever focus it.
  // It now takes the roving tab stop when the header row holds the focused cell.
  it('columnHeader tabindex is 0 only when the header row holds the focused cell', () => {
    const h0 = p.columnHeader('name')
    const h1 = p.columnHeader('age')
    const onHeader = init({
      columns: COLS,
      rows: ROWS,
      focusedCell: { rowIndex: HEADER_ROW_INDEX, colIndex: 0 },
    })
    expect(read(h0.tabindex, onHeader)).toBe(0)
    expect(read(h1.tabindex, onHeader)).toBe(-1)
    // …and never while a data cell holds it.
    const onCell = init({ columns: COLS, rows: ROWS, focusedCell: { rowIndex: 1, colIndex: 0 } })
    expect(read(h0.tabindex, onCell)).toBe(-1)
    expect(read(h1.tabindex, onCell)).toBe(-1)
  })

  it('columnHeader stays out of the tab sequence while cell(0,0) is the entry stop', () => {
    const none = init({ columns: COLS, rows: ROWS, focusedCell: null })
    for (const c of COLS) expect(read(p.columnHeader(c.id).tabindex, none)).toBe(-1)
    expect(read(p.cell(0, 0).tabindex, none)).toBe(0)
  })

  // With zero rows there is no cell to rove to, so the grid used to have NO tab
  // stop at all and was unreachable — sort included. The first header takes it.
  it('with no rows the first column header takes the grid entry tab stop', () => {
    const empty = init({ columns: COLS, rows: [], focusedCell: null })
    expect(read(p.columnHeader('name').tabindex, empty)).toBe(0)
    expect(read(p.columnHeader('age').tabindex, empty)).toBe(-1)
    expect(read(p.columnHeader('note').tabindex, empty)).toBe(-1)
  })

  it('columnHeader reports its grid coordinates for roving DOM focus', () => {
    const s = init({ columns: COLS, rows: ROWS })
    const h = p.columnHeader('age')
    expect(h['data-row-index']).toBe(HEADER_ROW_INDEX)
    expect(read(h['data-col-index'], s)).toBe(1)
    expect(
      read(
        h['data-focused'],
        init({
          columns: COLS,
          rows: ROWS,
          focusedCell: { rowIndex: HEADER_ROW_INDEX, colIndex: 1 },
        }),
      ),
    ).toBe('')
    expect(read(h['data-focused'], s)).toBeUndefined()
  })

  it('columnHeader onFocus sends focusCell on the header row', () => {
    const send = vi.fn()
    const pc = connect(signalState(init({ columns: COLS, rows: ROWS })), send, { id: 't' })
    pc.columnHeader('note').onFocus(new FocusEvent('focus'))
    expect(send).toHaveBeenCalledWith({
      type: 'focusCell',
      rowIndex: HEADER_ROW_INDEX,
      colIndex: 2,
    })
  })

  it('rowCheckbox onClick sends toggleRow', () => {
    const send = vi.fn()
    const pc = connect(
      signalState(init({ columns: COLS, rows: ROWS, selectionMode: 'multiple' })),
      send,
      { id: 't' },
    )
    pc.rowCheckbox('r2', 1).onClick(clickEvent(false))
    expect(send).toHaveBeenCalledWith({ type: 'toggleRow', id: 'r2', index: 1 })
  })

  it('rowCheckbox onClick stops propagation (avoids double-toggle via the row)', () => {
    const send = vi.fn()
    const pc = connect(
      signalState(init({ columns: COLS, rows: ROWS, selectionMode: 'multiple' })),
      send,
      { id: 't' },
    )
    const e = clickEvent(false)
    const stop = vi.spyOn(e, 'stopPropagation')
    pc.rowCheckbox('r2', 1).onClick(e)
    expect(stop).toHaveBeenCalled()
  })

  it('selectAllCheckbox onClick stops propagation', () => {
    const send = vi.fn()
    const pc = connect(
      signalState(init({ columns: COLS, rows: ROWS, selectionMode: 'multiple' })),
      send,
      { id: 't' },
    )
    const e = clickEvent(false)
    const stop = vi.spyOn(e, 'stopPropagation')
    pc.selectAllCheckbox.onClick(e)
    expect(stop).toHaveBeenCalled()
  })

  it('rowCheckbox shift-click sends selectRange', () => {
    const send = vi.fn()
    const pc = connect(
      signalState(init({ columns: COLS, rows: ROWS, selectionMode: 'multiple' })),
      send,
      { id: 't' },
    )
    pc.rowCheckbox('r2', 1).onClick(clickEvent(true))
    expect(send).toHaveBeenCalledWith({ type: 'selectRange', index: 1 })
  })

  it('selectAllCheckbox onClick sends toggleAll', () => {
    const send = vi.fn()
    const pc = connect(
      signalState(init({ columns: COLS, rows: ROWS, selectionMode: 'multiple' })),
      send,
      { id: 't' },
    )
    pc.selectAllCheckbox.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'toggleAll' })
  })

  // The checkbox parts ship a Space handler (#122 — selection used to be
  // mouse-only) but stay OUT of the tab sequence. A `role="grid"` has exactly
  // one tab stop under APG's Grid pattern; N focusable row checkboxes inside it
  // is a regression, not an improvement, and row selection is already operable
  // from that single tab stop (cell + arrows + Space). The Space handler stays
  // for when the checkbox is focused programmatically.
  it('checkbox parts stay OUT of the tab sequence (grid keeps one tab stop)', () => {
    const base = init({ columns: COLS, rows: ROWS, selectionMode: 'multiple' })
    const pc = connect(rootSignal(), vi.fn(), { id: 't' })
    expect(read(pc.rowCheckbox('r2', 1).tabindex, base)).toBe(-1)
    expect(read(pc.selectAllCheckbox.tabindex, base)).toBe(-1)
    const disabled = { ...base, disabled: true }
    expect(read(pc.rowCheckbox('r2', 1).tabindex, disabled)).toBe(-1)
    expect(read(pc.selectAllCheckbox.tabindex, disabled)).toBe(-1)
  })

  it('rowCheckbox toggles the row on Space', () => {
    const send = vi.fn()
    const pc = connect(
      signalState(init({ columns: COLS, rows: ROWS, selectionMode: 'multiple' })),
      send,
      { id: 't' },
    )
    const e = new KeyboardEvent('keydown', { key: ' ', cancelable: true })
    const stop = vi.spyOn(e, 'stopPropagation')
    pc.rowCheckbox('r2', 1).onKeyDown(e)
    expect(send).toHaveBeenCalledWith({ type: 'toggleRow', id: 'r2', index: 1 })
    expect(e.defaultPrevented).toBe(true)
    // The checkbox sits INSIDE a gridcell whose own Space handler also toggles
    // the row; without stopping the key would toggle twice and cancel out.
    expect(stop).toHaveBeenCalled()
  })

  it('selectAllCheckbox toggles everything on Space', () => {
    const send = vi.fn()
    const pc = connect(
      signalState(init({ columns: COLS, rows: ROWS, selectionMode: 'multiple' })),
      send,
      { id: 't' },
    )
    const e = new KeyboardEvent('keydown', { key: ' ', cancelable: true })
    const stop = vi.spyOn(e, 'stopPropagation')
    pc.selectAllCheckbox.onKeyDown(e)
    expect(send).toHaveBeenCalledWith({ type: 'toggleAll' })
    expect(e.defaultPrevented).toBe(true)
    // The select-all sits inside a sortable column header whose Space toggles
    // sort — same double-fire hazard.
    expect(stop).toHaveBeenCalled()
  })

  it('checkbox parts ignore other keys', () => {
    const send = vi.fn()
    const pc = connect(
      signalState(init({ columns: COLS, rows: ROWS, selectionMode: 'multiple' })),
      send,
      { id: 't' },
    )
    pc.rowCheckbox('r2', 1).onKeyDown(new KeyboardEvent('keydown', { key: 'a' }))
    pc.selectAllCheckbox.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    expect(send).not.toHaveBeenCalled()
  })
})

describe('table.connect — full grid keyboard nav with single tab stop', () => {
  const make = (state: ReturnType<typeof init>) => {
    const send = vi.fn()
    const pc = connect(signalState(state), send, { id: 't' })
    return { send, pc }
  }
  const press = (
    cell: { onKeyDown: (e: KeyboardEvent) => void },
    key: string,
    mods: Partial<{ ctrlKey: boolean; metaKey: boolean }> = {},
  ) => cell.onKeyDown(new KeyboardEvent('keydown', { key, cancelable: true, ...mods }))

  it('arrows send moveCell', () => {
    const s = init({ columns: COLS, rows: ROWS, focusedCell: { rowIndex: 0, colIndex: 0 } })
    const { send, pc } = make(s)
    press(pc.cell(0, 0), 'ArrowRight')
    expect(send).toHaveBeenCalledWith({ type: 'moveCell', dRow: 0, dCol: 1 })
    press(pc.cell(0, 0), 'ArrowDown')
    expect(send).toHaveBeenCalledWith({ type: 'moveCell', dRow: 1, dCol: 0 })
    press(pc.cell(0, 0), 'ArrowLeft')
    expect(send).toHaveBeenCalledWith({ type: 'moveCell', dRow: 0, dCol: -1 })
    press(pc.cell(0, 0), 'ArrowUp')
    expect(send).toHaveBeenCalledWith({ type: 'moveCell', dRow: -1, dCol: 0 })
  })

  it('Home/End send rowStart/rowEnd; Ctrl+Home/End send gridStart/gridEnd', () => {
    const s = init({ columns: COLS, rows: ROWS, focusedCell: { rowIndex: 1, colIndex: 1 } })
    const { send, pc } = make(s)
    press(pc.cell(1, 1), 'Home')
    expect(send).toHaveBeenCalledWith({ type: 'rowStart' })
    press(pc.cell(1, 1), 'End')
    expect(send).toHaveBeenCalledWith({ type: 'rowEnd' })
    press(pc.cell(1, 1), 'Home', { ctrlKey: true })
    expect(send).toHaveBeenCalledWith({ type: 'gridStart' })
    press(pc.cell(1, 1), 'End', { ctrlKey: true })
    expect(send).toHaveBeenCalledWith({ type: 'gridEnd' })
  })

  it('PageDown/PageUp send pageDown/pageUp', () => {
    const s = init({ columns: COLS, rows: ROWS, focusedCell: { rowIndex: 0, colIndex: 0 } })
    const { send, pc } = make(s)
    press(pc.cell(0, 0), 'PageDown')
    expect(send).toHaveBeenCalledWith({ type: 'pageDown' })
    press(pc.cell(0, 0), 'PageUp')
    expect(send).toHaveBeenCalledWith({ type: 'pageUp' })
  })

  it('Space toggles the row at the focused cell', () => {
    const s = init({
      columns: COLS,
      rows: ROWS,
      selectionMode: 'multiple',
      focusedCell: { rowIndex: 2, colIndex: 1 },
    })
    const { send, pc } = make(s)
    press(pc.cell(2, 1), ' ')
    expect(send).toHaveBeenCalledWith({ type: 'toggleRow', id: 'r3', index: 2 })
  })

  it('Enter activates the focused row', () => {
    const s = init({ columns: COLS, rows: ROWS, focusedCell: { rowIndex: 1, colIndex: 0 } })
    const { send, pc } = make(s)
    press(pc.cell(1, 0), 'Enter')
    expect(send).toHaveBeenCalledWith({ type: 'activateRow', id: 'r2', index: 1 })
  })

  // The name says "the grid", so the count must cover EVERY part that carries a
  // tabindex — not just the cells. Counting cells alone let N focusable row
  // checkboxes be added inside the grid with this test still green; counting
  // the checkboxes but not the COLUMN HEADERS would let the roving header
  // introduce a second one just as quietly.
  it('exactly one tab stop across the whole grid, counting every part', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 't' })
    // Widened to `number` on purpose: the checkbox parts are TYPED as the
    // literal `-1`, and comparing that to 0 directly is a compile error rather
    // than a runtime count.
    const countTabStops = (s: ReturnType<typeof init>): number => {
      const isTabStop = (part: { tabindex: Signal<number> | number }): boolean =>
        read<number>(part.tabindex, s) === 0
      let zeroCount = 0
      for (const c of s.columns) {
        if (isTabStop(p.columnHeader(c.id))) zeroCount++
      }
      for (let r = 0; r < s.rows.length; r++) {
        for (let c = 0; c < s.columns.length; c++) {
          if (isTabStop(p.cell(r, c))) zeroCount++
        }
        if (isTabStop(p.rowCheckbox(s.rows[r]!, r))) zeroCount++
      }
      if (isTabStop(p.selectAllCheckbox)) zeroCount++
      return zeroCount
    }
    const base = { columns: COLS, rows: ROWS, selectionMode: 'multiple' as const }
    // …with a data cell focused,
    expect(countTabStops(init({ ...base, focusedCell: { rowIndex: 2, colIndex: 1 } }))).toBe(1)
    // …with the HEADER row focused (the roving header must not ADD a stop),
    expect(
      countTabStops(init({ ...base, focusedCell: { rowIndex: HEADER_ROW_INDEX, colIndex: 0 } })),
    ).toBe(1)
    // …with nothing focused,
    expect(countTabStops(init({ ...base, focusedCell: null }))).toBe(1)
    // …and with no rows at all, where there is no cell to carry it.
    expect(countTabStops(init({ ...base, rows: [], focusedCell: null }))).toBe(1)
  })

  // The header row joins the roving sequence, so the grid's two header-hosted
  // controls — sort and select-all — are reachable from the single tab stop.
  it('arrows move into, along, and back out of the header row', () => {
    const s = init({
      columns: COLS,
      rows: ROWS,
      focusedCell: { rowIndex: HEADER_ROW_INDEX, colIndex: 0 },
    })
    const { send, pc } = make(s)
    const header = pc.columnHeader('name')
    press(header, 'ArrowRight')
    expect(send).toHaveBeenCalledWith({ type: 'moveCell', dRow: 0, dCol: 1 })
    press(header, 'ArrowLeft')
    expect(send).toHaveBeenCalledWith({ type: 'moveCell', dRow: 0, dCol: -1 })
    press(header, 'ArrowDown')
    expect(send).toHaveBeenCalledWith({ type: 'moveCell', dRow: 1, dCol: 0 })
    press(header, 'ArrowUp')
    expect(send).toHaveBeenCalledWith({ type: 'moveCell', dRow: -1, dCol: 0 })
    press(header, 'Home')
    expect(send).toHaveBeenCalledWith({ type: 'rowStart' })
    press(header, 'End', { ctrlKey: true })
    expect(send).toHaveBeenCalledWith({ type: 'gridEnd' })
  })

  // The sort handler predates this PR and was UNREACHABLE: `columnHeader`
  // carried no tabindex, so nothing could focus it and Enter/Space could never
  // arrive. The roving header is what makes this test meaningful.
  it('the roving header sorts on Enter and Space', () => {
    const s = init({
      columns: COLS,
      rows: ROWS,
      focusedCell: { rowIndex: HEADER_ROW_INDEX, colIndex: 0 },
    })
    const { send, pc } = make(s)
    // Reachability is half the property: the header holds the tab stop here.
    expect(read<number>(pc.columnHeader('name').tabindex, s)).toBe(0)

    const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true })
    pc.columnHeader('name').onKeyDown(enter)
    expect(send).toHaveBeenCalledWith({ type: 'toggleSort', columnId: 'name' })
    expect(enter.defaultPrevented).toBe(true)

    send.mockClear()
    const space = new KeyboardEvent('keydown', { key: ' ', cancelable: true })
    pc.columnHeader('age').onKeyDown(space)
    expect(send).toHaveBeenCalledWith({ type: 'toggleSort', columnId: 'age' })
    expect(space.defaultPrevented).toBe(true)

    // A non-sortable header claims nothing.
    send.mockClear()
    const inert = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true })
    pc.columnHeader('note').onKeyDown(inert)
    expect(send).not.toHaveBeenCalled()
    expect(inert.defaultPrevented).toBe(false)
  })

  // The select-all checkbox has no cell of its own — it lives in a
  // `columnheader`. Naming that column puts it on the roving header's
  // Enter/Space, which is a keyboard user's ONLY route to it (#122).
  it('the select-all column header toggles every row on Space and Enter', () => {
    const cols = [{ id: 'sel' }, ...COLS]
    const s = init({
      columns: cols,
      rows: ROWS,
      selectionMode: 'multiple',
      focusedCell: { rowIndex: HEADER_ROW_INDEX, colIndex: 0 },
    })
    const send = vi.fn()
    const pc = connect(signalState(s), send, { id: 't', selectAllColumnId: 'sel' })
    expect(read<number>(pc.columnHeader('sel').tabindex, s)).toBe(0)

    const space = new KeyboardEvent('keydown', { key: ' ', cancelable: true })
    pc.columnHeader('sel').onKeyDown(space)
    expect(send).toHaveBeenCalledWith({ type: 'toggleAll' })
    expect(space.defaultPrevented).toBe(true)

    send.mockClear()
    pc.columnHeader('sel').onKeyDown(
      new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }),
    )
    expect(send).toHaveBeenCalledWith({ type: 'toggleAll' })
  })

  it('the select-all column header claims nothing outside multiple-selection mode', () => {
    const cols = [{ id: 'sel' }, ...COLS]
    const s = init({
      columns: cols,
      rows: ROWS,
      selectionMode: 'single',
      focusedCell: { rowIndex: HEADER_ROW_INDEX, colIndex: 0 },
    })
    const send = vi.fn()
    const pc = connect(signalState(s), send, { id: 't', selectAllColumnId: 'sel' })
    const e = new KeyboardEvent('keydown', { key: ' ', cancelable: true })
    pc.columnHeader('sel').onKeyDown(e)
    expect(send).not.toHaveBeenCalled()
    expect(e.defaultPrevented).toBe(false)
  })

  // Ctrl/Cmd+A is deliberately NOT bound. APG's "Control + A: selects all
  // cells" is a CELL-selection idiom; this grid selects ROWS and `toggleAll`
  // toggles rather than selects, so binding it would hijack the browser's
  // universal select-all for different semantics. The select-all is reached
  // through the roving header instead.
  it('letters — bare or with Ctrl/Cmd — are left to typeahead and the browser', () => {
    const s = init({
      columns: COLS,
      rows: ROWS,
      selectionMode: 'multiple',
      focusedCell: { rowIndex: 1, colIndex: 1 },
    })
    const { send, pc } = make(s)
    for (const mods of [{}, { ctrlKey: true }, { metaKey: true }]) {
      const e = new KeyboardEvent('keydown', { key: 'a', cancelable: true, ...mods })
      pc.cell(1, 1).onKeyDown(e)
      expect(e.defaultPrevented).toBe(false)
    }
    expect(send).not.toHaveBeenCalled()
  })
})

describe('table activateRow / focusCell handlers', () => {
  it('cell onFocus sends focusCell with its coordinates', () => {
    const send = vi.fn()
    const pc = connect(signalState(init({ columns: COLS, rows: ROWS })), send, { id: 't' })
    pc.cell(2, 1).onFocus(new FocusEvent('focus'))
    expect(send).toHaveBeenCalledWith({ type: 'focusCell', rowIndex: 2, colIndex: 1 })
  })

  it('row onClick selects the row', () => {
    const send = vi.fn()
    const pc = connect(
      signalState(init({ columns: COLS, rows: ROWS, selectionMode: 'single' })),
      send,
      { id: 't' },
    )
    pc.row('r3', 2).onClick(clickEvent(false))
    expect(send).toHaveBeenCalledWith({ type: 'toggleRow', id: 'r3', index: 2 })
  })

  it('isRowSelected helper', () => {
    expect(isRowSelected(init({ columns: COLS, rows: ROWS, selection: ['r1'] }), 'r1')).toBe(true)
    expect(isRowSelected(init({ columns: COLS, rows: ROWS, selection: ['r1'] }), 'r2')).toBe(false)
  })
})

// --- local helpers ---

import { pathHandle, type Signal } from '@llui/dom'

function signalState<S>(value: S): Signal<S> {
  return pathHandle<S>(() => value, '')
}

function clickEvent(shift: boolean): MouseEvent {
  return new MouseEvent('click', { shiftKey: shift })
}
