import { describe, it, expect, vi } from 'vitest'
import { init, update, connect, isExpanded, isSelected } from '../../src/components/tree-view'
import type { TreeViewState } from '../../src/components/tree-view'

type Ctx = { t: TreeViewState }
const wrap = (t: TreeViewState): Ctx => ({ t })

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
  const p = connect<Ctx>((s) => s.t, vi.fn(), { id: 'tv1' })

  it('root role=tree', () => {
    expect(p.root.role).toBe('tree')
  })

  it('branch item aria-expanded tracks state', () => {
    const branch = p.item('b', 0, true).item
    expect(branch['aria-expanded'](wrap(init({ expanded: ['b'] })))).toBe(true)
    expect(branch['aria-expanded'](wrap(init({ expanded: [] })))).toBe(false)
  })

  it('leaf item aria-expanded undefined', () => {
    const leaf = p.item('l', 1, false).item
    expect(leaf['aria-expanded'](wrap(init()))).toBeUndefined()
  })

  it('aria-level is depth+1', () => {
    expect(p.item('a', 0, false).item['aria-level']).toBe(1)
    expect(p.item('b', 2, false).item['aria-level']).toBe(3)
  })

  it('ArrowRight sends arrowRightFrom for branch', () => {
    const send = vi.fn()
    const pc = connect<Ctx>((s) => s.t, send, { id: 'x' })
    pc.item('a', 0, true).item.onKeyDown(
      new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }),
    )
    expect(send).toHaveBeenCalledWith({ type: 'arrowRightFrom', id: 'a' })
  })

  it('ArrowRight does nothing on leaf', () => {
    const send = vi.fn()
    const pc = connect<Ctx>((s) => s.t, send, { id: 'x' })
    pc.item('a', 0, false).item.onKeyDown(
      new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }),
    )
    expect(send).not.toHaveBeenCalled()
  })

  it('ArrowLeft sends arrowLeftFrom with parentId', () => {
    const send = vi.fn()
    const pc = connect<Ctx>((s) => s.t, send, { id: 'x' })
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
    const pc = connect<Ctx>((s) => s.t, vi.fn(), { id: 'x' })
    const cb = pc.item('a', 0, false).checkbox
    expect(cb['aria-checked'](wrap(init({ checked: ['a'] })))).toBe('true')
    expect(cb['aria-checked'](wrap(init({ indeterminate: ['a'] })))).toBe('mixed')
    expect(cb['aria-checked'](wrap(init()))).toBe('false')
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

  it('renameCancel clears rename state', () => {
    const s0 = init({})
    const [s1] = update(s0, { type: 'renameStart', id: 'x', initial: 'foo' })
    const [s2] = update(s1, { type: 'renameCancel' })
    expect(s2.renaming).toBeNull()
  })

  it('branchTrigger click sends toggleBranch', () => {
    const send = vi.fn()
    const pc = connect<Ctx>((s) => s.t, send, { id: 'x' })
    pc.item('a', 0, true).branchTrigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'toggleBranch', id: 'a' })
  })
})
