import { describe, it, expect } from 'vitest'
import { lintSignalSource, transformSignalComponentSource } from '../parsed.js'

// `constant(v)` (`@llui/dom`) is a signal handle whose value never changes — the
// `state` half of the stateless-widget pair that lets a widget whose values are
// FIXED for the life of the node call `connect(state, send, opts)` without
// hoisting a state slice (#235's "Note on the state model").
//
// The compiler has no lowering for it and needs none: `constant(...)` carries no
// dependency path, so there is nothing for the dep analyzer to extract and
// nothing a mask could gate. What it MUST do is leave it alone — reject nothing,
// and lower the siblings around it exactly as before. Both halves are pinned
// here because a future widening of `isSignalExpr` (which already recognizes
// `derived(` by bare identifier name) is the change that would break either one,
// and neither failure has a runtime symptom the dom tests could catch: a lint
// false positive fails a consumer's build, and a bad lowering emits a producer
// that reads `constant` out of the binding state.

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

// The GAP — issue #238 — pinned as behaviour rather than left as prose, so that
// whoever finds these two green "does NOT fire" tests and wants to delete them
// can find out why they exist. `isSignalExpr` (`extract-deps.ts`) recognizes a
// signal by ROOT IDENTIFIER — `state`, an `.at`/`.map`/`.peek` chain off one, or a
// bare `derived(` call. A `constant(...)` matches none of those, so the two rules
// that exist to catch a signal used as a VALUE do not see it. All four renders
// below are MEASURED, not predicted:
//
//   text(constant(1) + 1)             -> "[object Object]1"
//   text(constant(true) ? a : b)      -> always the truthy arm (a handle is an object)
//   text(constant('') || 'FALLBACK')  -> ""      <- the nastiest: the fallback is
//        silently swallowed (the handle is truthy, so `||` yields the HANDLE, which
//        then renders its own empty value) and there is no `[object Object]` tell.
//        It reads as "the data was empty", not as "you made a type error".
//   div({ 'data-v': constant(false) ? 'YES' : 'NO' })  -> data-v="YES"   <- and the
//        gap is not confined to text slots; an attribute slot takes it identically.
//   text(constant('x').peek())        -> a frozen read; harmless, but unflagged
//
// TypeScript covers exactly two of those directions on its own (`Signal<number> +
// 1` is TS2365, `=== 0` is TS2367). Template / ternary / logical / unary are
// covered by NOTHING.
//
// Measured fix, and why it is NOT applied here: adding `|| e.expression.text ===
// 'constant'` to the `derived(` branch of `isSignalExpr` makes BOTH rules fire on
// every line above, and leaves the transform output byte-identical across the
// whole compiler suite. It is one line, and it is still not free — that branch
// matches a BARE IDENTIFIER with no import provenance, so a consumer's own
// `constant()` helper used in an operator would get a build-stopping false
// positive on code that did nothing wrong. Per the repo rule ("when the two
// directions disagree about a shape, BAIL"), widening it wants the provenance
// check (`HelperBindings`) that the `derived(` branch also lacks — #238, with its
// own evidence.
describe('constant() and the value-position lint rules — the #238 gap', () => {
  const constView = (slot: string): string =>
    [
      "import { component, div, text, constant } from '@llui/dom'",
      "export const A = component({ name:'A', init: () => ({ n: 0 }), update: (s: { n: number }) => s,",
      '  view: () => [div([text(' + slot + ')])] })',
    ].join('\n')

  /** The same view with the expression in an ATTRIBUTE slot rather than a text slot. */
  const constAttrView = (slot: string): string =>
    [
      "import { component, div, constant } from '@llui/dom'",
      "export const A = component({ name:'A', init: () => ({ n: 0 }), update: (s: { n: number }) => s,",
      "  view: () => [div({ 'data-v': " + slot + ' }, [])] })',
    ].join('\n')

  const stateView = (slot: string): string =>
    [
      "import { component, div, text } from '@llui/dom'",
      "export const A = component({ name:'A', init: () => ({ n: 0 }), update: (s: { n: number }) => s,",
      '  view: ({ state }) => [div([text(' + slot + ')])] })',
    ].join('\n')

  it('does NOT fire operator-on-signal on a constant in a ternary', () => {
    expect(lintSignalSource(constView('constant(true) ? "y" : "n"'), 'A.tsx')).toEqual([])
  })

  it('does NOT fire operator-on-signal on a constant in a `||` — the fallback is swallowed', () => {
    // Renders "" (measured). The handle is truthy, so `||` yields the HANDLE and
    // 'FALLBACK' is unreachable; nothing in the output says so.
    expect(lintSignalSource(constView("constant('') || 'FALLBACK'"), 'A.tsx')).toEqual([])
  })

  it('does NOT fire in an ATTRIBUTE slot either — the gap is not text-slot-only', () => {
    // Renders data-v="YES" (measured).
    expect(lintSignalSource(constAttrView("constant(false) ? 'YES' : 'NO'"), 'A.tsx')).toEqual([])
  })

  it('does NOT fire peek-in-slot on a constant .peek() in a slot', () => {
    expect(lintSignalSource(constView("constant('x').peek()"), 'A.tsx')).toEqual([])
  })

  it('fires on the state-rooted equivalents — the rules themselves work', () => {
    expect(
      lintSignalSource(stateView('state.at("n") ? "y" : "n"'), 'A.tsx').map((d) => d.rule),
    ).toEqual(['operator-on-signal'])
    expect(
      lintSignalSource(stateView('state.at("n") || "FALLBACK"'), 'A.tsx').map((d) => d.rule),
    ).toEqual(['operator-on-signal'])
    expect(lintSignalSource(stateView('state.at("n").peek()'), 'A.tsx').map((d) => d.rule)).toEqual(
      ['peek-in-slot'],
    )
  })
})
