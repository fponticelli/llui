// Signal-expression → absolute dependency paths.
//
// The bridge between the accessor analyzer (analyze-deps.ts, which works on a
// `.map`/`derived` callback body relative to its parameter) and the runtime path
// table (which needs absolute-from-state paths). Given a signal-valued
// expression as it appears in a reactive slot — `state.at('user.name')`,
// `state.at('user').map(u => `${u.first} ${u.last}`)`, `derived([...], fn)` —
// returns the set of absolute dependency paths it reads.
//
// Composition with rebasing:
//   - `.at('a.b')` extends the source signal's path.
//   - `.map(fn)` analyzes `fn` (relative to its param) and rebases the relative
//     deps onto the receiver's path.
//   - `derived([s0, s1], fn)` rebases `fn`'s per-param deps onto each input's
//     path.
//   - `.peek()` is a non-reactive snapshot — contributes no dependency.
//   - anything un-rebasable coarsens to the source's deps (sound).
//
// See docs/proposals/signals/README.md "Dependency Analysis".

import ts from 'typescript'
import { analyzeAccessor } from './analyze-deps.js'

const REL_ROOT = '' // the whole parameter / whole source

/** How a signal root maps into lowered code: `value` is the produce-source
 * prefix (e.g. `s` or `ctx.item`); `dep` is the dependency-path namespace
 * (e.g. `` for the component view, `item`/`state` inside an each row). */
export interface RootInfo {
  value: string
  dep: string
}
export type Roots = ReadonlyMap<string, RootInfo>

/** Default: the component view's single `state` root (produce param `s`, deps
 * relative to the component state). */
export const STATE_ROOTS: Roots = new Map([['state', { value: 's', dep: '' }]])

/** A single-root map under a chosen local name (e.g. a destructured `state`
 * alias), produce param `s`, deps relative. */
export function singleRoot(name: string): Roots {
  return new Map([[name, { value: 's', dep: '' }]])
}

/** Peel semantically-transparent wrappers — parentheses and the type-only casts
 * `as`/`!`/`satisfies` — so signal recognition/lowering sees the underlying
 * expression. A cast like `state.at('b') as any` denotes the SAME signal as
 * `state.at('b')`; treating it opaquely (the old behavior) leaked a handle into
 * a produce body. Shared by signalPathOf/isSignalExpr/analyzeSignalExpr (here)
 * and valueSrc (lower.ts) so all four agree on what is a signal. */
export function unwrapCasts(expr: ts.Expression): ts.Expression {
  let e = expr
  while (
    ts.isParenthesizedExpression(e) ||
    ts.isAsExpression(e) ||
    ts.isNonNullExpression(e) ||
    ts.isSatisfiesExpression(e)
  ) {
    e = e.expression
  }
  return e
}

/** Rebase a relative dep path onto an absolute source prefix. */
function rebaseOne(rel: string, base: string): string {
  if (base === REL_ROOT) return rel
  if (rel === REL_ROOT) return base
  return `${base}.${rel}`
}
function rebase(rels: Iterable<string>, base: string): Set<string> {
  const out = new Set<string>()
  for (const r of rels) out.add(rebaseOne(r, base))
  return out
}
function unionInto(target: Set<string>, src: Iterable<string>): void {
  for (const s of src) target.add(s)
}

/**
 * The single absolute path an `.at()`-chain expression denotes, or `null` if it
 * is not a simple path (e.g. a `.map`/`derived` result, or rooted at something
 * other than a known signal root).
 */
export function signalPathOf(expr: ts.Expression, roots: Roots): string | null {
  const e = unwrapCasts(expr)
  if (ts.isIdentifier(e)) return roots.get(e.text)?.dep ?? null
  if (
    ts.isCallExpression(e) &&
    ts.isPropertyAccessExpression(e.expression) &&
    e.expression.name.text === 'at'
  ) {
    const base = signalPathOf(e.expression.expression, roots)
    if (base === null) return null
    const arg = e.arguments[0]
    if (arg && ts.isStringLiteral(arg)) return base === REL_ROOT ? arg.text : `${base}.${arg.text}`
    return null
  }
  return null
}

/**
 * Is `expr` STRUCTURALLY a signal expression (a `state`/`.at`/`.map`/`.peek`
 * chain or `derived(...)`)? Strict on shape — does NOT return true merely because
 * a signal appears somewhere inside (e.g. an event handler `() => send(state.at(
 * 'x').peek())` is NOT a signal expression). Used to distinguish reactive slots
 * from handlers/static values in the view transform.
 */
export function isSignalExpr(expr: ts.Expression, roots: Roots = STATE_ROOTS): boolean {
  const e = unwrapCasts(expr)
  if (signalPathOf(e, roots) !== null) return true
  if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression)) {
    const m = e.expression.name.text
    if (m === 'map' || m === 'at' || m === 'peek')
      return isSignalExpr(e.expression.expression, roots)
  }
  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'derived') {
    return true
  }
  return false
}

/**
 * The set of absolute dependency paths a signal-valued expression reads.
 */
export function analyzeSignalExpr(rawExpr: ts.Expression, roots: Roots = STATE_ROOTS): Set<string> {
  const expr = unwrapCasts(rawExpr)

  // A bare signal or `.at()` chain used directly in a reactive slot.
  const direct = signalPathOf(expr, roots)
  if (direct !== null) return new Set([direct])

  if (ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression)) {
    const method = expr.expression.name.text
    const recv = expr.expression.expression

    if (method === 'peek') return new Set() // non-reactive snapshot

    if (method === 'map') {
      const fn = expr.arguments[0]
      const srcPath = signalPathOf(recv, roots)
      if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) {
        const rel = analyzeAccessor(fn).deps[0] ?? new Set<string>()
        if (srcPath !== null) return rebase(rel, srcPath)
        // receiver is itself derived (e.g. chained .map): the body reads the
        // receiver's output, already covered by the receiver's deps.
        return analyzeSignalExpr(recv, roots)
      }
      // non-literal callback (e.g. imported fn): inter-procedural narrowing is a
      // later step — coarsen to the whole source.
      return srcPath !== null ? new Set([srcPath]) : analyzeSignalExpr(recv, roots)
    }

    if (method === 'at') {
      // `.at` on a non-simple receiver (signalPathOf was null) — coarsen.
      return analyzeSignalExpr(recv, roots)
    }
  }

  // derived([s0, s1, ...], fn)
  if (
    ts.isCallExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    expr.expression.text === 'derived'
  ) {
    const arr = expr.arguments[0]
    const fn = expr.arguments[1]
    const out = new Set<string>()
    if (arr && ts.isArrayLiteralExpression(arr)) {
      const inputs = arr.elements
      const rels =
        fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))
          ? analyzeAccessor(fn).deps
          : []
      inputs.forEach((input, i) => {
        const srcPath = signalPathOf(input, roots)
        const rel = rels[i]
        if (srcPath !== null && rel) unionInto(out, rebase(rel, srcPath))
        else unionInto(out, analyzeSignalExpr(input, roots)) // coarsen this input
      })
      return out
    }
  }

  // Unknown form in a reactive slot (operators on signals are a rule error, so
  // this is rare). Defensive: union the deps of any signal sub-expression.
  const result = new Set<string>()
  expr.forEachChild((c) => {
    if (isExpr(c)) unionInto(result, analyzeSignalExpr(c, roots))
  })
  return result
}

function isExpr(n: ts.Node): n is ts.Expression {
  // Identifier / call / property-access / paren cover the signal forms we care
  // about; broaden defensively without relying on private enum ranges.
  return (
    ts.isIdentifier(n) ||
    ts.isCallExpression(n) ||
    ts.isPropertyAccessExpression(n) ||
    ts.isParenthesizedExpression(n) ||
    ts.isElementAccessExpression(n) ||
    ts.isBinaryExpression(n) ||
    ts.isConditionalExpression(n) ||
    ts.isTemplateExpression(n)
  )
}
