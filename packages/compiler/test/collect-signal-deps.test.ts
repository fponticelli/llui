import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { collectSignalDeps } from '../src/signals/collect-signal-deps'
import { transformSignalComponentSource } from '../src/signals/transform-component'

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
    expect(collectSignalDeps(src).paths).toEqual(['a.b.c.d.e.f'])
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
    const result = collectSignalDeps(src)
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
    const result = collectSignalDeps(src)
    expect(result.paths).toEqual(['a'])
    expect(result.wholeState).toBe(false)
  })
})

describe('collectSignalDeps — scope', () => {
  it('counts the signal component views it analyzed', () => {
    expect(collectSignalDeps(FOUR_LEVEL, { fileName: 'in.ts' }).views).toBe(1)
  })

  it('reports zero views for a file with no signal component', () => {
    const result = collectSignalDeps(`export const x = 1`)
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
    expect(collectSignalDeps(src).paths).toEqual(['a.b'])
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
    const result = collectSignalDeps(src)
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
    expect(collectSignalDeps(src).paths).toEqual(['rows', 'ui.sel.id'])
  })
})
