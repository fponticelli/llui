// Bundle-strip goldens for the registry-hook activation pattern
// (v2c §2.2 / §2.3).
//
// **The contract:** when an opt-in package's factory is NOT registered
// with `@llui/compiler`, its modules don't activate and their emitted
// fields don't appear in the compiled output. A consumer that doesn't
// import `@llui/compiler-introspection` ships bundles without
// `__msgSchema` / `__msgAnnotations` / `__schemaHash` / etc. — the
// tree-shaking story for the package split.
//
// **What this catches:** future regressions where someone adds a
// cross-package import that bypasses the registry hook (e.g. an
// "import convenience" in @llui/compiler that pulls introspection
// modules directly). The asymmetry between registered/null runs makes
// the leak visible immediately.
//
// **What it doesn't catch:** per-component runtime bundle bloat —
// that's governed by `sideEffects: false` on the runtime packages
// and is tested elsewhere via @llui/dom's bundle-size suite.
//
// Each test sets the registry state, runs `transformLlui`, asserts
// the presence/absence of marker strings, and restores the registry
// to the vitest.setup.ts baseline (both factories registered) so
// sibling tests in this process aren't polluted.

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { transformLlui } from '../src/transform.js'
import {
  registerIntrospectionFactory,
  registerDevtoolsFactory,
  getIntrospectionFactory,
  getDevtoolsFactory,
} from '../src/introspection-factory.js'
// Relative-path imports (not package imports) so the compiler package
// doesn't need to declare its opt-in siblings as devDeps — keeps the
// production dep graph one-way and avoids pnpm's cyclic-workspace
// warning. See vitest.setup.ts for the same pattern + rationale.
import { introspectionFactory } from '../../compiler-introspection/src/index.js'
import { devtoolsFactory } from '../../compiler-devtools/src/index.js'

const FIXTURE = `
import { component, div, text } from '@llui/dom'

type State = { count: number }
type Msg = { type: 'inc' } | { type: 'reset' }

export const Counter = component<State, Msg>({
  name: 'Counter',
  init: () => [{ count: 0 }, []],
  update: (s, m) => (m.type === 'inc' ? [{ count: s.count + 1 }, []] : [{ count: 0 }, []]),
  view: ({ text }) => [div({}, [text((s) => String(s.count))])],
})
`

// Capture the baseline state (whatever vitest.setup.ts registered).
// Restore at the end of the file so sibling test files reading the
// registry state observe the same baseline.
const baselineIntrospection = getIntrospectionFactory()
const baselineDevtools = getDevtoolsFactory()

describe('bundle-strip goldens — introspection registry hook', () => {
  beforeEach(() => {
    // Start each test from the baseline. Tests below opt-out as needed.
    registerIntrospectionFactory(baselineIntrospection)
    registerDevtoolsFactory(baselineDevtools)
  })

  afterAll(() => {
    // Restore at file-end so other test files keep their baseline.
    registerIntrospectionFactory(baselineIntrospection)
    registerDevtoolsFactory(baselineDevtools)
  })

  describe('introspection factory registered', () => {
    it('agent mode → __msgSchema, __schemaHash, __msgAnnotations in output', () => {
      registerIntrospectionFactory(introspectionFactory)
      const result = transformLlui(
        FIXTURE,
        'fixture.ts',
        /* devMode */ false,
        /* emitAgentMetadata */ true,
      )
      expect(result).not.toBeNull()
      expect(result!.output).toMatch(/__msgSchema:/)
      expect(result!.output).toMatch(/__schemaHash:/)
      // Annotation map is populated (empty entries for each variant)
      // even without JSDoc; the module suppresses emission when ALL
      // variants are default, so this fixture may not include it.
      // Test asserts only fields that always emit in agent mode.
    })

    it('prod mode (agent off) → __schemaHash still present (always-on)', () => {
      registerIntrospectionFactory(introspectionFactory)
      const result = transformLlui(FIXTURE, 'fixture.ts', false, false)
      expect(result).not.toBeNull()
      expect(result!.output).toMatch(/__schemaHash:/)
      // Agent-only fields stripped:
      expect(result!.output).not.toMatch(/__msgSchema:/)
      expect(result!.output).not.toMatch(/__msgAnnotations:/)
      expect(result!.output).not.toMatch(/__stateSchema:/)
    })
  })

  describe('introspection factory NOT registered', () => {
    it('agent mode requested → NO __msgSchema, NO __msgAnnotations, NO __schemaHash', () => {
      registerIntrospectionFactory(null)
      const result = transformLlui(FIXTURE, 'fixture.ts', false, /* emitAgentMetadata */ true)
      expect(result).not.toBeNull()
      // All introspection fields stripped, including schema-hash —
      // when the factory isn't registered, the whole module set is
      // gone (no factory call = no schema-hash either).
      expect(result!.output).not.toMatch(/__msgSchema:/)
      expect(result!.output).not.toMatch(/__msgAnnotations:/)
      expect(result!.output).not.toMatch(/__stateSchema:/)
      expect(result!.output).not.toMatch(/__schemaHash:/)
    })

    it('prod mode → NO __schemaHash either', () => {
      registerIntrospectionFactory(null)
      const result = transformLlui(FIXTURE, 'fixture.ts', false, false)
      expect(result).not.toBeNull()
      expect(result!.output).not.toMatch(/__schemaHash:/)
    })
  })
})

describe('bundle-strip goldens — devtools registry hook', () => {
  beforeEach(() => {
    registerIntrospectionFactory(baselineIntrospection)
    registerDevtoolsFactory(baselineDevtools)
  })

  afterAll(() => {
    registerIntrospectionFactory(baselineIntrospection)
    registerDevtoolsFactory(baselineDevtools)
  })

  it('devtools factory registered + devMode → __componentMeta present', () => {
    registerDevtoolsFactory(devtoolsFactory)
    const result = transformLlui(FIXTURE, 'fixture.ts', /* devMode */ true, false)
    expect(result).not.toBeNull()
    expect(result!.output).toMatch(/__componentMeta:/)
  })

  it('devtools factory NOT registered + devMode → NO __componentMeta', () => {
    registerDevtoolsFactory(null)
    const result = transformLlui(FIXTURE, 'fixture.ts', /* devMode */ true, false)
    expect(result).not.toBeNull()
    expect(result!.output).not.toMatch(/__componentMeta:/)
  })

  it('devtools factory registered + prod mode → NO __componentMeta (factory gates on devMode)', () => {
    registerDevtoolsFactory(devtoolsFactory)
    const result = transformLlui(FIXTURE, 'fixture.ts', /* devMode */ false, false)
    expect(result).not.toBeNull()
    expect(result!.output).not.toMatch(/__componentMeta:/)
  })
})

describe('bundle-strip goldens — always-on contract', () => {
  it('compiler-stamp emits in EVERY mode (no registry required)', () => {
    // Reset to the no-opt-in baseline.
    registerIntrospectionFactory(null)
    registerDevtoolsFactory(null)
    try {
      const result = transformLlui(FIXTURE, 'fixture.ts', false, false)
      expect(result).not.toBeNull()
      // compiler-stamp module lives in @llui/compiler (always-on).
      // Its emission is unconditional — required for the @llui/dom
      // runtime's __compilerVersion gate AND the Vite plugin's
      // closeBundle integrity check.
      expect(result!.output).toMatch(/__compilerVersion:/)
      expect(result!.output).toMatch(/__lluiCompilerEmitted:/)
    } finally {
      // Restore so the parent describe's afterAll isn't the only
      // thing keeping the other tests in this file sane.
      registerIntrospectionFactory(baselineIntrospection)
      registerDevtoolsFactory(baselineDevtools)
    }
  })

  it('dom modules emit regardless of opt-in packages', () => {
    registerIntrospectionFactory(null)
    registerDevtoolsFactory(null)
    try {
      const result = transformLlui(FIXTURE, 'fixture.ts', false, false)
      expect(result).not.toBeNull()
      // elSplit is element-rewrite's output — proves the dom modules
      // ran even with all opt-in packages stripped.
      expect(result!.output).toMatch(/elSplit/)
      // __prefixes is core-synthesis's output. (__update was removed
      // in v0.4 — the runtime always uses genericUpdate.)
      expect(result!.output).toMatch(/__prefixes:/)
    } finally {
      registerIntrospectionFactory(baselineIntrospection)
      registerDevtoolsFactory(baselineDevtools)
    }
  })
})
