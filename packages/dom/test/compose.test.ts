import { describe, it, expect } from 'vitest'
import { childHandlers, mergeHandlers } from '../src'
import type { ChildState, ChildMsg, ModuleState, ModuleMsg } from '../src'

// ── Mock component modules ─────────────────────────────────────

interface DialogState {
  open: boolean
}
type DialogMsg = { type: 'open' } | { type: 'close' }

const dialog = {
  init: (): DialogState => ({ open: false }),
  update: (state: DialogState, msg: DialogMsg): [DialogState, never[]] => {
    switch (msg.type) {
      case 'open':
        return [{ open: true }, []]
      case 'close':
        return [{ open: false }, []]
    }
  },
}

interface SortState {
  dragging: string | null
}
type SortMsg = { type: 'start'; id: string } | { type: 'drop' }

const sortable = {
  init: (): SortState => ({ dragging: null }),
  update: (state: SortState, msg: SortMsg): [SortState, never[]] => {
    switch (msg.type) {
      case 'start':
        return [{ dragging: msg.id }, []]
      case 'drop':
        return [{ dragging: null }, []]
    }
  },
}

// ── Type-level tests ────────────────────────────────────────────

const children = { dialog, sort: sortable } as const

// Verify ModuleState and ModuleMsg extract correctly
type _CheckDialogState = ModuleState<typeof dialog> extends DialogState ? true : never
type _CheckDialogMsg = ModuleMsg<typeof dialog> extends DialogMsg ? true : never
type _CheckSortState = ModuleState<typeof sortable> extends SortState ? true : never
type _CheckSortMsg = ModuleMsg<typeof sortable> extends SortMsg ? true : never

// Verify ChildState produces the correct shape
type CS = ChildState<typeof children>
type _CheckCS = CS extends { dialog: DialogState; sort: SortState } ? true : never

// Verify ChildMsg produces the correct union
type CM = ChildMsg<typeof children>
type _CheckCM = CM extends { type: 'dialog'; msg: DialogMsg } | { type: 'sort'; msg: SortMsg }
  ? true
  : never

// Compile-time assertion: if any _Check type resolves to `never`, this
// assignment would fail. The fact that tsc accepts this file means the
// types are correct.
const _typeAssertions: [
  _CheckDialogState,
  _CheckDialogMsg,
  _CheckSortState,
  _CheckSortMsg,
  _CheckCS,
  _CheckCM,
] = [true, true, true, true, true, true]
void _typeAssertions

// ── Full composition test ───────────────────────────────────────

type State = ChildState<typeof children> & { items: string[] }
type Msg = ChildMsg<typeof children> | { type: 'addItem'; text: string }

describe('childHandlers', () => {
  const update = mergeHandlers<State, Msg, never>(
    childHandlers<State, Msg, never>(children),
    (state, msg) => {
      if (msg.type === 'addItem') {
        return [{ ...state, items: [...state.items, msg.text] }, []]
      }
      return null
    },
  )

  const initial: State = {
    dialog: dialog.init(),
    sort: sortable.init(),
    items: [],
  }

  it('routes dialog messages to dialog.update', () => {
    const [s] = update(initial, { type: 'dialog', msg: { type: 'open' } })
    expect(s.dialog.open).toBe(true)
    expect(s.sort).toEqual(initial.sort)
    expect(s.items).toEqual([])
  })

  it('routes sort messages to sortable.update', () => {
    const [s] = update(initial, { type: 'sort', msg: { type: 'start', id: 'x' } })
    expect(s.sort.dragging).toBe('x')
    expect(s.dialog).toEqual(initial.dialog)
  })

  it('passes non-child messages to the next handler', () => {
    const [s] = update(initial, { type: 'addItem', text: 'hello' })
    expect(s.items).toEqual(['hello'])
    expect(s.dialog).toEqual(initial.dialog)
    expect(s.sort).toEqual(initial.sort)
  })

  it('returns identity state for unmatched messages in merged handler', () => {
    const [s] = update(initial, { type: 'addItem', text: '' })
    expect(s.items).toEqual([''])
  })

  it('preserves all sibling state across child updates', () => {
    let s = initial
    ;[s] = update(s, { type: 'dialog', msg: { type: 'open' } })
    ;[s] = update(s, { type: 'sort', msg: { type: 'start', id: 'a' } })
    ;[s] = update(s, { type: 'addItem', text: 'item1' })
    expect(s.dialog.open).toBe(true)
    expect(s.sort.dragging).toBe('a')
    expect(s.items).toEqual(['item1'])
  })
})
