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
import { isSignalExpr, signalPathOf, singleRoot, STATE_ROOTS, type Roots } from './extract-deps.js'

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

/** Identifier names of a callback's parameters (skips destructured/rest). */
function fnParamNames(fn: ts.Node): string[] {
  if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return []
  return fn.parameters.flatMap((p) => (ts.isIdentifier(p.name) ? [p.name.text] : []))
}

function fnBody(fn: ts.Node): ts.Node | undefined {
  return ts.isArrowFunction(fn) || ts.isFunctionExpression(fn) ? fn.body : undefined
}

/** The local alias a view binds its bag's `state` field to (`({ state })` -> 'state',
 * `({ state: s })` -> 's'), or null if the bag doesn't destructure `state`. Mirrors
 * transform-component's signalRoots so the lint uses the SAME root as the lowering. */
function viewStateAlias(fn: ts.Node): string | null {
  if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return null
  const param = fn.parameters[0]
  if (!param || !ts.isObjectBindingPattern(param.name)) return null
  for (const el of param.name.elements) {
    if (!ts.isIdentifier(el.name)) continue
    const key =
      el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : el.name.text
    if (key === 'state') return el.name.text
  }
  return null
}

/** Augment a roots map with row-scoped signal params (item/index/narrowed/arm).
 * Only presence + a non-null `dep` matters for the lint checks. */
function withParams(base: Roots, params: readonly string[]): Roots {
  if (params.length === 0) return base
  const m = new Map(base)
  for (const p of params) m.set(p, { value: 's', dep: p })
  return m
}

/**
 * Lint the signal usage in a source file. Returns all diagnostics found.
 *
 * Scope-aware: `each`/`show`/`branch` render callbacks introduce signal-typed
 * params (item, index, narrowed, arm variant) that are checked exactly like the
 * `state` root inside those bodies — so `item.at('done') ? a : b` errors in a row
 * just as `state.at('flag') ? a : b` does at the top level. The `key` fn's param
 * is a PLAIN value and stays un-rooted.
 */
export function lintSignals(sf: ts.SourceFile): SignalDiagnostic[] {
  const diags: SignalDiagnostic[] = []
  const push = (rule: string, message: string, node: ts.Node): void => {
    diags.push({ rule, message, start: node.getStart(sf), length: node.getWidth(sf) })
  }

  // A REACTIVE signal value (at/map/derived/bare root) — but NOT a `.peek()`
  // chain, which yields a plain snapshot value that's fine to operate on.
  const isReactiveSignal = (expr: ts.Expression, roots: Roots): boolean => {
    const e = ts.isParenthesizedExpression(expr) ? expr.expression : expr
    if (
      ts.isCallExpression(e) &&
      ts.isPropertyAccessExpression(e.expression) &&
      e.expression.name.text === 'peek'
    ) {
      return false
    }
    return isSignalExpr(e, roots)
  }

  // ---- operator-on-signal: a Signal used as an operand ----
  const checkOperand = (expr: ts.Expression, ctx: string, roots: Roots): void => {
    if (isReactiveSignal(expr, roots)) {
      push(
        'operator-on-signal',
        `Signal used in ${ctx}; operate on the value with .map() instead (e.g. sig.map(v => …)).`,
        expr,
      )
    }
  }

  // a member chain rooted at a known signal root (spots .peek/.at/.map on signals)
  const isSignalRootedAccess = (expr: ts.Expression, roots: Roots): boolean => {
    let cur: ts.Expression = expr
    while (ts.isPropertyAccessExpression(cur) || ts.isCallExpression(cur)) {
      cur = cur.expression
    }
    return ts.isIdentifier(cur) && roots.has(cur.text)
  }

  // ---- inside a .map/derived body: pure-derive + no-node-construction ----
  const lintDeriveBody = (fn: ts.ArrowFunction | ts.FunctionExpression, roots: Roots): void => {
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
          if (REACTIVE_METHODS.has(m) && isSignalRootedAccess(callee.expression, roots)) {
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

  // Walk a render callback's body under augmented roots; fall back to walking the
  // whole node if it isn't a function (defensive). Render bodies are reactive
  // slots, so `peekOk` carries through (handlers within flip it true).
  const visitRender = (
    fn: ts.Node,
    roots: Roots,
    params: readonly string[],
    peekOk: boolean,
  ): void => {
    const body = fnBody(fn)
    if (body) visit(body, withParams(roots, params), peekOk)
    else visit(fn, roots, peekOk)
  }

  const visitEach = (node: ts.CallExpression, roots: Roots, peekOk: boolean): void => {
    const items = node.arguments[0]
    const opts = node.arguments[1]
    if (items) visit(items, roots, peekOk) // items accessor: base roots
    if (opts && ts.isObjectLiteralExpression(opts)) {
      for (const p of opts.properties) {
        if (ts.isPropertyAssignment(p) && p.name.getText(sf) === 'render') {
          visitRender(p.initializer, roots, fnParamNames(p.initializer), peekOk) // item, index
        } else {
          // key fn & friends: plain params -> base roots
          visit(p, roots, peekOk)
        }
      }
    } else if (opts) visit(opts, roots, peekOk)
  }

  const visitShow = (node: ts.CallExpression, roots: Roots, peekOk: boolean): void => {
    const cond = node.arguments[0]
    const render = node.arguments[1]
    if (cond) visit(cond, roots, peekOk)
    if (render) visitRender(render, roots, fnParamNames(render), peekOk) // narrowed
  }

  const visitBranch = (node: ts.CallExpression, roots: Roots, peekOk: boolean): void => {
    const value = node.arguments[0]
    if (value) visit(value, roots, peekOk)
    const a1 = node.arguments[1]
    const a2 = node.arguments[2]
    // 3-arg form: a1 is the key fn `(u) => u.kind` — its param is a PLAIN value
    // (like each's key fn), so walk it under base roots.
    if (a1 && !ts.isObjectLiteralExpression(a1)) visit(a1, roots, peekOk)
    const arms =
      a2 && ts.isObjectLiteralExpression(a2)
        ? a2
        : a1 && ts.isObjectLiteralExpression(a1)
          ? a1
          : undefined
    if (arms) {
      for (const p of arms.properties) {
        if (ts.isPropertyAssignment(p)) {
          visitRender(p.initializer, roots, fnParamNames(p.initializer), peekOk) // narrowed variant
        } else visit(p, roots, peekOk)
      }
    }
  }

  // a `sig.peek()` call on a signal-rooted receiver
  const isSignalPeek = (node: ts.Node, roots: Roots): boolean =>
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'peek' &&
    isSignalExpr(node.expression.expression, roots)

  function visit(node: ts.Node, roots: Roots, peekOk: boolean): void {
    // component({ … view: (bag) => [...] }) — lint the view body under the SAME
    // root the lowering uses (the bag's `state` alias), so an aliased bag like
    // `({ state: s }) => [text(s.at('n') + 1)]` is checked, not silently passed.
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'component' &&
      node.arguments[0] &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      for (const prop of node.arguments[0].properties) {
        if (
          ts.isPropertyAssignment(prop) &&
          prop.name.getText(sf) === 'view' &&
          (ts.isArrowFunction(prop.initializer) || ts.isFunctionExpression(prop.initializer))
        ) {
          const alias = viewStateAlias(prop.initializer)
          const body = fnBody(prop.initializer)
          if (alias && body) {
            visit(body, singleRoot(alias), false)
            continue
          }
        }
        visit(prop, roots, false) // init/update/onEffect etc.: plain values
      }
      return
    }

    // structural primitives augment roots inside their render callbacks
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const callee = node.expression.text
      if (callee === 'each') return visitEach(node, roots, peekOk)
      if (callee === 'show') return visitShow(node, roots, peekOk)
      if (callee === 'branch') return visitBranch(node, roots, peekOk)
    }

    // peek-in-slot: a non-reactive snapshot used in a reactive slot (renders
    // once, never updates). Legitimate inside event handlers / derive bodies.
    if (!peekOk && isSignalPeek(node, roots)) {
      push(
        'peek-in-slot',
        '.peek() in a reactive slot reads once and never updates; use .at()/.map() for reactivity, or read it inside an event handler.',
        node,
      )
    }

    // operator-on-signal
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind
      if (op !== ts.SyntaxKind.EqualsToken) {
        checkOperand(node.left, 'an operator expression', roots)
        checkOperand(node.right, 'an operator expression', roots)
      }
    }
    if (ts.isTemplateExpression(node)) {
      for (const span of node.templateSpans)
        checkOperand(span.expression, 'a template literal', roots)
    }
    if (ts.isConditionalExpression(node)) {
      checkOperand(node.condition, 'a ternary condition', roots)
    }
    if (ts.isPrefixUnaryExpression(node)) checkOperand(node.operand, 'a unary expression', roots)

    // .map / derived bodies
    if (ts.isCallExpression(node)) {
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'map') {
        const fn = node.arguments[0]
        if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) lintDeriveBody(fn, roots)
      }
      if (ts.isIdentifier(node.expression) && node.expression.text === 'derived') {
        const fn = node.arguments[1]
        if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) lintDeriveBody(fn, roots)
      }
      // whole-state-to-call: a bare root with empty dep (the component state)
      // passed straight to a call in a reactive position (coarse dep).
      for (const arg of node.arguments) {
        if (ts.isIdentifier(arg) && roots.has(arg.text) && signalPathOf(arg, roots) === '') {
          push(
            'whole-state-to-call',
            "Whole `state` passed to a call in a reactive position; pass a slice (state.at('…')) to keep the dependency narrow.",
            arg,
          )
        }
      }
    }

    node.forEachChild((c) => {
      // `.peek()` is allowed inside event-handler functions and .map/derived
      // callback bodies — flip peekOk true when descending into them.
      let childPeek = peekOk
      if (
        ts.isPropertyAssignment(node) &&
        c === node.initializer &&
        /^on[A-Z]/.test(node.name.getText(sf))
      ) {
        childPeek = true
      } else if (ts.isCallExpression(node)) {
        const isMap =
          ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'map'
        const isDerived = ts.isIdentifier(node.expression) && node.expression.text === 'derived'
        if ((isMap && c === node.arguments[0]) || (isDerived && c === node.arguments[1])) {
          childPeek = true
        }
      }
      visit(c, roots, childPeek)
    })
  }
  visit(sf, STATE_ROOTS, false)
  return diags
}

/** A lint diagnostic with source position resolved (1-based line, 0-based col). */
export interface SignalLintMessage {
  rule: string
  message: string
  start: number
  line: number
  column: number
}

/**
 * Parse `source` and run the signal lint rules, returning diagnostics with
 * resolved line/column. The adapter (vite plugin) surfaces these as build
 * errors. Call only on confirmed signal components.
 */
export function lintSignalSource(source: string, fileName = 'm.tsx'): SignalLintMessage[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  return lintSignals(sf).map((d) => {
    const lc = sf.getLineAndCharacterOfPosition(d.start)
    return {
      rule: d.rule,
      message: d.message,
      start: d.start,
      line: lc.line + 1,
      column: lc.character,
    }
  })
}
