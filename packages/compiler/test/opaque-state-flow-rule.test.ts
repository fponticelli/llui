import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { transformLlui } from '../src/transform.js'
import type { Diagnostic } from '../src/diagnostic.js'

function diagsFor(source: string): Diagnostic[] {
  const result = transformLlui(source, 'fixture.ts')
  return result?.diagnostics.filter((d) => d.id === 'llui/opaque-state-flow') ?? []
}

/**
 * Build a multi-file Program and transform the named focal file with
 * cross-file resolution enabled. Mirrors the host adapter wiring in
 * `packages/vite-plugin/src/index.ts` — the lint module only resolves
 * imported callees when a Program is supplied.
 */
function diagsForCrossFile(files: Record<string, string>, focalName: string): Diagnostic[] {
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    types: [],
  }
  const defaultHost = ts.createCompilerHost(compilerOptions, true)
  const host: ts.CompilerHost = {
    ...defaultHost,
    getSourceFile: (fileName, lang, onError, shouldCreateNewSourceFile) => {
      if (files[fileName] !== undefined) {
        return ts.createSourceFile(fileName, files[fileName]!, lang, true)
      }
      return defaultHost.getSourceFile(fileName, lang, onError, shouldCreateNewSourceFile)
    },
    fileExists: (f) => files[f] !== undefined || defaultHost.fileExists(f),
    readFile: (f) => (files[f] !== undefined ? files[f] : defaultHost.readFile(f)),
  }
  const program = ts.createProgram({
    rootNames: Object.keys(files),
    options: compilerOptions,
    host,
  })
  const result = transformLlui(
    files[focalName]!,
    focalName,
    /* devMode */ false,
    /* emitAgentMetadata */ false,
    /* mcpPort */ null,
    /* verbose */ false,
    /* typeSources */ undefined,
    /* preExtracted */ undefined,
    /* crossFilePaths */ undefined,
    /* crossFileOpaque */ false,
    program,
  )
  return result?.diagnostics.filter((d) => d.id === 'llui/opaque-state-flow') ?? []
}

describe('opaque-state-flow lint rule', () => {
  // Each "leak" shape — the runtime stays correct (FULL_MASK + sentinel),
  // but the binding re-evaluates on every state change, so we surface
  // the leak as a compile-time error pointing at the offending node.

  it('errors on opaque function-arg invocation in a binding accessor', () => {
    const diags = diagsFor(`
      import { component, input } from '@llui/dom'
      type State = { zoom: number; hidden: { a: number } }
      function paramRow(
        getParamState: (s: State) => { overrides: Record<string, number> },
      ) {
        return input({
          value: (s: State) => String(getParamState(s).overrides['mod'] ?? 0),
        })
      }
      export const C = component<State, never, never>({
        name: 'C',
        init: () => [{ zoom: 1, hidden: { a: 0 } }, []],
        update: (s) => [s, []],
        view: () => paramRow((s) => ({ overrides: {} })),
      })
    `)
    // The lint fires on the binding inside paramRow — the value accessor
    // \`(s) => String(getParamState(s)...)\` and on the lift arrow's
    // standalone-return shape. We only require at least one error from
    // this rule; exact shape lives in the per-shape tests below.
    expect(diags.length).toBeGreaterThanOrEqual(1)
    for (const d of diags) {
      expect(d.severity).toBe('error')
      expect(d.category).toBe('perf')
      expect(d.message).toMatch(/opaquely/i)
    }
  })

  it('errors on NewExpression with state arg', () => {
    const diags = diagsFor(`
      import { component, input } from '@llui/dom'
      class Wrapper { constructor(_s: { hidden: { a: number } }) {} value = 0 }
      type State = { zoom: number; hidden: { a: number } }
      export const C = component<State, never, never>({
        name: 'C',
        init: () => [{ zoom: 1, hidden: { a: 0 } }, []],
        update: (s) => [s, []],
        view: () => [input({ value: (s: State) => String(new Wrapper(s).value * s.zoom) })],
      })
    `)
    expect(diags).toHaveLength(1)
    expect(diags[0]!.message).toMatch(/constructor/i)
  })

  it('errors on object spread of state', () => {
    const diags = diagsFor(`
      import { component, input } from '@llui/dom'
      function helper(_o: { zoom: number }) { return { x: 0 } }
      type State = { zoom: number }
      export const C = component<State, never, never>({
        name: 'C',
        init: () => [{ zoom: 1 }, []],
        update: (s) => [s, []],
        view: () => [input({ value: (s: State) => String(helper({ ...s }).x) })],
      })
    `)
    expect(diags).toHaveLength(1)
    expect(diags[0]!.message).toMatch(/spread/i)
  })

  it('errors on dynamic element access on state', () => {
    const diags = diagsFor(`
      import { component, input } from '@llui/dom'
      const key: 'zoom' = 'zoom'
      type State = { zoom: number }
      export const C = component<State, never, never>({
        name: 'C',
        init: () => [{ zoom: 1 }, []],
        update: (s) => [s, []],
        view: () => [input({ value: (s: State) => String(s[key]) })],
      })
    `)
    expect(diags).toHaveLength(1)
    expect(diags[0]!.message).toMatch(/dynamic/i)
  })

  it('errors on conditional with state branch', () => {
    const diags = diagsFor(`
      import { component, input } from '@llui/dom'
      type State = { zoom: number; flag: boolean }
      export const C = component<State, never, never>({
        name: 'C',
        init: () => [{ zoom: 1, flag: false }, []],
        update: (s) => [s, []],
        view: () => [
          input({ value: (s: State) => String(((s.flag ? s : s) as State).zoom) }),
        ],
      })
    `)
    expect(diags.length).toBeGreaterThanOrEqual(1)
    // The lift expression in the conditional fires; the message names
    // the conditional or the type assertion shape.
    expect(diags[0]!.message).toMatch(/conditional|assertion/i)
  })

  it('does NOT error on precise property-access accessors', () => {
    const diags = diagsFor(`
      import { component, input, text } from '@llui/dom'
      type State = { zoom: number; hidden: { a: number } }
      export const C = component<State, never, never>({
        name: 'C',
        init: () => [{ zoom: 1, hidden: { a: 0 } }, []],
        update: (s) => [s, []],
        view: () => [
          text((s: State) => String(s.hidden.a)),
          input({ value: (s: State) => \`x=\${s.zoom}\` }),
        ],
      })
    `)
    expect(diags).toEqual([])
  })

  it('does NOT error on resolvable same-module helper delegation', () => {
    const diags = diagsFor(`
      import { component, input } from '@llui/dom'
      type State = { zoom: number }
      const slice = (s: State) => s.zoom * 2
      export const C = component<State, never, never>({
        name: 'C',
        init: () => [{ zoom: 1 }, []],
        update: (s) => [s, []],
        view: () => [input({ value: (s: State) => String(slice(s)) })],
      })
    `)
    expect(diags).toEqual([])
  })

  // ── Regression tests for v0.5.2 cross-file false-positives ────────
  //
  // The original implementation only walked same-file `const`/`function`
  // declarations and only inspected `arg0` to a CallExpression. Three
  // legitimate shapes errored as opaque-flow leaks, blocking the 0.5.2
  // upgrade in real consumers. These tests pin the corrected behaviour.

  it('does NOT error on imported same-package helper called at arg0 (cross-file)', () => {
    // Case 1 from the bug report: `matrixOrEmpty(s)` where `matrixOrEmpty`
    // lives in another module. With a Program supplied, the resolver
    // follows the alias and walks the helper's body — the call is
    // tracked, no diagnostic.
    const diags = diagsForCrossFile(
      {
        '/state.ts': `
          export type State = { matrix: { rows: number } | null }
          export const matrixOrEmpty = (s: State) => s.matrix ?? { rows: 0 }
        `,
        '/main.ts': `
          import { component, input } from '@llui/dom'
          import { matrixOrEmpty, type State } from './state.ts'
          export const C = component<State, never, never>({
            name: 'C',
            init: () => [{ matrix: null }, []],
            update: (s) => [s, []],
            view: () => [input({ value: (s: State) => String(matrixOrEmpty(s).rows) })],
          })
        `,
      },
      '/main.ts',
    )
    expect(diags).toEqual([])
  })

  it('DOES error on imported helper at arg0 when no Program is available', () => {
    // Without a Program, the resolver can't follow the import — falls
    // back to file-local lookup, which fails. The diagnostic correctly
    // fires because the lint can't see what the helper reads.
    const diags = diagsFor(`
      import { component, input } from '@llui/dom'
      // No source for matrixOrEmpty — declare it via ambient shape.
      declare const matrixOrEmpty: (s: { matrix: { rows: number } | null }) => { rows: number }
      type State = { matrix: { rows: number } | null }
      export const C = component<State, never, never>({
        name: 'C',
        init: () => [{ matrix: null }, []],
        update: (s) => [s, []],
        view: () => [input({ value: (s: State) => String(matrixOrEmpty(s).rows) })],
      })
    `)
    expect(diags.length).toBeGreaterThanOrEqual(1)
    expect(diags[0]!.message).toMatch(/unresolvable callee/i)
  })

  it('points the function-parameter hint at the items-bag rewrite', () => {
    // When the unresolvable callee is a function parameter (the
    // helpers-take-`(s)=>…`-callbacks composition pattern), the hint
    // should redirect the author at the items-bag shape, not the
    // generic "inline or refactor" advice — the closure is opaque to
    // per-binding analysis no matter how it's wrapped.
    const diags = diagsForCrossFile(
      {
        '/main.ts': `
          import { component, input } from '@llui/dom'
          type State = { paramOverridesById: Record<string, Record<string, number>> }
          function paramRow(getParamState: (s: State) => { overrides: Record<string, number> }) {
            return input({ value: (s: State) => String(getParamState(s).overrides['mod'] ?? 0) })
          }
          export const C = component<State, never, never>({
            name: 'C',
            init: () => [{ paramOverridesById: {} }, []],
            update: (s) => [s, []],
            view: () => paramRow((s) => ({ overrides: s.paramOverridesById['e'] ?? {} })),
          })
        `,
      },
      '/main.ts',
    )
    expect(diags.length).toBeGreaterThanOrEqual(1)
    const fnParamLeak = diags.find((d) =>
      /unresolvable callee `getParamState\(s\)`/.test(d.message),
    )
    expect(fnParamLeak).toBeDefined()
    expect(fnParamLeak!.message).toMatch(/each.*items|item\.\*/i)
  })

  it('does NOT error on state passed as arg1+ (documented "not flagged" behaviour)', () => {
    // Case 2 from the bug report. The header comment lists arg1+ as
    // intentionally not flagged — the runtime sentinel keeps the
    // binding correct. The original implementation flagged it anyway
    // because the CallExpression branch only matched `arguments[0]`.
    const diags = diagsFor(`
      import { component, input } from '@llui/dom'
      type State = { zoom: number }
      type Opts = { readOnly: boolean }
      const isReadonly = (_opts: Opts, _s: State) => true
      export const C = component<State, never, never>({
        name: 'C',
        init: () => [{ zoom: 1 }, []],
        update: (s) => [s, []],
        view: () => [
          input({
            // \`s\` at arg[1] of \`isReadonly(opts, s)\` — must not be flagged.
            class: (s: State) => isReadonly({ readOnly: false }, s) ? 'ro' : 'rw',
          }),
        ],
      })
    `)
    expect(diags).toEqual([])
  })

  it('does NOT walk view-bag `default` callback as a reactive accessor (View bag is not state)', () => {
    // Case 3 from the bug report. \`default: (h) => ...\` receives a
    // View<S, M> bag, not state. The walker used to treat the bag's
    // identifier as state and chase its references as leaks. The
    // canonical reproduction: the bag passed to a sub-view at arg[2]
    // of \`subView(item, kind, h)\` inside a \`sample\` callback.
    const diags = diagsFor(`
      import { component, branch, sample, text } from '@llui/dom'
      type State = { mode: 'a' | 'b'; label: string }
      function subView(label: string, h: { text: typeof text }) {
        return [h.text(() => label)]
      }
      export const C = component<State, never, never>({
        name: 'C',
        init: () => [{ mode: 'a', label: 'hi' }, []],
        update: (s) => [s, []],
        view: () => [
          branch({
            on: (s: State) => s.mode,
            default: (h2) => [
              ...h2.sample((s: State): Node[] => subView(s.label, h2)),
            ],
          }),
        ],
      })
    `)
    expect(diags).toEqual([])
  })

  it('does NOT error on non-reactive arrows (event handlers, onEffect)', () => {
    const diags = diagsFor(`
      import { component, button } from '@llui/dom'
      type State = { count: number }
      type Msg = { type: 'inc' }
      export const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s) => [s, []],
        view: ({ send }) => [
          button({
            // Event handlers are not reactive accessors — even though
            // they reference state-like names inside, they're not
            // visited by the classifier.
            onClick: (_e) => send({ type: 'inc' }),
          }),
        ],
      })
    `)
    expect(diags).toEqual([])
  })
})
