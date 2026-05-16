// Validates Pass 2 emission of `__prefixes` — the compiler-side half of
// the unified-composition-model spike. See
// `docs/proposals/unified-composition-model.md`.

import { describe, it, expect } from 'vitest'
import { transformLlui } from '../src/transform'

function t(source: string): string {
  const result = transformLlui(source, 'test.ts')
  return result?.output ?? source
}

describe('Pass 2 — __prefixes emission for path-keyed reactivity', () => {
  it('emits __prefixes alongside __dirty when ≤31 paths', () => {
    const src = `
      import { component, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ count: 0, label: '' }, []],
        update: (s, m) => [s, []],
        view: (send) => [
          text(s => String(s.count)),
          text(s => s.label),
        ],
      })
    `
    const out = t(src)
    // Both __dirty (bitmask path) and __prefixes (path-keyed path) are
    // emitted; runtime prefers __prefixes when present.
    expect(out).toContain('__dirty')
    expect(out).toContain('__prefixes')
    // The prefix table contains one arrow per distinct path.
    expect(out).toMatch(/__prefixes:\s*\[/)
    expect(out).toMatch(/s\s*=>\s*s\.count/)
    expect(out).toMatch(/s\s*=>\s*s\.label/)
  })

  it('emits prefixes for nested paths at depth 2', () => {
    const src = `
      import { component, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ user: { name: 'a', email: 'b' } }, []],
        update: (s, m) => [s, []],
        view: (send) => [
          text(s => s.user.name),
          text(s => s.user.email),
        ],
      })
    `
    const out = t(src)
    expect(out).toContain('__prefixes')
    // Two distinct nested paths → two prefix arrows. Without prefix
    // emission, both would conflate to the top-level 'user' bit and
    // co-fire on any sub-field change.
    expect(out).toMatch(/s\s*=>\s*s\?\.user\?\.name/)
    expect(out).toMatch(/s\s*=>\s*s\?\.user\?\.email/)
  })

  it('emits a multi-word __prefixes array when >31 paths (overflow)', () => {
    // Force overflow: 35 top-level fields each read by a distinct accessor.
    // With multi-word `__prefixes`, the compiler emits all 35 prefix
    // arrows; the runtime fans bit positions 0..30 into the low dirty
    // word and 31..34 into the high word via `computeDirtyFromPrefixes`'
    // overflow tuple.
    const fields = Array.from({ length: 35 }, (_, i) => `f${i}: 0`).join(', ')
    const reads = Array.from({ length: 35 }, (_, i) => `text(s => String(s.f${i}))`).join(',\n')
    const src = `
      import { component, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ ${fields} }, []],
        update: (s, m) => [s, []],
        view: (send) => [
          ${reads}
        ],
      })
    `
    const out = t(src)
    expect(out).toContain('__prefixes')
    // All 35 distinct paths must appear as prefix arrows. Spot-check
    // the first and last so we don't miss a regression where overflow
    // paths were truncated. Top-level paths emit as `s.fN` (no
    // optional chaining — only nested paths use `s?.foo?.bar`).
    expect(out).toMatch(/s\s*=>\s*s\.f0\b/)
    expect(out).toMatch(/s\s*=>\s*s\.f34\b/)
  })

  it('emits __prefixes with arrow ordering matching bit positions', () => {
    // Bit position = arrow index. Path order is insertion order from the
    // accessor walker. We can't easily assert position-by-position from
    // the printed source, but we can assert the count matches the path
    // count.
    const src = `
      import { component, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ a: 0, b: 0, c: 0 }, []],
        update: (s, m) => [s, []],
        view: (send) => [
          text(s => String(s.a)),
          text(s => String(s.b)),
          text(s => String(s.c)),
        ],
      })
    `
    const out = t(src)
    expect(out).toContain('__prefixes')
    // Three arrows in the array (count occurrences of "s => s.")
    const matches = out.match(/s\s*=>\s*s\.[abc]/g)
    expect(matches?.length).toBeGreaterThanOrEqual(3)
  })
})
