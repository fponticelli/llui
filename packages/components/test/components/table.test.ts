import { describe, it, expect, vi } from 'vitest'
import { init, update, connect, isRowSelected, isAllSelected } from '../../src/components/table'
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

  it('moveCell down/up clamps to row bounds', () => {
    const s0 = { ...init({ columns: COLS, rows: ROWS }), focusedCell: { rowIndex: 0, colIndex: 1 } }
    const [d] = update(s0, { type: 'moveCell', dRow: 1, dCol: 0 })
    expect(d.focusedCell).toEqual({ rowIndex: 1, colIndex: 1 })
    const [u] = update(s0, { type: 'moveCell', dRow: -1, dCol: 0 })
    expect(u.focusedCell).toEqual({ rowIndex: 0, colIndex: 1 })
    const last = {
      ...init({ columns: COLS, rows: ROWS }),
      focusedCell: { rowIndex: 3, colIndex: 1 },
    }
    const [d2] = update(last, { type: 'moveCell', dRow: 1, dCol: 0 })
    expect(d2.focusedCell).toEqual({ rowIndex: 3, colIndex: 1 })
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

  it('only one cell has tabindex 0 across the grid', () => {
    const s = init({ columns: COLS, rows: ROWS, focusedCell: { rowIndex: 2, colIndex: 1 } })
    const p = connect(rootSignal(), vi.fn(), { id: 't' })
    let zeroCount = 0
    for (let r = 0; r < ROWS.length; r++) {
      for (let c = 0; c < COLS.length; c++) {
        if (read(p.cell(r, c).tabindex, s) === 0) zeroCount++
      }
    }
    expect(zeroCount).toBe(1)
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
