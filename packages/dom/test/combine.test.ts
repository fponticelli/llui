// Tests for `combine()` — the reducer-composition helper.
// See `docs/proposals/unified-composition-model.md`.

import { describe, it, expect } from 'vitest'
import { combine } from '../src/combine'

describe('combine()', () => {
  type MatrixState = { name: string; cells: number }
  type UiState = { sidebarOpen: boolean }
  type AppState = { matrix: MatrixState; ui: UiState }

  type MatrixMsg =
    | { type: 'matrix/setName'; v: string }
    | { type: 'matrix/addCell' }
  type UiMsg = { type: 'ui/toggleSidebar' }
  type TopMsg = { type: 'reset' }
  type AppMsg = MatrixMsg | UiMsg | TopMsg

  type Effect = { type: 'log'; msg: string }

  const matrixUpdate = (
    s: MatrixState,
    m: MatrixMsg,
  ): [MatrixState, Effect[]] => {
    switch (m.type) {
      case 'matrix/setName':
        return [{ ...s, name: m.v }, [{ type: 'log', msg: 'name set' }]]
      case 'matrix/addCell':
        return [{ ...s, cells: s.cells + 1 }, []]
    }
  }

  const uiUpdate = (s: UiState, m: UiMsg): [UiState, Effect[]] => {
    switch (m.type) {
      case 'ui/toggleSidebar':
        return [{ ...s, sidebarOpen: !s.sidebarOpen }, []]
    }
  }

  const initialState: AppState = {
    matrix: { name: 'untitled', cells: 0 },
    ui: { sidebarOpen: false },
  }

  it('routes a slice-prefixed message to the matching reducer', () => {
    const update = combine<AppState, AppMsg, Effect>({
      matrix: matrixUpdate,
      ui: uiUpdate,
    })
    const [next, effects] = update(initialState, { type: 'matrix/setName', v: 'My Decision' })
    expect(next.matrix.name).toBe('My Decision')
    expect(next.ui).toBe(initialState.ui) // ui untouched ⇒ reference preserved
    expect(effects).toEqual([{ type: 'log', msg: 'name set' }])
  })

  it('preserves the top-level state reference when the slice reducer returns the same slice', () => {
    const noop = (s: MatrixState): [MatrixState, Effect[]] => [s, []]
    const update = combine<AppState, AppMsg, Effect>({
      matrix: noop,
    })
    const [next] = update(initialState, { type: 'matrix/setName', v: 'whatever' })
    // Slice reducer returned the SAME slice — combine() must NOT create a
    // new top-level state object. Reference equality drives the path-keyed
    // reactivity walker; spurious reference churn would over-fire bindings.
    expect(next).toBe(initialState)
  })

  it('routes unprefixed messages to the optional _top reducer', () => {
    const top = (_s: AppState, m: AppMsg): [AppState, Effect[]] => {
      if (m.type === 'reset') return [initialState, [{ type: 'log', msg: 'reset' }]]
      return [_s, []]
    }
    const update = combine<AppState, AppMsg, Effect>(
      { matrix: matrixUpdate, ui: uiUpdate },
      top,
    )
    const mutated: AppState = { matrix: { name: 'x', cells: 5 }, ui: { sidebarOpen: true } }
    const [next, effects] = update(mutated, { type: 'reset' })
    expect(next).toBe(initialState)
    expect(effects).toEqual([{ type: 'log', msg: 'reset' }])
  })

  it('returns state unchanged when no slice matches and no _top is provided', () => {
    const update = combine<AppState, AppMsg, Effect>({
      matrix: matrixUpdate,
    })
    // Message that doesn't match any slice and there's no _top:
    const [next, effects] = update(initialState, { type: 'reset' })
    expect(next).toBe(initialState)
    expect(effects).toEqual([])
  })

  it('routes ui/toggleSidebar correctly when matrix is also in the map', () => {
    const update = combine<AppState, AppMsg, Effect>({
      matrix: matrixUpdate,
      ui: uiUpdate,
    })
    const [next, effects] = update(initialState, { type: 'ui/toggleSidebar' })
    expect(next.ui.sidebarOpen).toBe(true)
    expect(next.matrix).toBe(initialState.matrix) // matrix slice unchanged ⇒ reference preserved
    expect(effects).toEqual([])
  })

  it('drops a message whose slice prefix is unknown to the map (no _top)', () => {
    const update = combine<AppState, AppMsg, Effect>({
      matrix: matrixUpdate,
    })
    // ui/toggleSidebar has a `/` but slices map doesn't define `ui`. Falls
    // through; no _top; state unchanged.
    const [next] = update(initialState, { type: 'ui/toggleSidebar' })
    expect(next).toBe(initialState)
  })

  it('passes the slice reducer the FULL message (including the prefix)', () => {
    // This is the contract: slice reducers should be usable standalone
    // (without combine()) by their own tests. They match on `.type` with
    // the full namespace.
    let observedType: string | null = null
    const spy = (
      s: MatrixState,
      m: MatrixMsg,
    ): [MatrixState, Effect[]] => {
      observedType = m.type
      return [s, []]
    }
    const update = combine<AppState, AppMsg, Effect>({ matrix: spy })
    update(initialState, { type: 'matrix/setName', v: 'x' })
    expect(observedType).toBe('matrix/setName')
  })

  it('bubbles effects from slice reducers unchanged', () => {
    const update = combine<AppState, AppMsg, Effect>({
      matrix: matrixUpdate,
      ui: uiUpdate,
    })
    const [, effects] = update(initialState, { type: 'matrix/setName', v: 'x' })
    expect(effects).toHaveLength(1)
    expect(effects[0]).toEqual({ type: 'log', msg: 'name set' })
  })
})
