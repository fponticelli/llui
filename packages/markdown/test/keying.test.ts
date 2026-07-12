import { describe, it, expect } from 'vitest'
import { toKeyedBlocks, parseMarkdown, collectDefinitions, resolveOptions } from '../src/index.js'
import type { Nodes } from 'mdast'

const keysFor = (
  src: string,
  opts: Parameters<typeof resolveOptions>[0] = {},
): (string | number)[] => {
  const root = parseMarkdown(src, opts)
  const defs = collectDefinitions(root)
  return toKeyedBlocks(root, src, resolveOptions(opts), defs).map((b) => b.key)
}

describe('toKeyedBlocks — uniqueness', () => {
  it('deduplicates identical-content blocks with a #n suffix', () => {
    const keys = keysFor('para\n\npara\n\npara')
    expect(new Set(keys).size).toBe(keys.length) // all unique
    expect(keys[0]).not.toBe(keys[1])
  })

  it('deduplicates colliding user keyOf results (would corrupt `each` otherwise)', () => {
    // A keyOf that returns a constant hands `each` duplicate keys — dedup rescues it.
    const keys = keysFor('# a\n\n# b\n\n# c', { keyOf: () => 'same' })
    expect(new Set(keys).size).toBe(3)
    expect(keys[0]).toBe('same')
    expect(keys[1]).toBe('same#1')
    expect(keys[2]).toBe('same#2')
  })

  it('preserves distinct user keyOf results verbatim', () => {
    const keys = keysFor('# a\n\n# b', { keyOf: (_n, i) => `k${i}` })
    expect(keys).toEqual(['k0', 'k1'])
  })
})

describe('toKeyedBlocks — content hash', () => {
  it('gives different content changes different keys (64-bit two-base hash)', () => {
    const [a] = keysFor('hello world')
    const [b] = keysFor('hello worlx')
    expect(a).not.toBe(b)
  })

  it('folds resolved reference definitions into a ref-bearing block key', () => {
    // Same block source `[a][r]`, different resolution ⇒ different key.
    const unresolved = keysFor('[a][r]')[0]
    const resolved = keysFor('[a][r]\n\n[r]: /x')[0]
    // The first block in each is the paragraph `[a][r]` (byte-identical source).
    expect(unresolved).not.toBe(resolved)
  })

  it('leaves ref-FREE blocks with a pure content key (unchanged by unrelated defs)', () => {
    const bare = keysFor('plain paragraph')[0]
    const withDef = keysFor('plain paragraph\n\n[r]: /x')[0]
    expect(bare).toBe(withDef) // paragraph consumes no refs ⇒ stable
  })
})

describe('toKeyedBlocks — hash field', () => {
  it('exposes a content hash that changes with content', () => {
    const root1 = parseMarkdown('x')
    const root2 = parseMarkdown('y')
    const h1 = toKeyedBlocks(root1, 'x', resolveOptions({}), collectDefinitions(root1))[0]?.hash
    const h2 = toKeyedBlocks(root2, 'y', resolveOptions({}), collectDefinitions(root2))[0]?.hash
    expect(h1).not.toBe(h2)
  })

  it('accepts a typed mdast node in keyOf', () => {
    const keys = keysFor('# Heading', {
      keyOf: (node: Nodes) => `type-${node.type}`,
    })
    expect(keys[0]).toBe('type-heading')
  })
})
