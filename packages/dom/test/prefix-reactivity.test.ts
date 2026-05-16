// Validates the path-keyed reactivity opt-in (`__prefixes` on ComponentDef).
// This is the unified-composition-model spike landing in @llui/dom — see
// `docs/proposals/unified-composition-model.md`.
//
// The test bypasses the Vite plugin by hand-authoring a component that
// declares `__prefixes` and assigns binding masks based on prefix-table
// positions. The runtime should compute `combinedDirty` by reference-
// comparing prev/next at each prefix, not via the top-level-field bitmask.

import { describe, it, expect } from 'vitest'
import { createComponentInstance, flushInstance, computeDirtyFromPrefixes } from '../src/update-loop'
import { createBinding } from '../src/binding'
import { applyBinding } from '../src/binding'
import type { ComponentDef, Binding } from '../src/types'

describe('computeDirtyFromPrefixes', () => {
  it('returns 0 when prev and next are reference-equal at every prefix', () => {
    const state = { a: 1, b: { c: 2 } }
    const prefixes = [(s: typeof state) => s.a, (s: typeof state) => s.b]
    const dirty = computeDirtyFromPrefixes(
      prefixes as ReadonlyArray<(s: unknown) => unknown>,
      state,
      state,
    )
    expect(dirty).toBe(0)
  })

  it('sets a single bit when one prefix changes', () => {
    const prev = { a: 1, b: { c: 2 } }
    const next = { ...prev, a: 99 }
    const prefixes = [(s: typeof prev) => s.a, (s: typeof prev) => s.b]
    const dirty = computeDirtyFromPrefixes(
      prefixes as ReadonlyArray<(s: unknown) => unknown>,
      prev,
      next,
    )
    expect(dirty).toBe(0b01)
  })

  it('sets multiple bits when multiple prefixes change', () => {
    const prev = { a: 1, b: { c: 2 }, d: 'x' }
    const next = { a: 1, b: { c: 3 }, d: 'y' }
    const prefixes = [
      (s: typeof prev) => s.a, // bit 0 — unchanged
      (s: typeof prev) => s.b, // bit 1 — changed (different object)
      (s: typeof prev) => s.d, // bit 2 — changed (string)
    ]
    const dirty = computeDirtyFromPrefixes(
      prefixes as ReadonlyArray<(s: unknown) => unknown>,
      prev,
      next,
    )
    expect(dirty).toBe(0b110)
  })

  it('uses two-word pair shape for >31 prefixes', () => {
    // 35 distinct paths; bits 0..30 in low word, bits 31..34 in high word
    const state: Record<string, number> = {}
    for (let i = 0; i < 35; i++) state[`f${i}`] = i
    const next = { ...state, f33: 9999 } // change something in the high word
    const prefixes: Array<(s: unknown) => unknown> = []
    for (let i = 0; i < 35; i++) {
      const key = `f${i}`
      prefixes.push((s) => (s as Record<string, unknown>)[key])
    }
    const dirty = computeDirtyFromPrefixes(prefixes, state, next)
    expect(Array.isArray(dirty)).toBe(true)
    const [lo, hi] = dirty as [number, number]
    expect(lo).toBe(0)
    // f33 is the 34th entry, position 33 — high word bit (33 - 31) = 2
    expect(hi).toBe(0b100)
  })
})

describe('component with __prefixes opts into path-keyed reactivity', () => {
  type S = { user: { name: string; email: string } | null; count: number; query: string }
  type M = { type: 'setName'; v: string } | { type: 'inc' } | { type: 'setQuery'; v: string }

  // Stable hoisted prefix closures (what the compiler would emit at module scope).
  const prefixUser = (s: S): unknown => s.user
  const prefixCount = (s: S): unknown => s.count
  const prefixQuery = (s: S): unknown => s.query

  // Bit positions assigned by the compiler based on position in __prefixes:
  //   prefixUser  → bit 0
  //   prefixCount → bit 1
  //   prefixQuery → bit 2
  const MASK_USER = 1 << 0
  const MASK_COUNT = 1 << 1
  const MASK_QUERY = 1 << 2

  function makeDef(): ComponentDef<S, M, never> {
    return {
      name: 'PrefixOptIn',
      init: () => [{ user: { name: 'a', email: 'a@x' }, count: 0, query: '' }, []],
      update: (s, m) => {
        switch (m.type) {
          case 'setName':
            return [{ ...s, user: s.user ? { ...s.user, name: m.v } : null }, []]
          case 'inc':
            return [{ ...s, count: s.count + 1 }, []]
          case 'setQuery':
            return [{ ...s, query: m.v }, []]
        }
      },
      view: () => [],
      __prefixes: [prefixUser, prefixCount, prefixQuery],
    }
  }

  it('uses __prefixes (not __dirty) to compute combinedDirty', () => {
    const inst = createComponentInstance(makeDef())
    // Hand-register a binding gating on MASK_USER. The accessor pulls user.name.
    const node = document.createTextNode('')
    let fireCount = 0
    createBinding(inst.rootLifetime, {
      mask: MASK_USER,
      accessor: (s) => {
        fireCount++
        return (s as S).user?.name ?? ''
      },
      kind: 'text',
      node,
      perItem: false,
    })
    // Push the binding into the instance's flat binding array so Phase 2 sees it.
    inst.allBindings.push(inst.rootLifetime.bindings[0]!)

    // Initial fire happens in view() during mount in real life — we
    // didn't run a view here, so seed the lastValue via a manual call.
    inst.send({ type: 'setName', v: 'b' })
    flushInstance(inst)
    expect((inst.state as S).user?.name).toBe('b')
    // The accessor fired during Phase 2 of the update (gate succeeded)
    expect(fireCount).toBeGreaterThan(0)
    expect(node.nodeValue).toBe('b')
  })

  it('does NOT fire a binding whose prefix did not change', () => {
    const inst = createComponentInstance(makeDef())
    const node = document.createTextNode('')
    let fireCount = 0
    createBinding(inst.rootLifetime, {
      mask: MASK_USER, // depends on s.user only
      accessor: (s) => {
        fireCount++
        return (s as S).user?.email ?? ''
      },
      kind: 'text',
      node,
      perItem: false,
    })
    inst.allBindings.push(inst.rootLifetime.bindings[0]!)
    // Seed lastValue by running the accessor once (simulating mount).
    const b = inst.allBindings[0]!
    b.lastValue = b.accessor(inst.state)
    applyBinding(b, b.lastValue)
    fireCount = 0

    // Mutate `count` only — `user` reference is preserved.
    inst.send({ type: 'inc' })
    flushInstance(inst)
    expect((inst.state as S).count).toBe(1)
    // The user-prefix binding's accessor must NOT have re-run, because
    // s.user did not change reference — that's the whole point of
    // path-keyed reactivity.
    expect(fireCount).toBe(0)
  })

  it('fires only the bindings whose prefix actually changed (precision)', () => {
    const inst = createComponentInstance(makeDef())
    const log: string[] = []
    const fired = (label: string) => (s: unknown): unknown => {
      log.push(label)
      return (s as S).query
    }
    // Three bindings: each watches a different prefix.
    createBinding(inst.rootLifetime, {
      mask: MASK_USER,
      accessor: fired('user'),
      kind: 'text',
      node: document.createTextNode(''),
      perItem: false,
    })
    createBinding(inst.rootLifetime, {
      mask: MASK_COUNT,
      accessor: fired('count'),
      kind: 'text',
      node: document.createTextNode(''),
      perItem: false,
    })
    createBinding(inst.rootLifetime, {
      mask: MASK_QUERY,
      accessor: fired('query'),
      kind: 'text',
      node: document.createTextNode(''),
      perItem: false,
    })
    for (const b of inst.rootLifetime.bindings) {
      inst.allBindings.push(b as Binding)
      // Seed each binding's lastValue with the current value
      ;(b as Binding).lastValue = (b as Binding).accessor(inst.state)
    }
    log.length = 0

    inst.send({ type: 'setQuery', v: 'hello' })
    flushInstance(inst)
    // Only the 'query'-watching binding should have re-run its accessor.
    expect(log).toEqual(['query'])
  })

  it('falls back to __dirty when __prefixes is absent (unchanged behavior)', () => {
    // Without __prefixes, the bitmask path runs as before.
    const def: ComponentDef<S, M, never> = {
      ...makeDef(),
      __prefixes: undefined,
      __dirty: (o, n) =>
        (Object.is(o.user, n.user) ? 0 : MASK_USER) |
        (Object.is(o.count, n.count) ? 0 : MASK_COUNT) |
        (Object.is(o.query, n.query) ? 0 : MASK_QUERY),
    }
    const inst = createComponentInstance(def)
    let fireCount = 0
    createBinding(inst.rootLifetime, {
      mask: MASK_USER,
      accessor: (s) => {
        fireCount++
        return (s as S).user?.name ?? ''
      },
      kind: 'text',
      node: document.createTextNode(''),
      perItem: false,
    })
    inst.allBindings.push(inst.rootLifetime.bindings[0]!)
    const b = inst.allBindings[0]!
    b.lastValue = b.accessor(inst.state)
    fireCount = 0

    inst.send({ type: 'inc' })
    flushInstance(inst)
    // bitmask path: count changed → MASK_COUNT bit. user binding gate
    // is MASK_USER. (MASK_USER & MASK_COUNT) === 0 → no fire. Same as
    // __prefixes path — the result is identical.
    expect(fireCount).toBe(0)
  })
})
