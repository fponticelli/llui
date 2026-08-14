import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { collectSignalDeps as collectDeps } from '../src/signals/collect-signal-deps'
import { transformSignalComponentSource as transformSource } from '../src/signals/transform-component'
import { parseModule } from '../src/parse.js'

/** Both entry points take a parsed module (one parse per pass, real-filename
 * ScriptKind — #93). `fileName` stays explicit at every call site here because
 * these tests care about it: `in.ts` vs `in.tsx` is the generic-arrow case. */
const collectSignalDeps = (src: string, opts: { fileName: string }) =>
  collectDeps(parseModule(opts.fileName, src))
const transformSignalComponentSource = (src: string, opts: { fileName: string }) =>
  transformSource(parseModule(opts.fileName, src))

/**
 * The file-level dependency-path collector behind `llui_static_collect_paths`.
 *
 * `collectSignalDeps` is a DRIVER over the one dependency analyzer
 * (`analyze-deps.ts` via `extract-deps.ts`) — the same analysis the view
 * transform uses to build each binding's `deps` array. The tests below pin two
 * things:
 *
 *   1. DEPTH. Paths are reported at their full authored depth. The deleted
 *      second analyzer (`collect-deps.ts`, issue #92) truncated every path at
 *      two segments, so `s.user.profile.address.city` reached agents as
 *      `user.profile`. Truncation is coverage-sound (a prefix dep covers its
 *      descendants) but it is a LIE to a reader.
 *   2. PARITY. What the collector reports for a component equals what the
 *      transform actually emits into that component's `deps` arrays.
 */

const FOUR_LEVEL = `
import { component, div, span, text } from '@llui/dom'

type State = {
  user: { profile: { address: { city: string; zip: string } } }
  theme: string
}
type Msg = { type: 'noop' }

export const C = component<State, Msg>({
  name: 'C',
  init: () => [{ user: { profile: { address: { city: '', zip: '' } } }, theme: 'light' }, []],
  update: (s) => [s, []],
  view: ({ state }) => [
    div({}, [text(state.at('user').at('profile').at('address').at('city'))]),
    span({ title: state.map((s) => s.user.profile.address.zip) }, []),
    div({}, [text(state.at('theme'))]),
  ],
})
`

/** Runtime helpers that take a dependency-path array literal (positionally or as
 * a `deps:` property) in the transform's output. */
const DEPS_TAKING_HELPERS = new Set([
  'signalText',
  'react',
  'signalEach',
  'signalEachDirect',
  'eachDirect',
  'signalShow',
  'signalBranch',
])

/** Every dependency-path string literal the transform emitted, deduped + sorted.
 * Read off the emitted AST rather than the source text so the assertion tracks
 * what the runtime is actually handed. */
function emittedDeps(source: string): string[] {
  const out = transformSignalComponentSource(source, { fileName: 'in.ts' })
  const sf = ts.createSourceFile('out.ts', out, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const paths = new Set<string>()
  const take = (arr: ts.Expression | undefined): void => {
    if (!arr || !ts.isArrayLiteralExpression(arr)) return
    if (!arr.elements.every(ts.isStringLiteral)) return
    for (const el of arr.elements) paths.add((el as ts.StringLiteral).text)
  }
  const walk = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      DEPS_TAKING_HELPERS.has(n.expression.text)
    ) {
      for (const a of n.arguments) take(a)
    }
    if (ts.isPropertyAssignment(n) && n.name.getText(sf) === 'deps') take(n.initializer)
    n.forEachChild(walk)
  }
  walk(sf)
  return [...paths].sort()
}

describe('collectSignalDeps — depth', () => {
  it('reports a 4-level access at full depth (no depth-2 truncation)', () => {
    const { paths } = collectSignalDeps(FOUR_LEVEL, { fileName: 'in.ts' })
    expect(paths).toEqual(['theme', 'user.profile.address.city', 'user.profile.address.zip'])
  })

  it('reports arbitrarily deep chains — there is no ceiling', () => {
    const src = `
      import { component, text } from '@llui/dom'
      type State = { a: { b: { c: { d: { e: { f: string } } } } } }
      export const C = component<State, { type: 'noop' }>({
        name: 'C',
        init: () => [{ a: { b: { c: { d: { e: { f: '' } } } } } }, []],
        update: (s) => [s, []],
        view: ({ state }) => [text(state.map((s) => s.a.b.c.d.e.f))],
      })
    `
    expect(collectSignalDeps(src, { fileName: 'in.ts' }).paths).toEqual(['a.b.c.d.e.f'])
  })

  it('a truncated report would be a STRICT prefix — the gate is exact equality', () => {
    // Guards the guard: assert the pre-#92 answer is not what we return.
    const { paths } = collectSignalDeps(FOUR_LEVEL, { fileName: 'in.ts' })
    expect(paths).not.toContain('user.profile')
    expect(paths.every((p) => p.split('.').length <= 2)).toBe(false)
  })
})

describe('collectSignalDeps — parity with the transform', () => {
  it('reports exactly the paths the transform emits into the deps arrays', () => {
    expect(collectSignalDeps(FOUR_LEVEL, { fileName: 'in.ts' }).paths).toEqual(
      emittedDeps(FOUR_LEVEL),
    )
  })
})

describe('collectSignalDeps — coarsening', () => {
  it('flags a whole-state read instead of listing it as a path', () => {
    const src = `
      import { component, text } from '@llui/dom'
      type State = { a: number }
      export const C = component<State, { type: 'noop' }>({
        name: 'C',
        init: () => [{ a: 0 }, []],
        update: (s) => [s, []],
        view: ({ state }) => [text(state.map((s) => JSON.stringify(s)))],
      })
    `
    const result = collectSignalDeps(src, { fileName: 'in.ts' })
    expect(result.wholeState).toBe(true)
    expect(result.paths).toEqual([])
  })

  it('a `.peek()` read is not a dependency', () => {
    const src = `
      import { component, button, text } from '@llui/dom'
      type State = { a: number; b: number }
      export const C = component<State, { type: 'noop' }>({
        name: 'C',
        init: () => [{ a: 0, b: 0 }, []],
        update: (s) => [s, []],
        view: ({ state, send }) => [
          button({ onClick: () => send({ type: 'noop', v: state.at('b').peek() }) }, [
            text(state.at('a')),
          ]),
        ],
      })
    `
    const result = collectSignalDeps(src, { fileName: 'in.ts' })
    expect(result.paths).toEqual(['a'])
    expect(result.wholeState).toBe(false)
  })
})

describe('collectSignalDeps — scope', () => {
  it('counts the signal component views it analyzed', () => {
    expect(collectSignalDeps(FOUR_LEVEL, { fileName: 'in.ts' }).views).toBe(1)
  })

  it('reports zero views for a file with no signal component', () => {
    const result = collectSignalDeps('export const x = 1', { fileName: 'in.ts' })
    expect(result.views).toBe(0)
    expect(result.paths).toEqual([])
  })

  it('honours a renamed state binding (`view: ({ state: st }) => …`)', () => {
    const src = `
      import { component, text } from '@llui/dom'
      type State = { a: { b: string } }
      export const C = component<State, { type: 'noop' }>({
        name: 'C',
        init: () => [{ a: { b: '' } }, []],
        update: (s) => [s, []],
        view: ({ state: st }) => [text(st.at('a').at('b'))],
      })
    `
    expect(collectSignalDeps(src, { fileName: 'in.ts' }).paths).toEqual(['a.b'])
  })

  it('collects each component in a multi-component file', () => {
    const src = `
      import { component, text } from '@llui/dom'
      type A = { one: { deep: string } }
      type B = { two: { deep: string } }
      export const CA = component<A, { type: 'noop' }>({
        name: 'CA',
        init: () => [{ one: { deep: '' } }, []],
        update: (s) => [s, []],
        view: ({ state }) => [text(state.at('one').at('deep'))],
      })
      export const CB = component<B, { type: 'noop' }>({
        name: 'CB',
        init: () => [{ two: { deep: '' } }, []],
        update: (s) => [s, []],
        view: ({ state }) => [text(state.at('two').at('deep'))],
      })
    `
    const result = collectSignalDeps(src, { fileName: 'in.ts' })
    expect(result.views).toBe(2)
    expect(result.paths).toEqual(['one.deep', 'two.deep'])
  })

  it('roots row reads at the list it iterates, and keeps component reads exact', () => {
    const src = `
      import { component, each, li, text, ul } from '@llui/dom'
      type State = { rows: { id: string; label: string }[]; ui: { sel: { id: string } } }
      export const C = component<State, { type: 'noop' }>({
        name: 'C',
        init: () => [{ rows: [], ui: { sel: { id: '' } } }, []],
        update: (s) => [s, []],
        view: ({ state }) => [
          ul({}, [
            each(
              state.at('rows'),
              (r) => r.id,
              (row) => [li({}, [text(row.at('label')), text(state.at('ui').at('sel').at('id'))])],
            ),
          ]),
        ],
      })
    `
    expect(collectSignalDeps(src, { fileName: 'in.ts' }).paths).toEqual(['rows', 'ui.sel.id'])
  })
})

/**
 * A dependency walker carries a NAME through a subtree, and both of the defects
 * below are that name matching something it does not denote. They are the same
 * failure #92 exists to remove — a confident answer that is not true — so they
 * are pinned at the shape level, not just at the file that caught them.
 */
describe('collectSignalDeps — an identifier is only a root where it is READ', () => {
  // Every case here yields a whole-state read (`opaque: true`) if the walk
  // root-matches identifiers in NAME position. `paths` stays complete throughout;
  // the bug was purely an invented extra dependency.
  const cases: Array<[string, string]> = [
    [
      'object-literal key — the `connect`/`overlay` wiring CLAUDE.md documents',
      `dialogConnect({ state: state.at('dialog'), send })`,
    ],
    ['binding propertyName', `foreign({ mount: ({ el, state: sig }) => sig })`],
    ['member access on another object', `plain(opts.state)`],
    ['a shorthand-bound local that is not the root', `plain(({ state: inner }) => inner)`],
  ]
  for (const [label, slot] of cases) {
    it(`does not treat a ${label} as a whole-state read`, () => {
      const src = `
        import { component, div, text } from '@llui/dom'
        type State = { a: { b: string }; dialog: { open: boolean } }
        export const C = component<State, { type: 'noop' }>({
          name: 'C',
          init: () => [{ a: { b: '' }, dialog: { open: false } }, []],
          update: (s) => [s, []],
          view: ({ state, send }) => [div({}, [text(state.at('a').at('b'))]), ${slot}],
        })
      `
      const result = collectSignalDeps(src, { fileName: 'in.ts' })
      expect(result.wholeState).toBe(false)
      expect(result.paths).toContain('a.b')
    })
  }

  it('still counts a shorthand `{ state }` in an object LITERAL as a real read', () => {
    // The one identifier in "name position" that IS a value reference. Handing the
    // whole handle to a helper is a genuine whole-state dependency.
    const src = `
      import { component, foreign } from '@llui/dom'
      type State = { a: number }
      export const C = component<State, { type: 'noop' }>({
        name: 'C',
        init: () => [{ a: 0 }, []],
        update: (s) => [s, []],
        view: ({ state }) => [foreign({ state })],
      })
    `
    expect(collectSignalDeps(src, { fileName: 'in.ts' }).wholeState).toBe(true)
  })

  it('counts a declaration site as a declaration, not a read', () => {
    const src = `
      import { component, text } from '@llui/dom'
      type State = { a: number }
      export const C = component<State, { type: 'noop' }>({
        name: 'C',
        init: () => [{ a: 0 }, []],
        update: (s) => [s, []],
        view: ({ state }) => [text(state.at('a'))],
      })
    `
    // `({ state })` in the bag pattern and `state.at` — one declaration, one read.
    expect(collectSignalDeps(src, { fileName: 'in.ts' })).toEqual({
      paths: ['a'],
      wholeState: false,
      views: 1,
    })
  })
})

describe('collectSignalDeps — rooting is scope-aware', () => {
  it('drops the root inside a callback that rebinds its name', () => {
    // The row arm's `state` is a plain ROW handle. Reading roots through it
    // invents a top-level `label` that does not exist in State, and flags a
    // whole-state read that never happened.
    const src = `
      import { component, each, li, text, ul } from '@llui/dom'
      type State = { rows: { id: string; label: string }[] }
      export const C = component<State, { type: 'noop' }>({
        name: 'C',
        init: () => [{ rows: [] }, []],
        update: (s) => [s, []],
        view: ({ state }) => [
          ul({}, [
            each(state.at('rows'), (r) => r.id, (state) => [li({}, [text(state.at('label'))])]),
          ]),
        ],
      })
    `
    expect(collectSignalDeps(src, { fileName: 'in.ts' })).toEqual({
      paths: ['rows'],
      wholeState: false,
      views: 1,
    })
  })

  it('drops the root inside a block that rebinds its name', () => {
    const src = `
      import { component, text } from '@llui/dom'
      type State = { a: number }
      export const C = component<State, { type: 'noop' }>({
        name: 'C',
        init: () => [{ a: 0 }, []],
        update: (s) => [s, []],
        view: ({ state }) => [
          text(state.at('a')),
          derive(() => {
            const state = somethingElse()
            return state.at('phantom')
          }),
        ],
      })
    `
    expect(collectSignalDeps(src, { fileName: 'in.ts' }).paths).toEqual(['a'])
  })

  it('restores the root after the shadowing scope ends', () => {
    const src = `
      import { component, each, li, text, ul } from '@llui/dom'
      type State = { rows: { id: string }[]; after: { deep: string } }
      export const C = component<State, { type: 'noop' }>({
        name: 'C',
        init: () => [{ rows: [], after: { deep: '' } }, []],
        update: (s) => [s, []],
        view: ({ state }) => [
          ul({}, [each(state.at('rows'), (r) => r.id, (state) => [li({}, [text(state.at('x'))])])]),
          text(state.at('after').at('deep')),
        ],
      })
    `
    expect(collectSignalDeps(src, { fileName: 'in.ts' }).paths).toEqual(['after.deep', 'rows'])
  })

  // ── issue #153 — a function/class EXPRESSION rebinds its own name ────────
  // The root prune goes through `scopeIntroduces`, the repo's ONE shadowing
  // predicate, precisely so a case added there lands in every driver at once.
  // A `function state(…)` expression binds `state` over its own body, so the
  // reads inside it are NOT reads of the component's state signal — carrying
  // the root in invented a top-level `phantom` that does not exist in State and
  // flagged a whole-state read that never happened, which is the exact
  // confident-wrong-answer class #92 exists to remove.
  it('drops the root inside a NAMED FUNCTION EXPRESSION that rebinds its name', () => {
    const src = `
      import { component, div, text } from '@llui/dom'
      type State = { a: string }
      export const C = component<State, { type: 'noop' }>({
        name: 'C',
        init: () => [{ a: '' }, []],
        update: (s) => [s, []],
        view: ({ state }) => [
          text(state.at('a')),
          div({}, [
            (function state(n: number): unknown {
              return n > 0 ? state(n - 1) : state.at('phantom')
            })(1),
          ]),
        ],
      })
    `
    expect(collectSignalDeps(src, { fileName: 'in.ts' })).toEqual({
      paths: ['a'],
      wholeState: false,
      views: 1,
    })
  })

  it('drops the root inside a NAMED CLASS EXPRESSION that rebinds its name', () => {
    const src = `
      import { component, div, text } from '@llui/dom'
      type State = { a: string }
      export const C = component<State, { type: 'noop' }>({
        name: 'C',
        init: () => [{ a: '' }, []],
        update: (s) => [s, []],
        view: ({ state }) => [
          text(state.at('a')),
          div({}, [new (class state { m() { return state.at('phantom') } })() as unknown as never]),
        ],
      })
    `
    expect(collectSignalDeps(src, { fileName: 'in.ts' })).toEqual({
      paths: ['a'],
      wholeState: false,
      views: 1,
    })
  })

  it('keeps the root inside a function expression named something ELSE (control)', () => {
    // The prune is keyed on the NAME. A helper named `render` rebinds nothing,
    // so the reads inside it are still component-state reads.
    const src = `
      import { component, div, text } from '@llui/dom'
      type State = { a: string; b: string }
      export const C = component<State, { type: 'noop' }>({
        name: 'C',
        init: () => [{ a: '', b: '' }, []],
        update: (s) => [s, []],
        view: ({ state }) => [
          text(state.at('a')),
          div({}, [(function render(): unknown { return state.at('b') })()]),
        ],
      })
    `
    expect(collectSignalDeps(src, { fileName: 'in.ts' }).paths).toEqual(['a', 'b'])
  })
})

describe('collectSignalDeps — ScriptKind', () => {
  it('parses a .ts generic arrow as TS, not TSX', () => {
    // `<T>(x: T)` reads as an unclosed JSX element under TSX; the file would parse
    // to garbage and report `views: 0` with no error at all. `fileName` is required
    // precisely so no caller can fall into a default that misparses.
    const src = `
      import { component, text } from '@llui/dom'
      const identity = <T>(x: T): T => x
      type State = { a: { b: string } }
      export const C = component<State, { type: 'noop' }>({
        name: 'C',
        init: () => [{ a: { b: '' } }, []],
        update: (s) => [s, []],
        view: ({ state }) => [text(state.at('a').at('b'))],
      })
    `
    const asTs = collectSignalDeps(src, { fileName: 'in.ts' })
    expect(asTs.views).toBe(1)
    expect(asTs.paths).toEqual(['a.b'])
  })
})
