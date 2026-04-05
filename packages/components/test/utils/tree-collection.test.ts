import { describe, it, expect } from 'vitest'
import { TreeCollection, type TreeNode } from '../../src/utils/tree-collection'

const tree: TreeNode = {
  id: 'root',
  label: 'Project',
  children: [
    { id: 'docs', label: 'Docs' },
    {
      id: 'src',
      label: 'Source',
      children: [
        { id: 'main', label: 'main.ts' },
        { id: 'utils', label: 'utils.ts', disabled: true },
      ],
    },
    { id: 'tests', label: 'Tests' },
  ],
}

describe('TreeCollection', () => {
  it('indexes nodes by id', () => {
    const col = new TreeCollection(tree)
    expect(col.getNode('main')?.label).toBe('main.ts')
    expect(col.getNode('nope')).toBeNull()
  })

  it('getLabel falls back to id', () => {
    const col = new TreeCollection({ id: 'x' })
    expect(col.getLabel('x')).toBe('x')
  })

  it('getParent / getDepth / getChildren', () => {
    const col = new TreeCollection(tree)
    expect(col.getParent('main')).toBe('src')
    expect(col.getParent('root')).toBeNull()
    expect(col.getDepth('main')).toBe(2)
    expect(col.getDepth('root')).toBe(0)
    expect(col.getChildren('src')).toEqual(['main', 'utils'])
    expect(col.getChildren('main')).toEqual([])
  })

  it('getDescendants is depth-first excluding self', () => {
    const col = new TreeCollection(tree)
    expect(col.getDescendants('root')).toEqual(['docs', 'src', 'main', 'utils', 'tests'])
    expect(col.getDescendants('src')).toEqual(['main', 'utils'])
    expect(col.getDescendants('main')).toEqual([])
  })

  it('isBranch + isDisabled', () => {
    const col = new TreeCollection(tree)
    expect(col.isBranch('src')).toBe(true)
    expect(col.isBranch('main')).toBe(false)
    expect(col.isDisabled('utils')).toBe(true)
    expect(col.isDisabled('main')).toBe(false)
  })

  it('visibleItems shows only nodes whose ancestors are all expanded', () => {
    const col = new TreeCollection(tree)
    expect(col.visibleItems([])).toEqual(['root'])
    expect(col.visibleItems(['root'])).toEqual(['root', 'docs', 'src', 'tests'])
    expect(col.visibleItems(['root', 'src'])).toEqual([
      'root',
      'docs',
      'src',
      'main',
      'utils',
      'tests',
    ])
    // src expanded but root closed → src not visible, so its children aren't either
    expect(col.visibleItems(['src'])).toEqual(['root'])
  })

  it('visibleLabels uses label then id', () => {
    const col = new TreeCollection({ id: 'a', children: [{ id: 'b', label: 'B' }] })
    expect(col.visibleLabels(['a'])).toEqual(['a', 'B'])
  })

  it('branchIds lists only branches', () => {
    const col = new TreeCollection(tree)
    expect(col.branchIds.sort()).toEqual(['root', 'src'].sort())
  })

  it('computeIndeterminate finds partially-checked branches', () => {
    const col = new TreeCollection(tree)
    // main checked, utils not → src should be indeterminate
    expect(col.computeIndeterminate(new Set(['main']))).toEqual(expect.arrayContaining(['src']))
    // both main + utils checked → src not indeterminate (all children)
    expect(col.computeIndeterminate(new Set(['main', 'utils']))).not.toContain('src')
    // nothing checked → no indeterminate
    expect(col.computeIndeterminate(new Set())).toEqual([])
  })

  it('computeIndeterminate also flags root when descendants partially checked', () => {
    const col = new TreeCollection(tree)
    // Only docs checked; root has many descendants → root indeterminate
    const ind = col.computeIndeterminate(new Set(['docs']))
    expect(ind).toContain('root')
  })

  it('accepts an array of roots', () => {
    const col = new TreeCollection([{ id: 'a' }, { id: 'b' }])
    expect(col.allIds).toEqual(['a', 'b'])
    expect(col.visibleItems([])).toEqual(['a', 'b'])
  })

  it('allIds lists ids in depth-first order', () => {
    const col = new TreeCollection(tree)
    expect(col.allIds).toEqual(['root', 'docs', 'src', 'main', 'utils', 'tests'])
  })
})
