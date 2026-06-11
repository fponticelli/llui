import { describe, it, expect, vi } from 'vitest'
import {
  init,
  update,
  connect,
  isExpanded,
  isSelected,
  isLoading,
  isLoadFailed,
  isLoaded,
  isChecked,
  isIndeterminate,
} from '../../src/components/tree-view'
import type { TreeNodeMeta } from '../../src/components/tree-view'
import { rootSignal, read } from '../_signal'

describe('tree-view reducer', () => {
  it('initializes empty', () => {
    expect(init()).toMatchObject({ expanded: [], selected: [], focused: null })
  })

  it('toggleBranch flips expanded', () => {
    const [s1] = update(init(), { type: 'toggleBranch', id: 'a' })
    expect(s1.expanded).toEqual(['a'])
    const [s2] = update(s1, { type: 'toggleBranch', id: 'a' })
    expect(s2.expanded).toEqual([])
  })

  it('expand/collapse explicit', () => {
    const [s1] = update(init(), { type: 'expand', id: 'x' })
    expect(s1.expanded).toContain('x')
    const [s2] = update(s1, { type: 'collapse', id: 'x' })
    expect(s2.expanded).not.toContain('x')
  })

  it('single select replaces', () => {
    const s0 = init({ selectionMode: 'single', selected: ['a'] })
    const [s] = update(s0, { type: 'select', id: 'b' })
    expect(s.selected).toEqual(['b'])
  })

  it('multiple additive toggles', () => {
    const s0 = init({ selectionMode: 'multiple', selected: ['a'] })
    const [s1] = update(s0, { type: 'select', id: 'b', additive: true })
    expect(s1.selected).toEqual(['a', 'b'])
    const [s2] = update(s1, { type: 'select', id: 'a', additive: true })
    expect(s2.selected).toEqual(['b'])
  })

  it('multiple non-additive replaces', () => {
    const s0 = init({ selectionMode: 'multiple', selected: ['a', 'b'] })
    const [s] = update(s0, { type: 'select', id: 'c' })
    expect(s.selected).toEqual(['c'])
  })

  it('focusNext/Prev walks visibleItems', () => {
    const s0 = init({ visibleItems: ['a', 'b', 'c'] })
    const [s1] = update({ ...s0, focused: 'a' }, { type: 'focusNext' })
    expect(s1.focused).toBe('b')
    const [s2] = update({ ...s0, focused: 'c' }, { type: 'focusPrev' })
    expect(s2.focused).toBe('b')
  })

  it('focusNext at end stays', () => {
    const s0 = { ...init({ visibleItems: ['a', 'b'] }), focused: 'b' }
    const [s] = update(s0, { type: 'focusNext' })
    expect(s.focused).toBe('b')
  })

  it('focusFirst/Last', () => {
    const s0 = init({ visibleItems: ['a', 'b', 'c'] })
    expect(update(s0, { type: 'focusFirst' })[0].focused).toBe('a')
    expect(update(s0, { type: 'focusLast' })[0].focused).toBe('c')
  })

  it('expandAll replaces list', () => {
    const [s] = update(init(), { type: 'expandAll', ids: ['a', 'b'] })
    expect(s.expanded).toEqual(['a', 'b'])
  })

  it('collapseAll empties', () => {
    const s0 = init({ expanded: ['a', 'b'] })
    const [s] = update(s0, { type: 'collapseAll' })
    expect(s.expanded).toEqual([])
  })
})

describe('helpers', () => {
  it('isExpanded / isSelected check membership', () => {
    const s = init({ expanded: ['a'], selected: ['b'] })
    expect(isExpanded(s, 'a')).toBe(true)
    expect(isExpanded(s, 'b')).toBe(false)
    expect(isSelected(s, 'b')).toBe(true)
  })
})

describe('tree-view.connect', () => {
  const p = connect(rootSignal(), vi.fn(), { id: 'tv1' })

  it('root role=tree', () => {
    expect(p.root.role).toBe('tree')
  })

  it('branch item aria-expanded tracks state', () => {
    const branch = p.item('b', 0, true).item
    expect(read(branch['aria-expanded'], init({ expanded: ['b'] }))).toBe(true)
    expect(read(branch['aria-expanded'], init({ expanded: [] }))).toBe(false)
  })

  it('leaf item aria-expanded undefined', () => {
    const leaf = p.item('l', 1, false).item
    expect(read(leaf['aria-expanded'], init())).toBeUndefined()
  })

  it('aria-level is depth+1', () => {
    expect(p.item('a', 0, false).item['aria-level']).toBe(1)
    expect(p.item('b', 2, false).item['aria-level']).toBe(3)
  })

  it('ArrowRight sends arrowRightFrom for branch', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send, { id: 'x' })
    pc.item('a', 0, true).item.onKeyDown(
      new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }),
    )
    expect(send).toHaveBeenCalledWith({ type: 'arrowRightFrom', id: 'a' })
  })

  it('ArrowRight does nothing on leaf', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send, { id: 'x' })
    pc.item('a', 0, false).item.onKeyDown(
      new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }),
    )
    expect(send).not.toHaveBeenCalled()
  })

  it('ArrowLeft sends arrowLeftFrom with parentId', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send, { id: 'x' })
    pc.item('a', 1, false, 'root').item.onKeyDown(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true }),
    )
    expect(send).toHaveBeenCalledWith({
      type: 'arrowLeftFrom',
      id: 'a',
      isBranch: false,
      parentId: 'root',
    })
  })

  it('arrowRightFrom reducer: closed branch expands', () => {
    const [s] = update(init({ expanded: [] }), { type: 'arrowRightFrom', id: 'a' })
    expect(s.expanded).toContain('a')
  })

  it('arrowRightFrom reducer: open branch focuses first visible child', () => {
    const s0 = init({ expanded: ['a'], visibleItems: ['a', 'a1', 'a2'] })
    const [s] = update(s0, { type: 'arrowRightFrom', id: 'a' })
    expect(s.focused).toBe('a1')
  })

  it('arrowLeftFrom reducer: expanded branch collapses', () => {
    const s0 = init({ expanded: ['a'] })
    const [s] = update(s0, {
      type: 'arrowLeftFrom',
      id: 'a',
      isBranch: true,
      parentId: 'root',
    })
    expect(s.expanded).not.toContain('a')
    expect(s.focused).toBeNull()
  })

  it('arrowLeftFrom reducer: collapsed branch focuses parent', () => {
    const [s] = update(init({ expanded: [] }), {
      type: 'arrowLeftFrom',
      id: 'a',
      isBranch: true,
      parentId: 'root',
    })
    expect(s.focused).toBe('root')
  })

  it('arrowLeftFrom reducer: leaf with parent focuses parent', () => {
    const [s] = update(init(), {
      type: 'arrowLeftFrom',
      id: 'a1',
      isBranch: false,
      parentId: 'a',
    })
    expect(s.focused).toBe('a')
  })

  it('arrowLeftFrom reducer: leaf at root does nothing', () => {
    const [s] = update(init(), {
      type: 'arrowLeftFrom',
      id: 'a',
      isBranch: false,
      parentId: null,
    })
    expect(s.focused).toBeNull()
  })

  it('checkbox aria-checked reflects checked/indeterminate', () => {
    const pc = connect(rootSignal(), vi.fn(), { id: 'x' })
    const cb = pc.item('a', 0, false).checkbox
    expect(read(cb['aria-checked'], init({ checked: ['a'] }))).toBe('true')
    expect(read(cb['aria-checked'], init({ indeterminate: ['a'] }))).toBe('mixed')
    expect(read(cb['aria-checked'], init())).toBe('false')
  })

  it('toggleChecked propagates to descendants', () => {
    const [s] = update(init(), {
      type: 'toggleChecked',
      id: 'parent',
      descendantIds: ['child1', 'child2'],
    })
    expect(s.checked.sort()).toEqual(['child1', 'child2', 'parent'])
  })

  it('toggleChecked unchecks parent + descendants', () => {
    const s0 = init({ checked: ['parent', 'child1', 'child2', 'other'] })
    const [s] = update(s0, {
      type: 'toggleChecked',
      id: 'parent',
      descendantIds: ['child1', 'child2'],
    })
    expect(s.checked).toEqual(['other'])
  })

  it('toggleChecked clears indeterminate on touched ids', () => {
    const s0 = init({ indeterminate: ['parent', 'other'] })
    const [s] = update(s0, {
      type: 'toggleChecked',
      id: 'parent',
      descendantIds: ['child'],
    })
    expect(s.indeterminate).toEqual(['other'])
    expect(s.checked.sort()).toEqual(['child', 'parent'])
  })

  it('setIndeterminate replaces the list', () => {
    const [s] = update(init(), { type: 'setIndeterminate', ids: ['a', 'b'] })
    expect(s.indeterminate).toEqual(['a', 'b'])
  })

  it('renameStart + renameChange + renameCommit cycle', () => {
    const [s1] = update(init(), { type: 'renameStart', id: 'x', initial: 'foo' })
    expect(s1.renaming).toBe('x')
    expect(s1.renameDraft).toBe('foo')
    const [s2] = update(s1, { type: 'renameChange', value: 'bar' })
    expect(s2.renameDraft).toBe('bar')
    const [s3] = update(s2, { type: 'renameCommit' })
    expect(s3.renaming).toBeNull()
    expect(s3.renameDraft).toBe('')
  })

  it('loadingStart + loadingEnd toggle loading list', () => {
    const [s1] = update(init(), { type: 'loadingStart', id: 'a' })
    expect(s1.loading).toEqual(['a'])
    const [s2] = update(s1, { type: 'loadingStart', id: 'b' })
    expect(s2.loading).toEqual(['a', 'b'])
    // loadingStart is idempotent
    const [s3] = update(s2, { type: 'loadingStart', id: 'a' })
    expect(s3.loading).toEqual(['a', 'b'])
    const [s4] = update(s3, { type: 'loadingEnd', id: 'a' })
    expect(s4.loading).toEqual(['b'])
  })

  it('item aria-busy reflects loading state', () => {
    const pc = connect(rootSignal(), vi.fn(), { id: 'x' })
    const item = pc.item('a', 0, true).item
    expect(read(item['aria-busy'], init({}))).toBeUndefined()
    // Force loading via explicit state construction
    const loaded = { ...init(), loading: ['a'] }
    expect(read(item['aria-busy'], loaded)).toBe('true')
    expect(read(item['data-loading'], loaded)).toBe('')
  })

  it('renameCancel clears rename state', () => {
    const s0 = init({})
    const [s1] = update(s0, { type: 'renameStart', id: 'x', initial: 'foo' })
    const [s2] = update(s1, { type: 'renameCancel' })
    expect(s2.renaming).toBeNull()
  })

  it('root aria-owns lists visible item IDs', () => {
    const pc = connect(rootSignal(), vi.fn(), { id: 'tv' })
    // Empty visibleItems → undefined
    expect(read(pc.root['aria-owns'], init())).toBeUndefined()
    // With visible items → space-separated ids
    const s = init({ visibleItems: ['a', 'b', 'c'] })
    expect(read(pc.root['aria-owns'], s)).toBe('tv:item:a tv:item:b tv:item:c')
  })

  it('branchTrigger click sends toggleBranch', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send, { id: 'x' })
    pc.item('a', 0, true).branchTrigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'toggleBranch', id: 'a' })
  })
})

// Build a flat nodes map from a nested literal for tests.
function nodesOf(
  spec: Record<string, { children?: string[]; disabled?: boolean; hasChildren?: boolean }>,
  roots: string[],
): { nodes: Record<string, TreeNodeMeta>; roots: string[] } {
  // Derive parentId from children links.
  const parentOf: Record<string, string | null> = {}
  for (const id of Object.keys(spec)) parentOf[id] ??= null
  for (const [id, meta] of Object.entries(spec)) {
    for (const c of meta.children ?? []) parentOf[c] = id
  }
  const nodes: Record<string, TreeNodeMeta> = {}
  for (const [id, meta] of Object.entries(spec)) {
    nodes[id] = {
      children: meta.children ?? [],
      parentId: parentOf[id] ?? null,
      ...(meta.disabled ? { disabled: true } : {}),
      ...(meta.hasChildren ? { hasChildren: true } : {}),
    }
  }
  return { nodes, roots }
}

describe('tree-view lazy loading', () => {
  // A node marked hasChildren:true with no loaded children.
  const lazyTree = () =>
    init({
      ...nodesOf(
        {
          a: { hasChildren: true },
          b: { children: ['b1'] },
          b1: {},
        },
        ['a', 'b'],
      ),
    })

  it('expanding a lazy branch returns a single loadChildren effect and marks loading', () => {
    const [s, eff] = update(lazyTree(), { type: 'expand', id: 'a' })
    expect(eff).toEqual([{ type: 'loadChildren', id: 'a' }])
    expect(s.expanded).toContain('a')
    expect(isLoading(s, 'a')).toBe(true)
  })

  it('duplicate expand while loading does not emit a second effect', () => {
    const [s1, eff1] = update(lazyTree(), { type: 'expand', id: 'a' })
    expect(eff1).toHaveLength(1)
    // toggleBranch / expand again while still loading: no new effect
    const [s2, eff2] = update(s1, { type: 'expand', id: 'a' })
    expect(eff2).toEqual([])
    const [s3, eff3] = update(s2, { type: 'toggleBranch', id: 'a' })
    // toggleBranch collapses; no load effect
    expect(eff3).toEqual([])
    expect(s3.expanded).not.toContain('a')
  })

  it('expanding an already-loaded branch emits no effect', () => {
    const [s1] = update(lazyTree(), { type: 'expand', id: 'a' })
    const [s2] = update(s1, {
      type: 'childrenLoaded',
      id: 'a',
      items: [{ id: 'a1' }, { id: 'a2' }],
    })
    const [s3] = update(s2, { type: 'collapse', id: 'a' })
    const [s4, eff] = update(s3, { type: 'expand', id: 'a' })
    expect(eff).toEqual([])
    expect(isLoaded(s4, 'a')).toBe(true)
    expect(isLoading(s4, 'a')).toBe(false)
  })

  it('non-lazy branch (children already present) emits no effect', () => {
    const [_s, eff] = update(lazyTree(), { type: 'expand', id: 'b' })
    expect(eff).toEqual([])
  })

  it('childrenLoaded inserts nodes, marks loaded, clears loading', () => {
    const [s1] = update(lazyTree(), { type: 'expand', id: 'a' })
    const [s2] = update(s1, {
      type: 'childrenLoaded',
      id: 'a',
      items: [{ id: 'a1' }, { id: 'a2', hasChildren: true }],
    })
    expect(isLoading(s2, 'a')).toBe(false)
    expect(isLoaded(s2, 'a')).toBe(true)
    expect(s2.nodes['a']?.children).toEqual(['a1', 'a2'])
    expect(s2.nodes['a1']?.parentId).toBe('a')
    expect(s2.nodes['a2']?.hasChildren).toBe(true)
  })

  it('childrenLoadFailed marks failed and clears loading; re-expand retries', () => {
    const [s1] = update(lazyTree(), { type: 'expand', id: 'a' })
    const [s2] = update(s1, { type: 'childrenLoadFailed', id: 'a' })
    expect(isLoading(s2, 'a')).toBe(false)
    expect(isLoadFailed(s2, 'a')).toBe(true)
    // Collapse then re-expand → retries (new effect), clears failed flag
    const [s3] = update(s2, { type: 'collapse', id: 'a' })
    const [s4, eff] = update(s3, { type: 'expand', id: 'a' })
    expect(eff).toEqual([{ type: 'loadChildren', id: 'a' }])
    expect(isLoadFailed(s4, 'a')).toBe(false)
    expect(isLoading(s4, 'a')).toBe(true)
  })

  it('stale childrenLoaded for a since-collapsed node still inserts', () => {
    const [s1] = update(lazyTree(), { type: 'expand', id: 'a' })
    // collapse while load is in flight
    const [s2] = update(s1, { type: 'collapse', id: 'a' })
    expect(s2.expanded).not.toContain('a')
    // duplicate expand suppressed: still loading
    expect(isLoading(s2, 'a')).toBe(true)
    // load resolves for the now-collapsed node
    const [s3] = update(s2, {
      type: 'childrenLoaded',
      id: 'a',
      items: [{ id: 'a1' }],
    })
    expect(s3.nodes['a']?.children).toEqual(['a1'])
    expect(isLoaded(s3, 'a')).toBe(true)
    expect(isLoading(s3, 'a')).toBe(false)
    // Re-expanding now does NOT refetch
    const [, eff] = update(s3, { type: 'expand', id: 'a' })
    expect(eff).toEqual([])
  })

  it('childrenLoaded marking loaded means an empty result is not refetched', () => {
    const [s1] = update(lazyTree(), { type: 'expand', id: 'a' })
    const [s2] = update(s1, { type: 'childrenLoaded', id: 'a', items: [] })
    expect(isLoaded(s2, 'a')).toBe(true)
    const [, eff] = update(s2, { type: 'collapse', id: 'a' })
    const [s4, eff2] = update(update(s2, { type: 'collapse', id: 'a' })[0], {
      type: 'expand',
      id: 'a',
    })
    expect(eff).toEqual([])
    expect(eff2).toEqual([])
    expect(isLoaded(s4, 'a')).toBe(true)
  })
})

describe('tree-view automatic indeterminate / cascade (checkbox mode)', () => {
  // Deep tree:
  //  root
  //   ├ a
  //   │  ├ a1
  //   │  └ a2 (disabled)
  //   └ b
  //      └ b1
  //         ├ b1x
  //         └ b1y
  const deepTree = () =>
    init({
      selectionMode: 'checkbox',
      ...nodesOf(
        {
          root: { children: ['a', 'b'] },
          a: { children: ['a1', 'a2'] },
          a1: {},
          a2: { disabled: true },
          b: { children: ['b1'] },
          b1: { children: ['b1x', 'b1y'] },
          b1x: {},
          b1y: {},
        },
        ['root'],
      ),
    })

  it('checking a parent cascades to enabled descendants, skipping disabled', () => {
    const [s] = update(deepTree(), { type: 'toggleChecked', id: 'a' })
    expect(isChecked(s, 'a1')).toBe(true)
    // a2 is disabled → untouched
    expect(isChecked(s, 'a2')).toBe(false)
  })

  it('a with one enabled checked and one disabled-unchecked child is fully checked (disabled ignored)', () => {
    const [s] = update(deepTree(), { type: 'toggleChecked', id: 'a' })
    // a's only enabled descendant a1 is checked → a is checked, not indeterminate
    expect(isChecked(s, 'a')).toBe(true)
    expect(isIndeterminate(s, 'a')).toBe(false)
    // root has a fully-checked but b unchecked → indeterminate
    expect(isIndeterminate(s, 'root')).toBe(true)
    expect(isChecked(s, 'root')).toBe(false)
  })

  it('derives indeterminate at every depth bottom-up', () => {
    // Check just b1x (a deep leaf)
    const [s] = update(deepTree(), { type: 'toggleChecked', id: 'b1x' })
    expect(isChecked(s, 'b1x')).toBe(true)
    expect(isIndeterminate(s, 'b1')).toBe(true) // one of b1x,b1y
    expect(isIndeterminate(s, 'b')).toBe(true)
    expect(isIndeterminate(s, 'root')).toBe(true)
    expect(isChecked(s, 'b1')).toBe(false)
  })

  it('checking all enabled leaves promotes ancestors to checked', () => {
    let s = deepTree()
    s = update(s, { type: 'toggleChecked', id: 'a1' })[0]
    s = update(s, { type: 'toggleChecked', id: 'b1x' })[0]
    s = update(s, { type: 'toggleChecked', id: 'b1y' })[0]
    // a: only enabled child a1 checked → a checked
    expect(isChecked(s, 'a')).toBe(true)
    // b1 fully checked, b checked
    expect(isChecked(s, 'b1')).toBe(true)
    expect(isChecked(s, 'b')).toBe(true)
    // root: a and b both checked → root checked, not indeterminate
    expect(isChecked(s, 'root')).toBe(true)
    expect(isIndeterminate(s, 'root')).toBe(false)
  })

  it('unchecking a parent cascades uncheck to enabled descendants and re-derives ancestors', () => {
    let s = deepTree()
    s = update(s, { type: 'toggleChecked', id: 'a' })[0]
    s = update(s, { type: 'toggleChecked', id: 'b' })[0]
    expect(isChecked(s, 'root')).toBe(true)
    s = update(s, { type: 'toggleChecked', id: 'a' })[0]
    expect(isChecked(s, 'a')).toBe(false)
    expect(isChecked(s, 'a1')).toBe(false)
    // root drops to indeterminate (b still checked)
    expect(isIndeterminate(s, 'root')).toBe(true)
    expect(isChecked(s, 'root')).toBe(false)
  })

  it('leaf toggle with no nodes map falls back to plain toggle', () => {
    // No structure provided → behaves like a simple toggle (no crash)
    const [s] = update(init({ selectionMode: 'checkbox' }), { type: 'toggleChecked', id: 'x' })
    expect(isChecked(s, 'x')).toBe(true)
    const [s2] = update(s, { type: 'toggleChecked', id: 'x' })
    expect(isChecked(s2, 'x')).toBe(false)
  })

  it('setNodes replaces structure', () => {
    const s0 = init({ selectionMode: 'checkbox' })
    const { nodes, roots } = nodesOf({ p: { children: ['c'] }, c: {} }, ['p'])
    const [s] = update(s0, { type: 'setNodes', nodes, roots })
    expect(s.nodes['p']?.children).toEqual(['c'])
    expect(s.roots).toEqual(['p'])
  })
})
