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
import { analyzeSignalExpr, STATE_ROOTS, type Roots } from './extract-deps.js'

/** Build a property-access source from a base expression and a dotted path,
 * using bracket access for numeric segments (`list.0.p` -> `base.list[0].p`). */
function pathAccess(base: string, dotted: string): string {
  let out = base
  for (const seg of dotted.split('.')) out += /^\d+$/.test(seg) ? `[${seg}]` : `.${seg}`
  return out
}

/**
 * Source for an expression that reads a signal's VALUE from the state param `s`.
 * Navigation for `.at`, function application for `.map`/`derived`, identity for
 * `.peek`.
 */
function valueSrc(expr: ts.Expression, sf: ts.SourceFile, roots: Roots): string {
  if (ts.isParenthesizedExpression(expr)) return valueSrc(expr.expression, sf, roots)

  if (ts.isIdentifier(expr)) return roots.get(expr.text)?.value ?? expr.getText(sf)

  if (ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression)) {
    const method = expr.expression.name.text
    const recv = expr.expression.expression

    if (method === 'at') {
      const arg = expr.arguments[0]
      if (arg && ts.isStringLiteral(arg)) return pathAccess(valueSrc(recv, sf, roots), arg.text)
      return expr.getText(sf) // dynamic key — leave as-is (rule error elsewhere)
    }
    if (method === 'map') {
      const fn = expr.arguments[0]
      if (fn) return `(${fn.getText(sf)})(${valueSrc(recv, sf, roots)})`
      return expr.getText(sf)
    }
    if (method === 'peek') return valueSrc(recv, sf, roots)
  }

  if (
    ts.isCallExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    expr.expression.text === 'derived'
  ) {
    const arr = expr.arguments[0]
    const fn = expr.arguments[1]
    if (arr && ts.isArrayLiteralExpression(arr) && fn) {
      const args = arr.elements.map((e) => valueSrc(e, sf, roots)).join(', ')
      return `(${fn.getText(sf)})(${args})`
    }
  }

  // Not a recognized signal form — emit verbatim.
  return expr.getText(sf)
}

export interface Lowered {
  /** the body of the `(s) => …` produce function */
  produce: string
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
