// Signal lint rules — compile-time errors that keep the signal surface safe.
//
// These run over a parsed source and return diagnostics. They encode the
// proposal's rule set (docs/proposals/signals/README.md "Rule Changes"):
//
//   operator-on-signal       — arithmetic/comparison/template/ternary/logical on
//                              a Signal value (use .map)
//   no-node-construction-in-body — element/text helper called inside a
//                              .map/derived body (use a structural primitive)
//   pure-derive-body         — side effects (fetch/send/setTimeout/DOM/...) or
//                              reactive primitives (.peek/.at/.map) inside a
//                              .map/derived body — CORRECTNESS-CRITICAL (analyzer
//                              soundness depends on these bans)
//   whole-state-to-call      — a reactive slot passes the whole `state` to a
//                              call (coarse dep — pass a slice)
//
// Each diagnostic has a message and a source position (start offset + length).

import ts from 'typescript'
import { isSignalExpr, signalPathOf } from './extract-deps.js'

export interface SignalDiagnostic {
  rule: string
  message: string
  start: number
  length: number
}

const SIDE_EFFECT_CALLS = new Set([
  'fetch',
  'send',
  'setTimeout',
  'setInterval',
  'requestAnimationFrame',
  'queueMicrotask',
])
const NONDET_CALLS = new Set(['now', 'random']) // Date.now / Math.random (member calls)
const ELEMENT_HELPERS = new Set([
  'div',
  'span',
  'p',
  'a',
  'button',
  'input',
  'label',
  'ul',
  'ol',
  'li',
  'section',
  'header',
  'footer',
  'nav',
  'main',
  'h1',
  'h2',
  'h3',
  'img',
  'table',
  'tr',
  'td',
  'select',
  'option',
  'textarea',
  'text',
  'el',
  'signalText',
])
const REACTIVE_METHODS = new Set(['peek', 'at', 'map'])

const ROOTS = new Set(['state'])

/**
 * Lint the signal usage in a source file. Returns all diagnostics found.
 */
export function lintSignals(sf: ts.SourceFile): SignalDiagnostic[] {
  const diags: SignalDiagnostic[] = []
  const push = (rule: string, message: string, node: ts.Node): void => {
    diags.push({ rule, message, start: node.getStart(sf), length: node.getWidth(sf) })
  }

  // ---- operator-on-signal: a Signal used as an operand ----
  const checkOperand = (expr: ts.Expression, ctx: string): void => {
    if (isSignalExpr(expr, ROOTS)) {
      push(
        'operator-on-signal',
        `Signal used in ${ctx}; operate on the value with .map() instead (e.g. sig.map(v => …)).`,
        expr,
      )
    }
  }

  // ---- inside a .map/derived body: pure-derive + no-node-construction ----
  const lintDeriveBody = (fn: ts.ArrowFunction | ts.FunctionExpression): void => {
    const body = fn.body
    const walk = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const callee = n.expression
        if (ts.isIdentifier(callee)) {
          if (ELEMENT_HELPERS.has(callee.text)) {
            push(
              'no-node-construction-in-body',
              `Building DOM (${callee.text}()) inside a .map/derived body; use a structural primitive (each/branch/show) instead.`,
              n,
            )
          } else if (SIDE_EFFECT_CALLS.has(callee.text)) {
            push(
              'pure-derive-body',
              `Side effect (${callee.text}()) inside a .map/derived body; derives must be pure — move it to an effect.`,
              n,
            )
          }
        } else if (ts.isPropertyAccessExpression(callee)) {
          const m = callee.name.text
          if (REACTIVE_METHODS.has(m) && isSignalRootedAccess(callee.expression)) {
            push(
              'pure-derive-body',
              `Reactive primitive (.${m}) inside a .map/derived body; the body must operate on plain values — declare deps via the source signal / derived inputs.`,
              n,
            )
          } else if (NONDET_CALLS.has(m)) {
            push(
              'pure-derive-body',
              `Non-deterministic call (.${m}()) inside a .map/derived body; derives must be pure.`,
              n,
            )
          }
        }
      }
      n.forEachChild(walk)
    }
    if (body) walk(body)
  }

  // a member chain rooted at `state` (used to spot .peek/.at/.map on signals)
  const isSignalRootedAccess = (expr: ts.Expression): boolean => {
    let cur: ts.Expression = expr
    while (ts.isPropertyAccessExpression(cur) || ts.isCallExpression(cur)) {
      cur = ts.isCallExpression(cur) ? cur.expression : cur.expression
    }
    return ts.isIdentifier(cur) && ROOTS.has(cur.text)
  }

  const visit = (node: ts.Node): void => {
    // operator-on-signal
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind
      // skip assignment-only contexts; flag arithmetic/comparison/logical
      if (op !== ts.SyntaxKind.EqualsToken) {
        checkOperand(node.left, 'an operator expression')
        checkOperand(node.right, 'an operator expression')
      }
    }
    if (ts.isTemplateExpression(node)) {
      for (const span of node.templateSpans) checkOperand(span.expression, 'a template literal')
    }
    if (ts.isConditionalExpression(node)) {
      checkOperand(node.condition, 'a ternary condition')
    }
    if (ts.isPrefixUnaryExpression(node)) checkOperand(node.operand, 'a unary expression')

    // .map / derived bodies
    if (ts.isCallExpression(node)) {
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'map') {
        const fn = node.arguments[0]
        if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) lintDeriveBody(fn)
      }
      if (ts.isIdentifier(node.expression) && node.expression.text === 'derived') {
        const fn = node.arguments[1]
        if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) lintDeriveBody(fn)
      }
      // whole-state-to-call: a bare root `state` passed as a call argument in a
      // reactive context (coarse dep). Heuristic: argument is exactly a root id.
      for (const arg of node.arguments) {
        if (ts.isIdentifier(arg) && ROOTS.has(arg.text) && signalPathOf(arg, ROOTS) === '') {
          push(
            'whole-state-to-call',
            "Whole `state` passed to a call in a reactive position; pass a slice (state.at('…')) to keep the dependency narrow.",
            arg,
          )
        }
      }
    }

    node.forEachChild(visit)
  }
  visit(sf)
  return diags
}
