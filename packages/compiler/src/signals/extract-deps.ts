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
export function signalPathOf(expr: ts.Expression, rootNames: ReadonlySet<string>): string | null {
  if (ts.isIdentifier(expr)) return rootNames.has(expr.text) ? REL_ROOT : null
  if (ts.isParenthesizedExpression(expr)) return signalPathOf(expr.expression, rootNames)
  if (
    ts.isCallExpression(expr) &&
    ts.isPropertyAccessExpression(expr.expression) &&
    expr.expression.name.text === 'at'
  ) {
    const base = signalPathOf(expr.expression.expression, rootNames)
    if (base === null) return null
    const arg = expr.arguments[0]
    if (arg && ts.isStringLiteral(arg)) return base === REL_ROOT ? arg.text : `${base}.${arg.text}`
    return null
  }
  return null
}

/**
 * The set of absolute dependency paths a signal-valued expression reads.
 */
export function analyzeSignalExpr(
  expr: ts.Expression,
  rootNames: ReadonlySet<string> = new Set(['state']),
): Set<string> {
  if (ts.isParenthesizedExpression(expr)) return analyzeSignalExpr(expr.expression, rootNames)

  // A bare signal or `.at()` chain used directly in a reactive slot.
  const direct = signalPathOf(expr, rootNames)
  if (direct !== null) return new Set([direct])

  if (ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression)) {
    const method = expr.expression.name.text
    const recv = expr.expression.expression

    if (method === 'peek') return new Set() // non-reactive snapshot

    if (method === 'map') {
      const fn = expr.arguments[0]
      const srcPath = signalPathOf(recv, rootNames)
      if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) {
        const rel = analyzeAccessor(fn).deps[0] ?? new Set<string>()
        if (srcPath !== null) return rebase(rel, srcPath)
        // receiver is itself derived (e.g. chained .map): the body reads the
        // receiver's output, already covered by the receiver's deps.
        return analyzeSignalExpr(recv, rootNames)
      }
      // non-literal callback (e.g. imported fn): inter-procedural narrowing is a
      // later step — coarsen to the whole source.
      return srcPath !== null ? new Set([srcPath]) : analyzeSignalExpr(recv, rootNames)
    }

    if (method === 'at') {
      // `.at` on a non-simple receiver (signalPathOf was null) — coarsen.
      return analyzeSignalExpr(recv, rootNames)
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
        const srcPath = signalPathOf(input, rootNames)
        const rel = rels[i]
        if (srcPath !== null && rel) unionInto(out, rebase(rel, srcPath))
        else unionInto(out, analyzeSignalExpr(input, rootNames)) // coarsen this input
      })
      return out
    }
  }

  // Unknown form in a reactive slot (operators on signals are a rule error, so
  // this is rare). Defensive: union the deps of any signal sub-expression.
  const result = new Set<string>()
  expr.forEachChild((c) => {
    if (isExpr(c)) unionInto(result, analyzeSignalExpr(c, rootNames))
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
