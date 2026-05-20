// Validates the path-keyed reactivity opt-in (`__prefixes` on ComponentDef).
// This is the unified-composition-model spike landing in @llui/dom — see
// `docs/proposals/unified-composition-model.md`.
//
// The test bypasses the Vite plugin by hand-authoring a component that
// declares `__prefixes` and assigns binding masks based on prefix-table
// positions. The runtime should compute `combinedDirty` by reference-
// comparing prev/next at each prefix, not via the top-level-field bitmask.

import { describe, it, expect } from 'vitest'
import {
  createComponentInstance,
  flushInstance,
  computeDirtyFromPrefixes,
  _handleMsg,
} from '../src/update-loop'
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
      __compilerVersion: '__test__',
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
    const fired =
      (label: string) =>
      (s: unknown): unknown => {
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

  it('gates a high-word binding (maskHi) against a high-word prefix change (>31 paths)', () => {
    // Build a component with 35 prefixes — positions 0..30 in the low
    // word, positions 31..34 in the high word. Position 33 (high-word
    // bit 2) is the one we mutate, gating a single binding that only
    // reads `f33`.
    type Big = Record<string, number>
    const prefixes: Array<(s: unknown) => unknown> = []
    for (let i = 0; i < 35; i++) {
      const key = `f${i}`
      prefixes.push((s) => (s as Big)[key])
    }
    const initial: Big = {}
    for (let i = 0; i < 35; i++) initial[`f${i}`] = 0

    type M = { type: 'bumpF33' } | { type: 'bumpF0' }
    const def: ComponentDef<Big, M, never> = {
      name: 'BigComponent',
      init: () => [initial, []],
      update: (s, m) => {
        switch (m.type) {
          case 'bumpF33':
            return [{ ...s, f33: s.f33! + 1 }, []]
          case 'bumpF0':
            return [{ ...s, f0: s.f0! + 1 }, []]
        }
      },
      view: () => [],
      __compilerVersion: '__test__',
      __prefixes: prefixes,
    }
    const inst = createComponentInstance(def)

    let f33FireCount = 0
    let f0FireCount = 0

    // Binding gating on f33 — high-word bit 2 (position 33 - 31 = 2).
    createBinding(inst.rootLifetime, {
      mask: 0,
      maskHi: 1 << 2,
      accessor: (s) => {
        f33FireCount++
        return String((s as Big).f33)
      },
      kind: 'text',
      node: document.createTextNode(''),
      perItem: false,
    })
    // Binding gating on f0 — low-word bit 0.
    createBinding(inst.rootLifetime, {
      mask: 1 << 0,
      maskHi: 0,
      accessor: (s) => {
        f0FireCount++
        return String((s as Big).f0)
      },
      kind: 'text',
      node: document.createTextNode(''),
      perItem: false,
    })
    for (const b of inst.rootLifetime.bindings) {
      inst.allBindings.push(b as Binding)
      ;(b as Binding).lastValue = (b as Binding).accessor(inst.state)
    }
    f33FireCount = 0
    f0FireCount = 0

    // Mutate f33 — should fire ONLY the high-word binding.
    inst.send({ type: 'bumpF33' })
    flushInstance(inst)
    expect(f33FireCount).toBe(1)
    expect(f0FireCount).toBe(0)

    // Mutate f0 — should fire ONLY the low-word binding.
    inst.send({ type: 'bumpF0' })
    flushInstance(inst)
    expect(f33FireCount).toBe(1)
    expect(f0FireCount).toBe(1)
  })

  it("dispatches a high-word case through __handlers' single-message fast path", () => {
    // Same 35-prefix shape, but this time wire `__handlers` so the
    // single-message fast path in `processMessages` engages. The
    // compiler emits `__handleMsg(inst, msg, caseDirty, method,
    // caseDirtyHi)` for cases that touch high-word fields; this test
    // hand-builds that shape and verifies the high-word binding fires.
    type Big = Record<string, number>
    const prefixes: Array<(s: unknown) => unknown> = []
    for (let i = 0; i < 35; i++) {
      const key = `f${i}`
      prefixes.push((s) => (s as Big)[key])
    }
    const initial: Big = {}
    for (let i = 0; i < 35; i++) initial[`f${i}`] = 0

    type M = { type: 'bumpF33' }
    const def: ComponentDef<Big, M, never> = {
      name: 'BigHandlerComponent',
      init: () => [initial, []],
      update: (s, m) => {
        switch (m.type) {
          case 'bumpF33':
            return [{ ...s, f33: s.f33! + 1 }, []]
        }
      },
      view: () => [],
      __compilerVersion: '__test__',
      __prefixes: prefixes,
      __handlers: {
        bumpF33: (inst, msg) =>
          _handleMsg(
            inst as Parameters<typeof _handleMsg>[0],
            msg,
            0, // caseDirty: nothing low-word
            -1, // skip Phase 1 blocks (none)
            1 << 2, // caseDirtyHi: f33 is high-word bit 2
          ) as [Big, never[]],
      },
    }
    const inst = createComponentInstance(def)

    let f33FireCount = 0
    createBinding(inst.rootLifetime, {
      mask: 0,
      maskHi: 1 << 2,
      accessor: (s) => {
        f33FireCount++
        return String((s as Big).f33)
      },
      kind: 'text',
      node: document.createTextNode(''),
      perItem: false,
    })
    for (const b of inst.rootLifetime.bindings) {
      inst.allBindings.push(b as Binding)
      ;(b as Binding).lastValue = (b as Binding).accessor(inst.state)
    }
    f33FireCount = 0

    inst.send({ type: 'bumpF33' })
    flushInstance(inst)
    // _handleMsg ran via the __handlers fast path AND threaded the
    // high-word mask into _runPhase2's gate.
    expect((inst.state as Big).f33).toBe(1)
    expect(f33FireCount).toBe(1)
  })

  it('throws at mount if a user-authored __dirty slips through', () => {
    // `__dirty` is no longer accepted on ComponentDef — it's a runtime
    // throw rather than a silent degradation, so components that still
    // hand-author the old bitmask helper fail loud.
    const def = {
      ...makeDef(),
      __dirty: (o: S, n: S) => (Object.is(o.user, n.user) ? 0 : 1),
    } as unknown as ComponentDef<S, M, never>
    expect(() => createComponentInstance(def)).toThrow(/defines `__dirty` directly/)
  })
})
