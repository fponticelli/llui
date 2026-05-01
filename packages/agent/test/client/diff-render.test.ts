import { describe, it, expect } from 'vitest'
import { summarizeDiff, groupDiff, describeOp } from '../../src/client/diff-render.js'
import type { StateDiff } from '../../src/state-diff.js'

const diff = (...ops: StateDiff): StateDiff => ops

describe('summarizeDiff', () => {
  it('"no changes" for null/undefined/empty diff', () => {
    expect(summarizeDiff(null)).toBe('no changes')
    expect(summarizeDiff(undefined)).toBe('no changes')
    expect(summarizeDiff([])).toBe('no changes')
  })

  it('single change in single region', () => {
    expect(summarizeDiff(diff({ op: 'replace', path: '/cart/total', value: 9 }))).toBe(
      '1 change in cart',
    )
  })

  it('multiple ops in single region', () => {
    expect(
      summarizeDiff(
        diff(
          { op: 'replace', path: '/items/0/name', value: 'a' },
          { op: 'add', path: '/items/-', value: { id: 'b' } },
          { op: 'remove', path: '/items/3' },
        ),
      ),
    ).toBe('3 changes in items')
  })

  it("'*' wildcard for whole-state replace", () => {
    expect(summarizeDiff(diff({ op: 'replace', path: '/', value: {} }))).toBe('state replaced')
  })

  it('multi-region homogeneous adds', () => {
    expect(
      summarizeDiff(
        diff(
          { op: 'add', path: '/cart/-', value: 'x' },
          { op: 'add', path: '/items/-', value: 'y' },
          { op: 'add', path: '/notes/-', value: 'z' },
        ),
      ),
    ).toBe('3 items added across 3 regions')
  })

  it('multi-region homogeneous removes', () => {
    expect(
      summarizeDiff(diff({ op: 'remove', path: '/a/0' }, { op: 'remove', path: '/b/0' })),
    ).toBe('2 items removed across 2 regions')
  })

  it('multi-region homogeneous replaces', () => {
    expect(
      summarizeDiff(
        diff({ op: 'replace', path: '/a/x', value: 1 }, { op: 'replace', path: '/b/y', value: 2 }),
      ),
    ).toBe('2 fields changed across 2 regions')
  })

  it('multi-region mixed → generic count', () => {
    expect(
      summarizeDiff(
        diff(
          { op: 'add', path: '/a/-', value: 1 },
          { op: 'remove', path: '/b/0' },
          { op: 'replace', path: '/c/x', value: 9 },
        ),
      ),
    ).toBe('3 changes across 3 regions')
  })

  it('handles JSON-Pointer escape: ~1 = "/", ~0 = "~"', () => {
    // Field literally named "a/b" — JSON Pointer encodes the slash as ~1.
    // The summary should treat the segment as a single name, not split it.
    expect(summarizeDiff(diff({ op: 'replace', path: '/a~1b/x', value: 1 }))).toBe(
      '1 change in a/b',
    )
  })
})

describe('groupDiff', () => {
  it('returns empty array for null/empty diff', () => {
    expect(groupDiff(null)).toEqual([])
    expect(groupDiff([])).toEqual([])
  })

  it('groups ops by top-level region with counts and full paths', () => {
    const groups = groupDiff(
      diff(
        { op: 'add', path: '/items/-', value: 'a' },
        { op: 'replace', path: '/items/3/name', value: 'b' },
        { op: 'remove', path: '/cart/0' },
      ),
    )
    expect(groups).toEqual([
      { region: 'items', adds: 1, removes: 0, replaces: 1, paths: ['/items/-', '/items/3/name'] },
      { region: 'cart', adds: 0, removes: 1, replaces: 0, paths: ['/cart/0'] },
    ])
  })

  it("collapses root replace under '*' region", () => {
    const groups = groupDiff(diff({ op: 'replace', path: '/', value: {} }))
    expect(groups).toEqual([{ region: '*', adds: 0, removes: 0, replaces: 1, paths: ['/'] }])
  })
})

describe('describeOp', () => {
  it('renders replace ops with dotted path', () => {
    expect(describeOp({ op: 'replace', path: '/cart/total', value: 9 })).toBe('changed cart.total')
  })

  it('renders add ops', () => {
    expect(describeOp({ op: 'add', path: '/items/3', value: 'x' })).toBe('added items.3')
  })

  it('renders remove ops', () => {
    expect(describeOp({ op: 'remove', path: '/items/3' })).toBe('removed items.3')
  })

  it('special-cases the root path', () => {
    expect(describeOp({ op: 'replace', path: '/', value: {} })).toBe('replaced state')
    expect(describeOp({ op: 'replace', path: '', value: {} })).toBe('replaced state')
  })

  it('un-escapes JSON-Pointer in the dotted output', () => {
    // Field literally named "a/b" → encoded as ~1, decoded back to "a/b"
    // in the dotted path.
    expect(describeOp({ op: 'replace', path: '/a~1b/x', value: 1 })).toBe('changed a/b.x')
    // Field named "~weird" → encoded as ~0weird, decoded back.
    expect(describeOp({ op: 'replace', path: '/~0weird', value: 1 })).toBe('changed ~weird')
  })
})
