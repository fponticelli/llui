// Signal codegen — lower an authored signal expression to the runtime form.
//
// A reactive slot like `text(state.at('user').map(u => `Hi ${u.name}`))` is
// rewritten by the transform into `signalText((s) => (u => `Hi ${u.name}`)(s.user),
// ['user.name'])`. This module produces the two halves of that lowering for a
// signal expression:
//   - `produce`: the body of `(s) => …` that reads the signal's value from a
//     plain state parameter `s` (navigation for `.at`, application for
//     `.map`/`derived`), and
//   - `deps`: the absolute dependency paths (via analyzeSignalExpr).
//
// See docs/proposals/signals/README.md.

import ts from 'typescript'
import { analyzeSignalExpr, unwrapCasts, STATE_ROOTS, type Roots } from './extract-deps.js'

/** A valid JS identifier usable as a `.name` member (no quoting needed). */
const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/** Build a property-access source from a base expression and a dotted path.
 * Numeric segments use index access (`list.0.p` -> `base.list[0].p`); a segment
 * that isn't a bare identifier (e.g. `my-key`, which as `.my-key` would parse as
 * subtraction) uses quoted bracket access (`base['my-key']`). */
function pathAccess(base: string, dotted: string): string {
  let out = base
  for (const seg of dotted.split('.')) {
    if (/^\d+$/.test(seg)) out += `[${seg}]`
    else if (IDENT_RE.test(seg)) out += `.${seg}`
    else out += `[${JSON.stringify(seg)}]`
  }
  return out
}

/**
 * Source for an expression that reads a signal's VALUE from the state param `s`.
 * Navigation for `.at`, function application for `.map`/`derived`, identity for
 * `.peek`. Returns `null` for any UNRECOGNIZED form — a bare non-root identifier
 * (a signal-handle local), a dynamic `.at()` key, or a shape this lowering can't
 * read as a plain value. The caller must then keep the whole slot verbatim so the
 * runtime authoring helper consumes the handle: emitting the expression verbatim
 * into a produce body (the old behavior) evaluates to a Signal HANDLE, not a value.
 */
function valueSrc(expr: ts.Expression, sf: ts.SourceFile, roots: Roots): string | null {
  const e = unwrapCasts(expr)

  if (ts.isIdentifier(e)) return roots.get(e.text)?.value ?? null

  if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression)) {
    const method = e.expression.name.text
    const recv = e.expression.expression

    if (method === 'at') {
      const arg = e.arguments[0]
      if (arg && ts.isStringLiteral(arg)) {
        const b = valueSrc(recv, sf, roots)
        return b === null ? null : pathAccess(b, arg.text)
      }
      return null // dynamic key — bail slot to verbatim (rule error elsewhere)
    }
    if (method === 'map') {
      const fn = e.arguments[0]
      const b = valueSrc(recv, sf, roots)
      if (fn && b !== null) return `(${fn.getText(sf)})(${b})`
      return null
    }
    if (method === 'peek') return valueSrc(recv, sf, roots)
  }

  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'derived') {
    const arr = e.arguments[0]
    const fn = e.arguments[1]
    if (arr && ts.isArrayLiteralExpression(arr) && fn) {
      const parts = arr.elements.map((el) => valueSrc(el, sf, roots))
      if (parts.some((p) => p === null)) return null
      return `(${fn.getText(sf)})(${parts.join(', ')})`
    }
    return null
  }

  // Not a recognized signal form — bail (do NOT emit a handle read).
  return null
}

export interface Lowered {
  /** the body of the `(s) => …` produce function, or `null` when the expression
   * isn't a recognized signal form the lowering can read as a value — the caller
   * must keep the slot verbatim. */
  produce: string | null
  /** absolute dependency paths */
  deps: string[]
}

/** Lower a signal expression to its runtime `{ produce, deps }`. */
export function signalToProduce(
  expr: ts.Expression,
  sf: ts.SourceFile,
  roots: Roots = STATE_ROOTS,
): Lowered {
  return {
    produce: valueSrc(expr, sf, roots),
    deps: [...analyzeSignalExpr(expr, roots)],
  }
}
