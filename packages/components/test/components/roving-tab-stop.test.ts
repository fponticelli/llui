import { describe, it, expect, vi } from 'vitest'
import * as toolbar from '../../src/components/toolbar'
import * as toggleGroup from '../../src/components/toggle-group'
import * as treeView from '../../src/components/tree-view'
import * as radioGroup from '../../src/components/radio-group'
import { rootSignal, read } from '../_signal'

/**
 * WAI-ARIA's roving-tabindex pattern requires EXACTLY ONE tab stop in a
 * composite widget (#126).
 *
 * `toggle-group.setItems` and `tree-view.setVisibleItems` never pruned
 * `focused`, so shrinking the list past the focused item left every remaining
 * item at `tabindex="-1"` — the widget disappeared from the Tab order
 * entirely. `toolbar` pruned correctly; the divergence is traceable to the
 * three private copies of the same navigation code.
 */

const items = ['a', 'b', 'c']

const tabStops = (values: readonly string[], tabindex: (value: string) => number): string[] =>
  values.filter((v) => tabindex(v) === 0)

describe('exactly one tab stop survives a list shrink', () => {
  it('toolbar', () => {
    const [state] = toolbar.update(toolbar.init({ items, focused: 'c' }), {
      type: 'setItems',
      items: ['a', 'b'],
    })
    const parts = toolbar.connect(rootSignal(), vi.fn(), { id: 't' })
    expect(tabStops(['a', 'b'], (v) => read(parts.item(v).root.tabindex, state))).toEqual(['a'])
  })

  it('toggle-group', () => {
    const [state] = toggleGroup.update(toggleGroup.init({ items, focused: 'c' }), {
      type: 'setItems',
      items: ['a', 'b'],
    })
    expect(state.focused).not.toBe('c')
    const parts = toggleGroup.connect(rootSignal(), vi.fn())
    expect(tabStops(['a', 'b'], (v) => read(parts.item(v).root.tabindex, state))).toEqual(['a'])
  })

  it('tree-view', () => {
    const [state] = treeView.update(
      { ...treeView.init({ visibleItems: items }), focused: 'c' },
      { type: 'setVisibleItems', ids: ['a', 'b'] },
    )
    expect(state.focused).not.toBe('c')
    const parts = treeView.connect(rootSignal(), vi.fn(), { id: 'tv' })
    expect(tabStops(['a', 'b'], (v) => read(parts.item(v, 0, false).item.tabindex, state))).toEqual(
      ['a'],
    )
  })

  it('radio-group', () => {
    const [state] = radioGroup.update(radioGroup.init({ items, value: 'c' }), {
      type: 'setItems',
      items: ['a', 'b'],
    })
    const parts = radioGroup.connect(rootSignal(), vi.fn(), { id: 'rg' })
    expect(tabStops(['a', 'b'], (v) => read(parts.item(v).root.tabindex, state))).toEqual(['a'])
  })
})

describe('exactly one tab stop before anything is focused', () => {
  it('tree-view is reachable by Tab with no focused item', () => {
    const state = treeView.init({ visibleItems: items })
    const parts = treeView.connect(rootSignal(), vi.fn(), { id: 'tv' })
    expect(tabStops(items, (v) => read(parts.item(v, 0, false).item.tabindex, state))).toEqual([
      'a',
    ])
  })

  it('toolbar is reachable by Tab with no focused item', () => {
    const state = toolbar.init({ items })
    const parts = toolbar.connect(rootSignal(), vi.fn(), { id: 't' })
    expect(tabStops(items, (v) => read(parts.item(v).root.tabindex, state))).toEqual(['a'])
  })

  it('toggle-group is reachable by Tab with no focused item', () => {
    const state = toggleGroup.init({ items })
    const parts = toggleGroup.connect(rootSignal(), vi.fn())
    expect(tabStops(items, (v) => read(parts.item(v).root.tabindex, state))).toEqual(['a'])
  })
})

describe('navigation from an unknown `from` behaves the same everywhere', () => {
  // One rule, documented on `nextEnabled`: a stale `from` restarts at the first
  // enabled item instead of dead-ending. toolbar and radio-group used to answer
  // "unchanged" while the shared helper answered 'a'.
  it('toolbar', () => {
    const [state] = toolbar.update(toolbar.init({ items }), { type: 'focusNext', from: 'zzz' })
    expect(state.focused).toBe('a')
  })

  it('radio-group', () => {
    const [state] = radioGroup.update(radioGroup.init({ items }), {
      type: 'selectNext',
      from: 'zzz',
    })
    expect(state.value).toBe('a')
  })

  it('toggle-group', () => {
    const [state] = toggleGroup.update(toggleGroup.init({ items }), {
      type: 'focusNext',
      from: 'zzz',
    })
    expect(state.focused).toBe('a')
  })
})

describe('radio-group honours loopFocus', () => {
  it('wraps by default', () => {
    const [state] = radioGroup.update(radioGroup.init({ items }), { type: 'selectNext', from: 'c' })
    expect(state.value).toBe('a')
  })

  it('stops at the end when loopFocus is off', () => {
    const s0 = radioGroup.init({ items, loopFocus: false })
    expect(radioGroup.update(s0, { type: 'selectNext', from: 'c' })[0].value).toBeNull()
    expect(radioGroup.update(s0, { type: 'selectPrev', from: 'a' })[0].value).toBeNull()
  })
})
