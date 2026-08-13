import { describe, it, expect, vi } from 'vitest'
import { isSignalHandle } from '@llui/dom'
import * as select from '../../src/components/select'
import * as listbox from '../../src/components/listbox'
import * as combobox from '../../src/components/combobox'
import * as treeView from '../../src/components/tree-view'
import * as radioGroup from '../../src/components/radio-group'
import * as toggleGroup from '../../src/components/toggle-group'
import * as menu from '../../src/components/menu'
import * as toolbar from '../../src/components/toolbar'
import { rootSignal } from '../_signal'

/**
 * Per-item work must be O(1) in the list length (#124).
 *
 * `connect()` runs once, but the `state.map(...)` body of every per-item prop
 * runs on EVERY update for EVERY item — so a single `Array.includes` in one of
 * them is a full scan per item, i.e. O(N²) per update over the list (a 200-item
 * select made 800 such scans). The fix derives the lookup ONCE per update and
 * shares it across items.
 *
 * The guard is an operation COUNT, not a wall-clock timing (machine load makes
 * timings unreliable): each state array counts the `includes`/`indexOf` calls
 * made against it, and every component must produce the SAME count for a
 * 20-item list and a 200-item one. Any per-item scan — even of a short array —
 * makes the count grow with N and fails here.
 */

interface ScanCounter {
  includes: number
  indexOf: number
}

const newCounter = (): ScanCounter => ({ includes: 0, indexOf: 0 })

/**
 * A copy of `values` that counts the scans made against it. The real answers
 * come from a private untouched copy, so the instrumentation cannot recurse.
 */
function counted<T>(values: readonly T[], counter: ScanCounter): T[] {
  const source = [...values]
  const arr = [...values]
  arr.includes = (search: T): boolean => {
    counter.includes++
    return source.includes(search)
  }
  arr.indexOf = (search: T): number => {
    counter.indexOf++
    return source.indexOf(search)
  }
  return arr
}

/** Evaluate every reactive prop in a (possibly nested) part bag. */
function readAll(bag: unknown, state: unknown): void {
  if (bag === null || typeof bag !== 'object') return
  for (const value of Object.values(bag)) {
    if (isSignalHandle(value)) value.produce(state)
    else if (value !== null && typeof value === 'object') readAll(value, state)
  }
}

const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `i${i}`)

/**
 * Read every item's parts for a list of `n` values and report the scans it
 * cost. `build` returns the state (holding instrumented arrays) plus the parts.
 */
function scansFor(
  n: number,
  build: (items: string[], counter: ScanCounter) => { state: unknown; read: () => void },
): ScanCounter {
  const counter = newCounter()
  const { read } = build(ids(n), counter)
  read()
  return counter
}

type Build = (items: string[], counter: ScanCounter) => { state: unknown; read: () => void }

/** Every per-item scan grows the count with N; a once-per-update one does not. */
function expectConstantScans(build: Build): void {
  const small = scansFor(20, build)
  const large = scansFor(200, build)
  expect(large).toEqual(small)
}

describe('per-item lookups are O(1) in the list length (#124)', () => {
  it('select', () => {
    expectConstantScans((items, counter) => {
      const state: select.SelectState = {
        ...select.init({ items }),
        value: counted([items[0]!], counter),
        disabledItems: counted([items[1]!], counter),
        items: counted(items, counter),
      }
      const parts = select.connect(rootSignal(), vi.fn(), { id: 'sel' })
      return {
        state,
        read: () => {
          for (const v of items) {
            readAll(parts.item(v), state)
            readAll(parts.hiddenOption(v), state)
          }
        },
      }
    })
  })

  it('listbox', () => {
    expectConstantScans((items, counter) => {
      const state: listbox.ListboxState = {
        ...listbox.init({ items }),
        value: counted([items[0]!], counter),
        disabledItems: counted([items[1]!], counter),
        items: counted(items, counter),
      }
      const parts = listbox.connect(rootSignal(), vi.fn(), { id: 'lb' })
      return {
        state,
        read: () => items.forEach((v, i) => readAll(parts.item(v, i), state)),
      }
    })
  })

  it('combobox', () => {
    expectConstantScans((items, counter) => {
      const state: combobox.ComboboxState = {
        ...combobox.init({ items }),
        value: counted([items[0]!], counter),
        disabledItems: counted([items[1]!], counter),
        items: counted(items, counter),
        filteredItems: counted(items, counter),
      }
      const parts = combobox.connect(rootSignal(), vi.fn(), { id: 'cb' })
      return {
        state,
        read: () => {
          for (const v of items) readAll(parts.item(v), state)
        },
      }
    })
  })

  it('tree-view', () => {
    expectConstantScans((items, counter) => {
      const state: treeView.TreeViewState = {
        ...treeView.init({ visibleItems: items }),
        visibleItems: counted(items, counter),
        expanded: counted([items[0]!], counter),
        selected: counted([items[1]!], counter),
        checked: counted([items[2]!], counter),
        indeterminate: counted([items[3]!], counter),
        loading: counted([], counter),
        loaded: counted([], counter),
        loadFailed: counted([], counter),
      }
      const parts = treeView.connect(rootSignal(), vi.fn(), { id: 'tv' })
      return {
        state,
        read: () => {
          for (const id of items) readAll(parts.item(id, 0, true), state)
        },
      }
    })
  })

  it('radio-group', () => {
    expectConstantScans((items, counter) => {
      const state: radioGroup.RadioGroupState = {
        ...radioGroup.init({ items }),
        items: counted(items, counter),
        disabledItems: counted([items[1]!], counter),
      }
      const parts = radioGroup.connect(rootSignal(), vi.fn(), { id: 'rg' })
      return {
        state,
        read: () => {
          for (const v of items) readAll(parts.item(v), state)
        },
      }
    })
  })

  it('toggle-group', () => {
    expectConstantScans((items, counter) => {
      const state: toggleGroup.ToggleGroupState = {
        ...toggleGroup.init({ items }),
        items: counted(items, counter),
        value: counted([items[0]!], counter),
        disabledItems: counted([items[1]!], counter),
      }
      const parts = toggleGroup.connect(rootSignal(), vi.fn())
      return {
        state,
        read: () => {
          for (const v of items) readAll(parts.item(v), state)
        },
      }
    })
  })

  it('toolbar', () => {
    expectConstantScans((items, counter) => {
      const state: toolbar.ToolbarState = {
        ...toolbar.init({ items }),
        items: counted(items, counter),
        disabledItems: counted([items[1]!], counter),
      }
      const parts = toolbar.connect(rootSignal(), vi.fn(), { id: 'tb' })
      return {
        state,
        read: () => {
          for (const v of items) readAll(parts.item(v), state)
        },
      }
    })
  })

  it('menu (shared item-tree machine)', () => {
    expectConstantScans((items, counter) => {
      const nodes: menu.MenuItem[] = items.map((value) => ({ value, kind: 'action' }))
      const state: menu.MenuState = {
        ...menu.init({ items: nodes }),
        checked: counted([items[0]!], counter),
        openPath: counted([items[1]!], counter),
      }
      const parts = menu.connect(rootSignal(), vi.fn(), { id: 'm' })
      return {
        state,
        read: () => {
          for (const v of items) {
            readAll(parts.item(v), state)
            readAll(parts.checkboxItem(v), state)
            readAll(parts.subTrigger(v), state)
            readAll(parts.subContent(v), state)
          }
        },
      }
    })
  })
})

describe('menu isDisabled does not re-walk the item tree per item (#124)', () => {
  it('reads the disabled flag from one derivation', () => {
    // `isDisabled` walked the whole tree per item (~N²/2 node visits for a
    // 200-item menu). Counting visits needs a probe the tree walk must touch:
    // a getter on each node's `disabled`.
    let visits = 0
    const items: menu.MenuItem[] = ids(100).map((value) => {
      const node = { value, kind: 'action' as const }
      Object.defineProperty(node, 'disabled', {
        get: () => {
          visits++
          return false
        },
        enumerable: true,
      })
      return node
    })
    const state: menu.MenuState = { ...menu.init({ items }), items }
    const parts = menu.connect(rootSignal(), vi.fn(), { id: 'm' })
    for (const it of items) readAll(parts.item(it.value), state)
    // One pass over the tree, not one per item.
    expect(visits).toBeLessThanOrEqual(items.length)
  })
})
