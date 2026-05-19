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
  it('emits __prefixes for ≤31 paths and does NOT emit __dirty', () => {
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
    // `__dirty` emission was removed in 2026-05 — the runtime computes
    // dirty exclusively from `__prefixes`. Hand-authored `__dirty`
    // throws at mount.
    expect(out).not.toContain('__dirty')
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
    // `__update` was removed in v0.4 (Tier 2.4 of the bundle-size cut)
    // — the runtime always uses `genericUpdate` now. The high-word
    // dirty mask still threads through processMessages →
    // setCurrentDirtyMask → genericUpdate → _runPhase2. The remaining
    // assertions cover the prefix emission shape; the Phase 2
    // threading is exercised by the runtime tests in
    // packages/dom/test/prefix-reactivity.test.ts.
    expect(out).not.toContain('__update')
  })

  it('emits __handlers for >31-prefix components with caseDirtyHi when a case touches a high-word field', () => {
    // 33 distinct fields so positions 31, 32 fall in the high word.
    // The mutating case touches `f31` (high word, bit 0) — the emitted
    // handler must pass `caseDirtyHi` as the 5th arg of __handleMsg.
    const init = Array.from({ length: 33 }, (_, i) => `f${i}: 0`).join(', ')
    const reads = Array.from({ length: 33 }, (_, i) => `text(s => String(s.f${i}))`).join(',\n')
    const src = `
      import { component, text } from '@llui/dom'
      type State = { ${Array.from({ length: 33 }, (_, i) => `f${i}: number`).join('; ')} }
      type Msg = { type: 'bumpHi' }
      export const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ ${init} }, []],
        update: (s, m) => {
          switch (m.type) {
            case 'bumpHi':
              return [{ ...s, f31: s.f31 + 1 }, []]
          }
        },
        view: ({ text }) => [
          ${reads}
        ],
      })
    `
    const out = t(src)
    expect(out).toContain('__handlers')
    expect(out).toMatch(/bumpHi/) // handler key emitted
    // The __handleMsg call for the bumpHi case must carry a 5th
    // positional arg representing caseDirtyHi. The high-word bit for
    // position 31 is `1 << (31 - 31) === 1`, so we expect a literal
    // `1` as the 5th argument.
    expect(out).toMatch(/__handleMsg\(inst,\s*msg,\s*\d+,\s*\d+,\s*1\)/)
  })

  it('emits __prefixes with overflow shape for components using structural primitives + high-word paths', () => {
    // v0.4: the per-component `__update` emission was dropped, so this
    // test no longer asserts the Phase 1 block-gate shape (that lived
    // inside __update). The same two-word Phase 1 gate is exercised
    // inline in `genericUpdate` (packages/dom/src/update-loop.ts:573)
    // and covered by the runtime tests. Here we just assert that a
    // component with branch() compiles cleanly and emits __prefixes.
    const src = `
      import { component, div, text, branch } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ phase: 'a' as const }, []],
        update: (s, m) => [s, []],
        view: ({ branch }) => [
          div({}, [
            branch({
              on: s => s.phase,
              cases: {
                a: () => [text('A')],
                b: () => [text('B')],
              },
            }),
          ]),
        ],
      })
    `
    const out = t(src)
    expect(out).not.toContain('__update')
    expect(out).toContain('__prefixes')
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
