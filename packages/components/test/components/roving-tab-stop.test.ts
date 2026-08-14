import { describe, it, expect, vi } from 'vitest'
import * as toolbar from '../../src/components/toolbar'
import * as toggleGroup from '../../src/components/toggle-group'
import * as treeView from '../../src/components/tree-view'
import * as radioGroup from '../../src/components/radio-group'
import * as menubar from '../../src/components/menubar'
import * as navigationMenu from '../../src/components/navigation-menu'
import * as tagsInput from '../../src/components/tags-input'
import type { TagsInputState } from '../../src/components/tags-input'
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
 *
 * #145 routed the last three — `menubar`, `navigation-menu` and `tags-input` —
 * through the same helper; they had the identical defect, outside #126's named
 * criteria. Every roving-tabindex widget in the package is now covered here.
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

  it('menubar', () => {
    // The bar has no other focusable element, so losing the stop makes it
    // keyboard-unreachable outright (#145).
    const state = {
      ...menubar.init({
        menus: [
          { id: 'a', items: [] },
          { id: 'b', items: [] },
        ],
      }),
      focused: 'c',
    }
    const parts = menubar.connect(rootSignal(), vi.fn(), { id: 'mb' })
    expect(tabStops(['a', 'b'], (v) => read(parts.menuTrigger(v).tabindex, state))).toEqual(['a'])
  })

  it('menubar (focused menu disabled)', () => {
    const state = {
      ...menubar.init({ menus: items.map((id) => ({ id, items: [] })) }),
      focused: 'a',
      disabledMenus: ['a'],
    }
    const parts = menubar.connect(rootSignal(), vi.fn(), { id: 'mb' })
    expect(tabStops(items, (v) => read(parts.menuTrigger(v).tabindex, state))).toEqual(['b'])
  })

  it('navigation-menu', () => {
    const [state] = navigationMenu.update(navigationMenu.init({ items, focused: 'c' }), {
      type: 'setItems',
      items: ['a', 'b'],
    })
    expect(state.focused).toBe('c')
    const parts = navigationMenu.connect(rootSignal(), vi.fn(), { id: 'nav' })
    const tabindex = (v: string): number =>
      read(parts.item(v, { isBranch: false }).trigger.tabindex, state)
    expect(tabStops(['a', 'b'], tabindex)).toEqual(['a'])
  })

  it('tags-input', () => {
    // Only the CHIPS lose their stop here — the text input is a plain <input>
    // and stays a natural tab stop — but the tag list becomes unreachable by
    // Tab, so a keyboard user cannot reach a chip to delete it.
    const [state] = tagsInput.update(
      { ...tagsInput.init({ value: items }), focusedIndex: 2 },
      { type: 'setValue', value: ['a', 'b'] },
    )
    expect(state.focusedIndex).toBe(2)
    const parts = tagsInput.connect(rootSignal(), vi.fn())
    const tabindex = (v: string): number =>
      read(parts.tag(v, ['a', 'b'].indexOf(v)).root.tabindex, state)
    expect(tabStops(['a', 'b'], tabindex)).toEqual(['a'])
  })
})

describe('tags-input keeps the stop on a real tag across setValue (#145)', () => {
  // `removeTag` clears `focusedIndex` explicitly; `setValue` is the path that
  // replaces the list and leaves the index behind.
  const parts = (): ReturnType<typeof tagsInput.connect> => tagsInput.connect(rootSignal(), vi.fn())

  const stops = (state: TagsInputState): string[] => {
    const p = parts()
    return state.value.filter((v, i) => read(p.tag(v, i).root.tabindex, state) === 0)
  }

  it('a SHORTER list leaves no index dangling', () => {
    const [state] = tagsInput.update(
      { ...tagsInput.init({ value: ['a', 'b', 'c'] }), focusedIndex: 2 },
      { type: 'setValue', value: ['a', 'b'] },
    )
    expect(stops(state)).toEqual(['a'])
  })

  it('an EMPTY list leaves no stop to seat', () => {
    const [state] = tagsInput.update(
      { ...tagsInput.init({ value: ['a', 'b', 'c'] }), focusedIndex: 1 },
      { type: 'setValue', value: [] },
    )
    // `focusedIndex` survives `setValue` untouched — that dangling reference IS
    // the defect. Filtering `state.value` here would assert nothing at all (it
    // is empty, so ANY implementation answers `[]`), so probe the indices the
    // OLD list held, the stale index 1 among them: it is exactly the one the
    // inline `s.focusedIndex === index ? 0 : -1` handed a `tabindex="0"` to.
    expect(state.focusedIndex).toBe(1)
    const p = parts()
    expect([0, 1, 2].map((i) => read(p.tag('a', i).root.tabindex, state))).toEqual([-1, -1, -1])
  })

  it('a REORDERED list of the same length keeps the stop on a real member', () => {
    const [state] = tagsInput.update(
      { ...tagsInput.init({ value: ['a', 'b', 'c'] }), focusedIndex: 2 },
      { type: 'setValue', value: ['c', 'b', 'a'] },
    )
    expect(stops(state)).toEqual(['a'])
  })

  it('a null focusedIndex leaves the stop with the text input', () => {
    // The chips are ENTERED from the input with ArrowLeft; seating a chip here
    // would put it ahead of the input in the Tab order.
    const state = tagsInput.init({ value: ['a', 'b'] })
    expect(state.focusedIndex).toBeNull()
    expect(stops(state)).toEqual([])
  })

  it('gives one stop per duplicate-valued chip list, not two', () => {
    // `unique: false` allows two chips with the same text, which is why the
    // stop is resolved by INDEX and not by value.
    const [state] = tagsInput.update(
      { ...tagsInput.init({ value: ['a', 'a'], unique: false }), focusedIndex: 5 },
      { type: 'setValue', value: ['a', 'a'] },
    )
    const p = parts()
    const marked = state.value.filter((v, i) => read(p.tag(v, i).root.tabindex, state) === 0)
    expect(marked).toHaveLength(1)
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
