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

  // ── Regression tests for v0.5.3 bare-Identifier over-permissiveness ─
  //
  // `isReactiveAccessor` defaulted to `true` for any bare-Identifier
  // callee at arg[0]. That caught every user mutator with an arrow
  // argument and ran the opaque-state-flow visitor over its body.
  // 0.5.4 narrows the bare-Identifier branch to the framework primitives
  // that actually take a reactive accessor at arg[0]: `text`, `memo`,
  // `unsafeHtml` (plus destructure-renamed aliases of those).

  it('does NOT error on state-updater callbacks like change((c) => cond ? newC : c)', () => {
    // The reduced reproduction from decisive.space: `change` is a
    // `(updater: (c: T) => T) => void` mutator, not a reactive primitive.
    // Its arrow argument is opaque user code that the framework neither
    // schedules nor reads from. Walking it produced a "state in
    // conditional branch" false-positive on `: c`.
    const diags = diagsFor(`
      import { component, button } from '@llui/dom'
      type NumberFormat = { code: string }
      type State = { format: NumberFormat }
      type Msg = { type: 'noop' }
      const isCurrency = (_fmt: NumberFormat) => true
      declare const change: (updater: (c: NumberFormat) => NumberFormat) => void
      export const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ format: { code: 'USD' } }, []],
        update: (s) => [s, []],
        view: ({ send }) => [
          button({
            onClick: () => {
              change((c) => isCurrency(c) ? { ...c, code: 'EUR' } : c)
              send({ type: 'noop' })
            },
          }),
        ],
      })
    `)
    expect(diags).toEqual([])
  })

  it('does NOT error on user helper at arg0 (dispatch, setTimeout-style)', () => {
    const diags = diagsFor(`
      import { component, button } from '@llui/dom'
      type State = { count: number }
      type Msg = { type: 'noop' }
      declare const dispatch: (fn: (s: State) => State) => void
      export const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s) => [s, []],
        view: ({ send }) => [
          button({
            onClick: () => {
              dispatch((s) => s.count > 5 ? { count: 0 } : s)
              send({ type: 'noop' })
            },
          }),
        ],
      })
    `)
    expect(diags).toEqual([])
  })

  it('still walks the `text((s) => …)` bare-identifier primitive', () => {
    // The narrowed predicate must keep recognizing the genuine
    // reactive primitives. Verified here by feeding the walker an
    // opaque shape — `helper({ ...s })` spread — inside a `text(...)`
    // accessor and asserting the diagnostic still fires.
    const diags = diagsFor(`
      import { component, text } from '@llui/dom'
      function helper(_o: { count: number }) { return 0 }
      type State = { count: number }
      export const C = component<State, never, never>({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s) => [s, []],
        view: () => [text((s: State) => String(helper({ ...s })))],
      })
    `)
    expect(diags.length).toBeGreaterThanOrEqual(1)
    expect(diags[0]!.message).toMatch(/spread/i)
  })

  it('still walks `selector((s) => …)` — covers the View-bag selector primitive', () => {
    // `selector` is in REACTIVE_BARE_IDENT_ARG0 alongside text/memo/
    // unsafeHtml. Lightly-used but a real public API; including it keeps
    // the predicate from silently skipping selector accessors.
    const diags = diagsFor(`
      import { component, div } from '@llui/dom'
      declare const selector: <S, V>(field: (s: S) => V) => unknown
      function helper(_o: { count: number }) { return 0 }
      type State = { count: number }
      export const C = component<State, never, never>({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s) => [s, []],
        view: () => [div([selector((s: State) => helper({ ...s }))] as never)],
      })
    `)
    expect(diags.length).toBeGreaterThanOrEqual(1)
    expect(diags[0]!.message).toMatch(/spread/i)
  })

  it('still walks `t((s) => …)` when t is a const-rebound alias of text', () => {
    // `const t = text; t((s) => …)` — const rebinding to a primitive.
    // The resolver follows the const-initializer identifier chain.
    const diags = diagsFor(`
      import { component, text } from '@llui/dom'
      function helper(_o: { count: number }) { return 0 }
      type State = { count: number }
      const t = text
      export const C = component<State, never, never>({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s) => [s, []],
        view: () => [t((s: State) => String(helper({ ...s })))],
      })
    `)
    expect(diags.length).toBeGreaterThanOrEqual(1)
    expect(diags[0]!.message).toMatch(/spread/i)
  })

  it('does NOT walk `text((s) => …)` when `text` is locally shadowed by a function', () => {
    // Local `function text(x) { … }` shadows the primitive. The
    // resolver detects the shadowing FunctionDeclaration and refuses
    // to classify the call as reactive.
    const diags = diagsFor(`
      import { component, button } from '@llui/dom'
      function text(_accessor: (s: { count: number }) => string): string { return '' }
      type State = { count: number }
      type Msg = { type: 'noop' }
      export const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s) => [s, []],
        view: ({ send }) => [
          button({
            onClick: () => {
              text((s) => s.count > 5 ? 'a' : 'b')
              send({ type: 'noop' })
            },
          }),
        ],
      })
    `)
    expect(diags).toEqual([])
  })

  it('still walks `t((s) => …)` when t is a destructure-renamed text alias', () => {
    // `view: ({text: t}) => ...` aliases `t` to `text`; the predicate
    // resolves the alias via the destructure pattern and still treats
    // the call as reactive. Otherwise the walker would silently skip
    // the binding entirely.
    const diags = diagsFor(`
      import { component } from '@llui/dom'
      function helper(_o: { count: number }) { return 0 }
      type State = { count: number }
      export const C = component<State, never, never>({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s) => [s, []],
        view: ({ text: t }) => [t((s: State) => String(helper({ ...s })))],
      })
    `)
    expect(diags.length).toBeGreaterThanOrEqual(1)
    expect(diags[0]!.message).toMatch(/spread/i)
  })

  it('does NOT error on ItemAccessor identity-projection `provider((v) => v)` (dicerun2 #4)', () => {
    // ItemAccessor<T> is callable: `<R>(selector: (t: T) => R) => () => R`.
    // The selector arrow's param is the ITEM, not state — the rule
    // must not enter `(v) => v` as a reactive accessor.
    // Verified fix path: the bare-Identifier narrowing from 0.5.4
    // (provider is a function parameter → resolver returns null →
    // not in REACTIVE_BARE_IDENT_ARG0 → not visited).
    const diags = diagsFor(`
      import { component, div } from '@llui/dom'
      import type { ItemAccessor } from '@llui/dom'
      function providerBadge(provider: ItemAccessor<string>) {
        const _key = provider((v) => v)
        return div({})
      }
      type State = { items: string[] }
      export const C = component<State, never, never>({
        name: 'C',
        init: () => [{ items: [] }, []],
        update: (s) => [s, []],
        view: () => [providerBadge({} as ItemAccessor<string>)],
      })
    `)
    expect(diags).toEqual([])
  })

  it('does NOT error on subscribe callbacks with shorthand body (dicerun2 #5)', () => {
    // `subscribeRolls((entry) => send({ type: 'push', entry }))` —
    // the shorthand `entry` inside the object would have been
    // flagged as "state used outside a tracked container" because
    // the walker over-entered the outer `(entry) => …` arrow as
    // a reactive accessor. 0.5.4's bare-Identifier narrowing
    // confines reactive entry to text/memo/unsafeHtml/selector.
    const diags = diagsFor(`
      import { component, button } from '@llui/dom'
      type Entry = { id: string; label: string }
      type State = { entries: Entry[] }
      type Msg = { type: 'push'; entry: Entry } | { type: 'noop' }
      declare const subscribeRolls: (cb: (entry: Entry) => void) => () => void
      export const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ entries: [] }, []],
        update: (s) => [s, []],
        view: ({ send }) => [
          button({
            onClick: () => {
              subscribeRolls((entry) => send({ type: 'push', entry }))
              send({ type: 'noop' })
            },
          }),
        ],
      })
    `)
    expect(diags).toEqual([])
  })

  it('does NOT error inside track({ deps }) — opt-in suppression', () => {
    // `track({deps})` is the user's explicit declaration that the
    // walker can't infer the reads. Firing a perf lint inside it
    // defeats the purpose — the diagnostic would move from the
    // outer accessor to inside track, leaving no recovery path.
    // The mask/path classifier still does what it can; the rule
    // just doesn't shout at code the author explicitly opted into.
    const diags = diagsFor(`
      import { component, button, track } from '@llui/dom'
      type State = { error?: string }
      type Msg = { type: 'noop' }
      function formErrorRow<S>(error: (s: S) => string | undefined) {
        track({ deps: (s: S) => [error(s)] })
        return button({})
      }
      export const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ error: undefined }, []],
        update: (s) => [s, []],
        view: () => [formErrorRow<State>((s) => s.error)],
      })
    `)
    // The track.deps body's `error(s)` call WOULD be an opaque-flow
    // leak under the rule's normal logic; the suppression silences it.
    expect(diags.filter((d) => /unresolvable callee `error\(s\)`/.test(d.message))).toEqual([])
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
