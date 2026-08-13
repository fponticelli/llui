// Drift gate: `@llui/compiler` mirrors this package's element-helper lists.
//
// The compiler intentionally has NO dependency on `@llui/dom` (that edge would
// make the workspace graph cyclic — `@llui/dom` dev-depends on the compiler for
// these very tests), so `ELEMENT_HELPERS` / `SVG_ELEMENT_HELPERS` are copied by
// hand over there. A helper added here and forgotten there silently escapes both
// view lowering and every lint rule keyed off those sets (`empty-props`,
// `no-node-construction-in-body`, `controlled-input`, `a11y`).
//
// THE GATE LIVES ON THIS SIDE ON PURPOSE. Turbo's `test` task takes
// `$TURBO_DEFAULT$` (in-package files) plus the shared vitest config as inputs,
// and `@llui/compiler` neither depends on nor builds from `@llui/dom`. So an
// equivalent test inside `packages/compiler` reads `authoring.ts` through a path
// that is neither a task input nor an upstream build output: editing
// `authoring.ts` does not invalidate `@llui/compiler#test`, and `pnpm turbo test`
// — the documented command — replays a CACHED pass over real drift. Here,
// `src/signals/authoring.ts` IS an input, so the gate cannot be cached past a
// change to the thing it guards. Verified by adding a helper and watching this
// fail under `pnpm turbo test --filter=@llui/dom`.
//
// The scrape is an AST walk, not a regex: `export const marquee =\n
// elementHelper('marquee')` is the same declaration to TypeScript and must be
// the same declaration to this gate.
//
// The source arrives through Vite's `?raw` rather than `node:fs`: this package
// ships a browser runtime and carries NO `@types/node`, and adding it just for a
// test would put Node globals into `tsc --noEmit` for all of `src/` — where their
// absence is load-bearing. `?raw` also makes authoring.ts a genuine module
// dependency of this test, so Vitest's own watcher reruns it on edit.

import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { ELEMENT_HELPERS, SVG_ELEMENT_HELPERS, ALL_ELEMENT_HELPERS } from '@llui/compiler'
// `?raw` is typed by test/raw-import.d.ts (this package carries no vite/client).
import authoringSrc from '../../src/signals/authoring.ts?raw'

const sf = ts.createSourceFile(
  'authoring.ts',
  authoringSrc,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
)

/** Every `export const <name> = <factory>('<tag>')` in authoring.ts, as
 * name → tag. The NAME is what an author calls and what the compiler's
 * `HelperBindings` resolves to; the tag is the DOM element it builds. They
 * differ for `svgText` (the SVG `<text>` element, renamed to avoid colliding
 * with the `text()` node helper), which is exactly why the sets must hold
 * names, not tags. */
function helperExports(factory: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue
    if (!st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue
    for (const d of st.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || !d.initializer) continue
      const init = d.initializer
      if (!ts.isCallExpression(init) || !ts.isIdentifier(init.expression)) continue
      if (init.expression.text !== factory) continue
      const arg = init.arguments[0]
      if (!arg || !ts.isStringLiteralLike(arg)) continue
      out.set(d.name.text, arg.text)
    }
  }
  return out
}

const htmlHelpers = helperExports('elementHelper')
const svgHelpers = helperExports('svgHelper')

describe('@llui/compiler element-helper sets — parity with authoring.ts', () => {
  it('scrapes a plausible number of helpers (the walk actually found them)', () => {
    expect(htmlHelpers.size).toBeGreaterThan(40)
    expect(svgHelpers.size).toBeGreaterThan(5)
  })

  it('ELEMENT_HELPERS covers every `elementHelper(...)` export', () => {
    const missing = [...htmlHelpers.keys()].filter((h) => !ELEMENT_HELPERS.has(h))
    expect(missing).toEqual([])
  })

  it('SVG_ELEMENT_HELPERS matches every `svgHelper(...)` export exactly', () => {
    expect([...SVG_ELEMENT_HELPERS].sort()).toEqual([...svgHelpers.keys()].sort())
  })

  // Namespaced helpers must stay OUT of ELEMENT_HELPERS: the runtime builds them
  // with createElementNS, and the view transform lowers everything in that set to
  // `el(tag, …)` — a non-namespaced HTMLUnknownElement that renders nothing.
  it('ELEMENT_HELPERS excludes every namespaced helper', () => {
    const leaked = [...svgHelpers.keys()].filter((h) => ELEMENT_HELPERS.has(h))
    expect(leaked).toEqual([])
  })

  // The compiler set is a strict SUPERSET: these five are real HTML tags this
  // package has never exported a helper for. They are inert (a bare `dialog(…)`
  // resolves as a helper only when the name is unbound in the file, which is a
  // ReferenceError at runtime), but pinning them keeps the gate tight in BOTH
  // directions — a new stray entry fails here just like a missing one. Adding the
  // runtime helper is tracked separately; do that and this list shrinks.
  it('pins the known, inert extras the compiler carries beyond this package', () => {
    const extra = [...ELEMENT_HELPERS].filter((h) => !htmlHelpers.has(h)).sort()
    expect(extra).toEqual(['audio', 'b', 'dialog', 'i', 'video'])
  })

  it('holds CALLEE names, not tags — `svgText` builds `<text>`', () => {
    expect(svgHelpers.get('svgText')).toBe('text')
    expect(SVG_ELEMENT_HELPERS.has('svgText')).toBe(true)
    expect(SVG_ELEMENT_HELPERS.has('text')).toBe(false)
  })

  it('ALL_ELEMENT_HELPERS is the union of both sets', () => {
    expect([...ALL_ELEMENT_HELPERS].sort()).toEqual(
      [...new Set([...ELEMENT_HELPERS, ...SVG_ELEMENT_HELPERS])].sort(),
    )
  })
})
