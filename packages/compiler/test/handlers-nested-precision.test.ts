// Validates that __handlers' per-case dirty masks are computed at
// leaf-path granularity for fully-local nested-literal reducer patterns
// (Case A of docs/proposals/dirty-mask-precision/01-compiler-precise-dirty.md).
//
// Before this change, a case body that wrote `{ ...state, foo: { ...state.foo, bar: 1 } }`
// emitted a dirty mask covering ALL of `foo.*`'s sub-paths — the
// top-level over-approximation that the runtime prefix walk recovered
// at ~1μs/commit. With this change the compiler emits just
// `bit("foo.bar")`, and the runtime can skip the walk for cases whose
// mask popcount is already ≤4 (the gate added in 00e2e2d).

import { describe, it, expect } from 'vitest'
import { transformLlui } from '../src/transform'

function t(source: string): string {
  const result = transformLlui(source, 'test.ts')
  return result?.output ?? source
}

// Extract the numeric `dirty` arg passed to `__handleMsg` for a given
// message type. `__handleMsg(inst, msg, DIRTY, METHOD, DIRTY_HI?)` —
// the regex captures DIRTY, which is what we assert against.
function dirtyForMsg(out: string, msgType: string): number | null {
  const re = new RegExp(
    `["']${msgType}["']\\s*:\\s*\\(inst,\\s*msg\\)\\s*=>\\s*__handleMsg\\(inst,\\s*msg,\\s*(-?\\d+),`,
  )
  const m = re.exec(out)
  if (!m) return null
  return Number(m[1])
}

describe('Pass 2 — __handlers per-case dirty precision (nested literals)', () => {
  it('emits leaf-path bit for a single nested field write', () => {
    const src = `
      import { component, text } from '@llui/dom'
      type State = { foo: { bar: number; baz: number } }
      type Msg = { type: 'bumpBar' }
      export const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ foo: { bar: 0, baz: 0 } }, []],
        update: (state, msg) => {
          switch (msg.type) {
            case 'bumpBar':
              return [{ ...state, foo: { ...state.foo, bar: state.foo.bar + 1 } }, []]
          }
        },
        view: ({ text }) => [
          text(s => String(s.foo.bar)),
          text(s => String(s.foo.baz)),
        ],
      })
    `
    const out = t(src)
    // Two prefix paths: foo.bar (bit 1) and foo.baz (bit 2).
    // Old behavior: dirty = topLevelBits["foo"] = 0b11 = 3.
    // New behavior: dirty = bit("foo.bar") = 1.
    const dirty = dirtyForMsg(out, 'bumpBar')
    expect(dirty).toBe(1)
  })

  it('falls back to top-level mask when the nested patch uses an opaque spread', () => {
    const src = `
      import { component, text } from '@llui/dom'
      type State = { foo: { bar: number; baz: number } }
      type Msg = { type: 'merge'; patch: Partial<State['foo']> }
      export const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ foo: { bar: 0, baz: 0 } }, []],
        update: (state, msg) => {
          switch (msg.type) {
            case 'merge':
              return [{ ...state, foo: { ...state.foo, ...msg.patch } }, []]
          }
        },
        view: ({ text }) => [
          text(s => String(s.foo.bar)),
          text(s => String(s.foo.baz)),
        ],
      })
    `
    const out = t(src)
    // Opaque inner spread — analyzer must bail to top-level granularity.
    // dirty = topLevelBits["foo"] = bits 1 and 2 = 3.
    const dirty = dirtyForMsg(out, 'merge')
    expect(dirty).toBe(3)
  })

  it('descends through two levels of nesting', () => {
    const src = `
      import { component, text } from '@llui/dom'
      type State = { a: { b: { c: number; d: number }; e: number } }
      type Msg = { type: 'setC' }
      export const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ a: { b: { c: 0, d: 0 }, e: 0 } }, []],
        update: (state, msg) => {
          switch (msg.type) {
            case 'setC':
              return [{ ...state, a: { ...state.a, b: { ...state.a.b, c: 5 } } }, []]
          }
        },
        view: ({ text }) => [
          text(s => String(s.a.b.c)),
          text(s => String(s.a.b.d)),
          text(s => String(s.a.e)),
        ],
      })
    `
    const out = t(src)
    // Three prefixes: a.b.c (bit 1), a.b.d (bit 2), a.e (bit 4).
    // Old behavior: dirty = topLevelBits["a"] = 0b111 = 7.
    // New behavior: dirty = bit("a.b.c") = 1.
    const dirty = dirtyForMsg(out, 'setC')
    expect(dirty).toBe(1)
  })

  it('treats wholesale-replacement (no inner spread) as top-level dirty', () => {
    const src = `
      import { component, text } from '@llui/dom'
      type State = { foo: { bar: number; baz: number } }
      type Msg = { type: 'replaceFoo' }
      export const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ foo: { bar: 0, baz: 0 } }, []],
        update: (state, msg) => {
          switch (msg.type) {
            case 'replaceFoo':
              // No state.foo spread — both bar and baz get fresh
              // references regardless of their old values.
              return [{ ...state, foo: { bar: 1, baz: 2 } }, []]
          }
        },
        view: ({ text }) => [
          text(s => String(s.foo.bar)),
          text(s => String(s.foo.baz)),
        ],
      })
    `
    const out = t(src)
    // Without `...state.foo` we can't trust unwritten siblings — treat
    // as wholesale replacement of `foo`. dirty = bits 1 and 2 = 3.
    const dirty = dirtyForMsg(out, 'replaceFoo')
    expect(dirty).toBe(3)
  })

  it('combines precise and wholesale modifications across multiple fields', () => {
    const src = `
      import { component, text } from '@llui/dom'
      type State = { foo: { bar: number; baz: number }; count: number; label: string }
      type Msg = { type: 'multi' }
      export const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ foo: { bar: 0, baz: 0 }, count: 0, label: '' }, []],
        update: (state, msg) => {
          switch (msg.type) {
            case 'multi':
              return [{
                ...state,
                foo: { ...state.foo, bar: 99 },  // precise: foo.bar
                count: state.count + 1,           // top-level: count
              }, []]
          }
        },
        view: ({ text }) => [
          text(s => String(s.foo.bar)),
          text(s => String(s.foo.baz)),
          text(s => String(s.count)),
          text(s => s.label),
        ],
      })
    `
    const out = t(src)
    // Prefixes: foo.bar=1, foo.baz=2, count=4, label=8.
    // dirty = bit("foo.bar") | bit("count") = 1 | 4 = 5.
    const dirty = dirtyForMsg(out, 'multi')
    expect(dirty).toBe(5)
  })

  it('top-level non-nested write still works (regression guard)', () => {
    const src = `
      import { component, text } from '@llui/dom'
      type State = { count: number; label: string }
      type Msg = { type: 'inc' }
      export const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ count: 0, label: '' }, []],
        update: (state, msg) => {
          switch (msg.type) {
            case 'inc':
              return [{ ...state, count: state.count + 1 }, []]
          }
        },
        view: ({ text }) => [
          text(s => String(s.count)),
          text(s => s.label),
        ],
      })
    `
    const out = t(src)
    // count=1, label=2. dirty = bit("count") = 1.
    const dirty = dirtyForMsg(out, 'inc')
    expect(dirty).toBe(1)
  })

  it('opaque top-level spread still bails entirely (regression guard)', () => {
    const src = `
      import { component, text } from '@llui/dom'
      type State = { count: number; label: string }
      type Msg = { type: 'merge'; patch: Partial<State> }
      export const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ count: 0, label: '' }, []],
        update: (state, msg) => {
          switch (msg.type) {
            case 'merge':
              return [{ ...state, ...msg.patch }, []]
          }
        },
        view: ({ text }) => [
          text(s => String(s.count)),
          text(s => s.label),
        ],
      })
    `
    const out = t(src)
    // Opaque `...msg.patch` — analyzer bails, no __handlers entry for 'merge'.
    // (the test for this is that there's no precise `_handleMsg(...)` call —
    // generic path runs with runtime-walk dirty)
    expect(out).not.toMatch(/['"]merge['"]\s*:\s*\(inst,\s*msg\)\s*=>\s*__handleMsg/)
  })

  it('shorthand property in nested literal is treated as wholesale (no descent)', () => {
    const src = `
      import { component, text } from '@llui/dom'
      type State = { foo: { bar: number; baz: number } }
      type Msg = { type: 'setBar'; bar: number }
      export const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ foo: { bar: 0, baz: 0 } }, []],
        update: (state, msg) => {
          switch (msg.type) {
            case 'setBar': {
              const bar = msg.bar
              return [{ ...state, foo: { ...state.foo, bar } }, []]
            }
          }
        },
        view: ({ text }) => [
          text(s => String(s.foo.bar)),
          text(s => String(s.foo.baz)),
        ],
      })
    `
    const out = t(src)
    // Shorthand `bar` is a known leaf-path key under foo. dirty = bit("foo.bar") = 1.
    const dirty = dirtyForMsg(out, 'setBar')
    expect(dirty).toBe(1)
  })
})
