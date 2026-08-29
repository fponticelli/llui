import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { lintSignalSource, transformSignalComponentSource } from '../parsed.js'
import { parseModule } from '../../src/parse.js'
import { collectSignalDeps } from '../../src/signals/collect-signal-deps.js'

/** A REAL path, so a relative import in a fixture resolves the way it would in a
 * consumer's tree (the provenance tests below turn on exactly that). */
const THIS_FILE = fileURLToPath(import.meta.url)

// `constant(v)` (`@llui/dom`) is a signal handle whose value never changes — the
// `state` half of the stateless-widget pair that lets a widget whose values are
// FIXED for the life of the node call `connect(state, send, opts)` without
// hoisting a state slice (#235's "Note on the state model").
//
// The compiler has no lowering for it and needs none: `constant(...)` carries no
// dependency path, so there is nothing for the dep analyzer to extract and
// nothing a mask could gate. What it MUST do is leave it alone — reject nothing
// on VALID usage, and lower the siblings around it exactly as before. Both halves
// are pinned here because #238's widening of `isSignalExpr` (which now recognizes
// `constant(` as well as `derived(`) is the change that would break either one,
// and neither failure has a runtime symptom the dom tests could catch: a lint
// false positive fails a consumer's build, and a bad lowering emits a producer
// that reads `constant` out of the binding state. They are green ACROSS that
// widening — the DIRECT-view lowering is byte-identical before and after, which
// is what makes the widening's one real output change (the `each` DIRECT tier,
// pinned in the next describe) a bug fix rather than a side effect.

const VIEW = `
import { component, div, span, text, each, constant, noSend } from '@llui/dom'
import { meter } from '@llui/components'

interface S { tick: number }
type M = { type: 'tick' }

export const App = component<S, M>({
  name: 'App',
  init: () => ({ tick: 0 }),
  update: (s: S) => ({ tick: s.tick + 1 }),
  view: ({ state }) => {
    const p = meter.connect(constant({ value: 42, min: 0, max: 100 }), noSend, {})
    return [
      div({ ...p.root }, [text(constant('Sodium'))]),
      span({ 'data-id': constant('LAB-42') }, [text(state.at('tick').map(String))]),
      each(constant(['a', 'b']), { key: (i: string) => i, render: (item) => [span([text(item)])] }),
    ]
  },
})
`

describe('constant() in a direct view', () => {
  it('produces no lint diagnostics', () => {
    expect(lintSignalSource(VIEW, 'App.tsx')).toEqual([])
  })

  it('is left verbatim for the runtime authoring path, while its siblings still lower', () => {
    const out = transformSignalComponentSource(VIEW, { fileName: 'App.tsx' })
    // Untouched: the value has no path, so there is nothing to lower into a
    // producer. It reaches the runtime authoring helpers, which consume the
    // handle (`text`/`each` branch on `isSignalHandle`).
    expect(out).toContain("text(constant('Sodium'))")
    expect(out).toContain("constant('LAB-42')")
    expect(out).toContain("each(constant(['a', 'b'])")
    // Unchanged around it: the state-rooted sibling still lowers to a masked
    // binding, so the constant did not suppress the transform for the view.
    expect(out).toContain("signalText((s) => (String)(s.tick), ['tick'])")
    expect(out).toContain('el("div"')
  })
})

// A SECOND bug #238's widening closes, and the only one with a wrong RENDER out of
// the compiler rather than a missing diagnostic.
//
// `lowerHelperEach`'s DIRECT tier builds the row imperatively — a cloned skeleton
// plus `applyAttr` / `node.data = String(…)` for everything it decided was STATIC.
// A `constant(...)` was not a signal expression to `isSignalExpr`, so it fell in
// that bucket and the emitted row read (verbatim, from the HEAD transform of
// `packages/dom/test/signals/constant.test.ts`):
//
//   applyAttr(_r0, "data-unit", constant('mmol/L'))
//   _c2.data = String(constant(' · fixed'))
//
// Both were EVALUATED against the real runtime, not reasoned about:
//   String(constant(' · fixed'))  -> "[object Object]"
//   the attribute                 -> <li data-unit="[object Object]"></li>
// `constant` returns a plain handle object with no `toString`, so a direct-tier
// row that used one rendered `[object Object]` in every slot it appeared in —
// clean build, clean type-check, and `@llui/dom`'s own `constant` test file is
// exactly this shape (it passes because that suite never runs the compiler).
//
// Recognizing the constant makes the direct tier decline (bail
// `each-direct: row-prop-unlowerable`, an existing reason token) and the row
// lowers as an ARM, where the handle reaches `el`/`text` — the authoring helpers
// that consume handles. Slower than the clone skeleton, correct instead of wrong.
describe('constant() in an `each` row — the direct tier must not stringify the handle', () => {
  const ROW_HELPER = `
import { each, li, text, constant } from '@llui/dom'
import type { Renderable, Signal } from '@llui/dom'

export function rows(items: Signal<string[]>): Renderable {
  return [
    each(items, {
      key: (it: string) => it,
      render: (item) => [
        li({ 'data-unit': constant('mmol/L') }, [text(item), text(constant(' · fixed'))]),
      ],
    }),
  ]
}
`

  it('never emits String(constant(…)) or applyAttr(…, constant(…))', () => {
    const out = transformSignalComponentSource(ROW_HELPER, { fileName: 'rows.tsx' })
    expect(out).not.toContain('String(constant(')
    expect(out).not.toMatch(/applyAttr\([^)]*constant\(/)
  })

  it('hands the constant to helpers that CONSUME a handle, in both slot kinds', () => {
    const out = transformSignalComponentSource(ROW_HELPER, { fileName: 'rows.tsx' })
    expect(out).toContain("text(constant(' · fixed'))")
    expect(out).toContain("'data-unit': constant('mmol/L')")
    // The row still compiles — it drops one tier, it does not fall back to the
    // uncompiled authoring `each`.
    expect(out).toContain('eachArm(')
  })

  it('reports the tier drop through the existing bail channel', () => {
    const bails: { kind: string; reason: string }[] = []
    transformSignalComponentSource(ROW_HELPER, {
      fileName: 'rows.tsx',
      onLowerBail: (b) => bails.push({ kind: b.kind, reason: b.reason }),
    })
    expect(bails).toEqual([{ kind: 'each-direct', reason: 'row-prop-unlowerable' }])
  })

  it("does NOT drop the tier for a consumer's own constant() — provenance, in the LOWERING half", () => {
    // Same row, but `constant` is the consumer's plain string helper. It is not a
    // signal, so the DIRECT tier must still engage and `applyAttr` the string —
    // which is correct code here. Without provenance in the transform's own
    // recognition path, this row would silently lose its fast tier.
    const out = transformSignalComponentSource(
      [
        "import { each, li, text } from '@llui/dom'",
        "import type { Renderable, Signal } from '@llui/dom'",
        'const constant = (v: string): string => v',
        'export function rows(items: Signal<string[]>): Renderable {',
        '  return [each(items, { key: (it: string) => it,',
        "    render: (item) => [li({ 'data-unit': constant('mmol/L') }, [text(item)])] })]",
        '}',
      ].join('\n'),
      { fileName: 'rows.tsx' },
    )
    expect(out).toContain('eachDirect(')
    expect(out).not.toContain('eachArm(')
    expect(out).toContain('applyAttr(')
  })
})

// The LOWERING half of provenance, on `derived`, through the spelling that
// separates it cleanly from a bare-name test: a NAMESPACE import. `dom.derived(…)`
// has no bare callee identifier at all, so a name-matching branch cannot see it
// while `HelperBindings.resolveCall` resolves it exactly.
//
// Both halves of `signalToProduce` are pinned, because they fail DIFFERENTLY and
// only one of the two failures is loud:
//   - `valueSrc` name-matching  -> the slot is never lowered (a lost optimization)
//   - `analyzeSignalExpr` name-matching -> the slot IS lowered with `deps: []`,
//     i.e. a MISSED DEPENDENCY. Per the repo's standing invariant that is the
//     unacceptable direction: the binding's mask can never be dirty, so the text
//     is correct at mount and permanently stale afterwards. Both numbers below are
//     measured against the mutation, not predicted.
describe('#238 — provenance in the lowering half (namespace `derived`)', () => {
  const NS_VIEW = [
    "import { component, div, text } from '@llui/dom'",
    "import * as dom from '@llui/dom'",
    'interface S { a: number }',
    "type M = { type: 'noop' }",
    'export const App = component<S, M>({',
    "  name: 'App',",
    '  init: () => ({ a: 1 }),',
    '  update: (s: S) => s,',
    "  view: ({ state }) => [div([text(dom.derived([state.at('a')], (a: number) => String(a)))])],",
    '})',
  ].join('\n')

  it('lowers a namespace-imported derived, WITH its dependency path', () => {
    const out = transformSignalComponentSource(NS_VIEW, { fileName: 'App.tsx' })
    expect(out).toContain("signalText((s) => ((a: number) => String(a))(s.a), ['a'])")
    expect(out).not.toContain('text(dom.derived(')
  })

  it('reports that path from the file-level collector too', () => {
    // The other framing of the SAME analyzer (#92): one analysis, two drivers.
    expect(collectSignalDeps(parseModule('App.tsx', NS_VIEW))).toEqual({
      paths: ['a'],
      wholeState: false,
      views: 1,
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// #238 — a signal in a VALUE position, and WHICH `constant`/`derived` is meant.
//
// `isSignalExpr` used to recognize a factory call by ROOT IDENTIFIER: a bare
// `derived(` matched, and `constant(` — added later, for the T1 stateless-widget
// tier — matched nothing. That one test was wrong in BOTH directions at once.
//
// Direction A (a MISSED lint, closed by the first describe below). All four
// renders are MEASURED, not predicted, and none of them raises a TypeScript
// error:
//
//   text(constant(true) ? a : b)      -> always the truthy arm (a handle is an object)
//   text(`${constant(1)}`)            -> "[object Object]"
//   text(constant('') || 'FALLBACK')  -> ""      <- the nastiest: the fallback is
//        silently swallowed (the handle is truthy, so `||` yields the HANDLE, which
//        then renders its own empty value) and there is no `[object Object]` tell.
//        It reads as "the data was empty", not as "you made a type error".
//   div({ 'data-v': constant(false) ? 'YES' : 'NO' })  -> data-v="YES"   <- and the
//        gap is not confined to text slots; an attribute slot takes it identically.
//
// TypeScript covers exactly two directions on its own (`Signal<number> + 1` is
// TS2365, `=== 0` is TS2367). Template / ternary / logical / unary are covered by
// NOTHING, which is why the compiler has to be the one to say it.
//
// Direction B (a FALSE POSITIVE, closed by the second describe below). The bare
// name test matched a consumer's OWN `derived()` too — a build-stopping error on
// code that did nothing wrong. It is not hypothetical: `derived` is an ordinary
// English word, and this repo's own `test/fixtures/helper-bindings-unrelated.js`
// exports one. Provenance (`HelperBindings`) answers both directions with one
// fact, and it FAILS CLOSED: an unresolvable / cyclic / type-only import, a
// module-scope declaration, or a lexical shadow is SILENT, never a report.
// ─────────────────────────────────────────────────────────────────────────────

/** `view: () => [div([text(<slot>)])]`, with `<imports>` on line 1. */
const textSlotView = (imports: string, slot: string): string =>
  [
    imports,
    "export const A = component({ name:'A', init: () => ({ n: 0 }), update: (s: { n: number }) => s,",
    '  view: () => [div([text(' + slot + ')])] })',
  ].join('\n')

/** The same view with the expression in an ATTRIBUTE slot rather than a text slot. */
const attrSlotView = (imports: string, slot: string): string =>
  [
    imports,
    "export const A = component({ name:'A', init: () => ({ n: 0 }), update: (s: { n: number }) => s,",
    "  view: () => [div({ 'data-v': " + slot + ' }, [])] })',
  ].join('\n')

const DOM_IMPORT = "import { component, div, text, constant, derived } from '@llui/dom'"

const rules = (src: string, fileName = 'A.tsx'): string[] =>
  lintSignalSource(src, fileName).map((d) => d.rule)

describe('#238 — value-position rules see a @llui/dom constant()/derived()', () => {
  it('reports operator-on-signal on a constant in a ternary condition', () => {
    expect(rules(textSlotView(DOM_IMPORT, "constant(false) ? 'YES' : 'NO'"))).toEqual([
      'operator-on-signal',
    ])
  })
  it('reports operator-on-signal on a constant in a template literal', () => {
    expect(rules(textSlotView(DOM_IMPORT, '`${constant(1)}`'))).toEqual(['operator-on-signal'])
  })
  it('reports operator-on-signal on a constant in a `||` — the swallowed fallback', () => {
    expect(rules(textSlotView(DOM_IMPORT, "constant('') || 'FALLBACK'"))).toEqual([
      'operator-on-signal',
    ])
  })
  it('reports in an ATTRIBUTE slot too — the gap was not text-slot-only', () => {
    expect(rules(attrSlotView(DOM_IMPORT, "constant(false) ? 'YES' : 'NO'"))).toEqual([
      'operator-on-signal',
    ])
  })
  it('reports operator-on-signal on a constant under a unary `!`', () => {
    // Two distinct operand positions here; only the `!` holds the handle (the
    // ternary condition holds the boolean the `!` produced), so exactly one report.
    expect(rules(textSlotView(DOM_IMPORT, "!constant(0) ? 'y' : 'n'"))).toEqual([
      'operator-on-signal',
    ])
  })
  it('reports peek-in-slot on a constant .peek() in a slot', () => {
    expect(rules(textSlotView(DOM_IMPORT, "constant('x').peek()"))).toEqual(['peek-in-slot'])
  })
  it('reports on a constant SLICE — `.at()` on a constant is legal and still a signal', () => {
    expect(rules(textSlotView(DOM_IMPORT, "constant({ v: 1 }).at('v') ? 'y' : 'n'"))).toEqual([
      'operator-on-signal',
    ])
  })

  // The same shapes for `derived` — NON-REGRESSION: these were already reported
  // by the bare-name test, and threading provenance must not switch them off.
  it('still reports the derived equivalents', () => {
    const d = 'derived([constant(1)], (a: number) => a)'
    expect(rules(textSlotView(DOM_IMPORT, `${d} ? 'y' : 'n'`))).toEqual(['operator-on-signal'])
    expect(rules(textSlotView(DOM_IMPORT, '`${' + d + '}`'))).toEqual(['operator-on-signal'])
    expect(rules(textSlotView(DOM_IMPORT, `${d} || 'FALLBACK'`))).toEqual(['operator-on-signal'])
    expect(rules(attrSlotView(DOM_IMPORT, `${d} ? 'y' : 'n'`))).toEqual(['operator-on-signal'])
    expect(rules(textSlotView(DOM_IMPORT, `${d}.peek()`))).toEqual(['peek-in-slot'])
  })

  // Provenance is about the IMPORT, not the spelling — in both spellings a
  // consumer can legitimately use to reach the framework helper.
  it('follows an ALIASED @llui/dom import', () => {
    const imports = "import { component, div, text, constant as fixed } from '@llui/dom'"
    expect(rules(textSlotView(imports, "fixed(false) ? 'y' : 'n'"))).toEqual(['operator-on-signal'])
  })
  it('follows a NAMESPACE @llui/dom import', () => {
    const imports = [
      "import { component, div, text } from '@llui/dom'",
      "import * as dom from '@llui/dom'",
    ].join('\n')
    expect(rules(textSlotView(imports, "dom.constant(false) ? 'y' : 'n'"))).toEqual([
      'operator-on-signal',
    ])
    expect(
      rules(textSlotView(imports, "dom.derived([dom.constant(1)], (a: number) => a) ? 'y' : 'n'")),
    ).toEqual(['operator-on-signal'])
  })
})

describe("#238 — a consumer's OWN constant()/derived() is silent", () => {
  // Every case below is written in the SHAPE the rules fire on (a factory call in
  // a ternary condition / a `.peek()` in a slot), so a bare-name test reports it
  // and provenance is the only thing that can keep it quiet. If any of these ever
  // goes red, a real consumer's build broke on code that did nothing wrong.
  //
  // `derived` is the half that was ALREADY broken on main: the bare `derived(`
  // branch had no provenance check, so these three shapes were build errors.
  const CONSUMER_IMPORT = "import { component, div, text } from '@llui/dom'"

  it('stays silent on a module-scope `function constant/derived` declaration', () => {
    const imports = [
      CONSUMER_IMPORT,
      'function constant(v: unknown) { return v }',
      'function derived(v: unknown) { return v }',
    ].join('\n')
    expect(rules(textSlotView(imports, "constant(false) ? 'y' : 'n'"))).toEqual([])
    expect(rules(textSlotView(imports, "derived(false) ? 'y' : 'n'"))).toEqual([])
    expect(rules(attrSlotView(imports, "constant(false) ? 'YES' : 'NO'"))).toEqual([])
  })

  it('stays silent on a module-scope `const constant/derived` binding', () => {
    const imports = [
      CONSUMER_IMPORT,
      'const constant = (v: unknown) => v',
      'const derived = (v: unknown) => v',
    ].join('\n')
    expect(rules(textSlotView(imports, "constant('') || 'FALLBACK'"))).toEqual([])
    expect(rules(textSlotView(imports, "derived('') || 'FALLBACK'"))).toEqual([])
  })

  it('stays silent on an import from an UNRELATED module that exports the names', () => {
    // Resolves to a real file whose nearest package identity is not `@llui/dom`.
    const imports = [
      CONSUMER_IMPORT,
      "import { constant, derived } from '../fixtures/helper-bindings-unrelated.js'",
    ].join('\n')
    expect(rules(textSlotView(imports, "constant(false) ? 'y' : 'n'"), THIS_FILE)).toEqual([])
    expect(rules(textSlotView(imports, "derived(false) ? 'y' : 'n'"), THIS_FILE)).toEqual([])
    expect(rules(textSlotView(imports, "constant('x').peek()"), THIS_FILE)).toEqual([])
  })

  it('stays silent on an UNRESOLVABLE import — fail closed, no report', () => {
    const imports = [
      CONSUMER_IMPORT,
      "import { constant, derived } from './nowhere-at-all.js'",
    ].join('\n')
    expect(rules(textSlotView(imports, "constant(false) ? 'y' : 'n'"), THIS_FILE)).toEqual([])
    expect(rules(textSlotView(imports, "derived(false) ? 'y' : 'n'"), THIS_FILE)).toEqual([])
  })

  it('stays silent on a LEXICAL SHADOW of a real @llui/dom import', () => {
    // The import IS the framework's; a nearer binding of the same name is not.
    // `scopeIntroduces` (helper-bindings.ts) owns this — never re-derived here.
    const shadowed = [
      DOM_IMPORT,
      "export const A = component({ name:'A', init: () => ({ n: 0 }), update: (s: { n: number }) => s,",
      '  view: () => { const constant = (v: unknown) => v',
      "               return [div([text(constant(false) ? 'y' : 'n')])] } })",
    ].join('\n')
    expect(rules(shadowed)).toEqual([])
  })

  it('stays silent on a TYPE-ONLY @llui/dom import — it binds no value', () => {
    const imports = [CONSUMER_IMPORT, "import type { constant } from '@llui/dom'"].join('\n')
    expect(rules(textSlotView(imports, "constant(false) ? 'y' : 'n'"))).toEqual([])
  })

  it('and the positive control still fires from the same fixture shape', () => {
    // Guards against a vacuous suite: if `textSlotView` stopped producing a
    // lintable view at all, every negative above would pass for the wrong reason.
    expect(rules(textSlotView(DOM_IMPORT, "constant(false) ? 'y' : 'n'"))).toEqual([
      'operator-on-signal',
    ])
  })
})
