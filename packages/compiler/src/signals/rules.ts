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
//   prefer-at-over-map       — a plain single-field projection `sig.map(p => p.x)`
//                              should be `sig.at('x')` — a path signal that depends
//                              only on `x`, not the whole source
//   at-after-map             — `sig.map(fn).at('x')` / `derived(…).at('x')`: a mapped
//                              signal has no static path to slice (runtime throw +
//                              type error) — slice with `.at()` BEFORE `.map()`
//
// (There is deliberately no whole-`state`-coarseness rule: rendering a whole-state
// object is already a TYPE error via `text`/`AttrValue` = `Reactive<string|number>`,
// and a `Signal` coerced in a template/operator is caught by `operator-on-signal`.
// A "pass a slice" rule on top of those was circumventable (`fmt(state)` →
// `state.map(fmt)` keeps the same dep) and over-fired on composition; removed.)
//
// Also restored (compile-time errors):
//   async-update      — async init()/update(): a reducer must return its result as
//                       data ([state, effects]); an async one returns a Promise.
//   controlled-input  — input/textarea with a reactive `value` but no onInput/onChange
//                       (the binding overwrites the user's keystrokes every update).
//   exhaustive-update — `switch (msg.type)` in update() that misses a Msg variant
//                       (with no `default`); an unhandled message silently no-ops.
//   a11y              — <img> without `alt`; onClick on a non-interactive element with
//                       no `role` + `tabindex` (not keyboard-accessible). Exempts
//                       role="presentation"/"none"; accepts `tabindex`/`tabIndex`.
//   convention        — a multiword DOM attribute written in camelCase when LLui
//                       authors the HTML-native lowercase form (e.g. `tabIndex` →
//                       `tabindex`, matching `class`/`for`/`aria-*`). Both bind
//                       identically at runtime; this steers to one spelling.
//                       Carries an autofix (and is auto-applied by the vite plugin).
//   event-handler-casing — a known handler name miscased (`onclick` → `onClick`).
//                       The binder only binds `/^on[A-Z]/`, so the miscased form is
//                       a dead attribute that never fires. Correctness; has a fix.
//                       (Handlers are the ONE camelCase exception — runtime-required.)
//   attr-name         — a React-ism that silently doesn't apply (`className` →
//                       `class`, `htmlFor` → `for`). Correctness; has a fix.
//
// Each diagnostic has a message, a source position (start offset + length), and —
// for the rename-style rules above — a `fix` (see {@link LintFix}/{@link applyLintFixes}).

import ts from 'typescript'
import { isSignalExpr, singleRoot, STATE_ROOTS, type Roots } from './extract-deps.js'
import { applyTextEdits, mergeNonOverlapping, type TextEdit } from './apply-edits.js'

/** A single text replacement, as absolute char offsets into the linted source. */
export interface LintEdit {
  start: number
  end: number
  newText: string
}

/** A deterministic, mechanically-applicable fix for a diagnostic — the same
 * shape an editor quick-fix or `applyLintFixes` consumes. A diagnostic carries
 * at most one (the single obvious correction); multi-option fixes aren't needed
 * for the rename-style rules that produce them. */
export interface LintFix {
  /** Short label, e.g. "Rename to `tabindex`". */
  title: string
  edits: LintEdit[]
}

export interface SignalDiagnostic {
  rule: string
  message: string
  start: number
  length: number
  /** Present iff the diagnostic is mechanically fixable (rename-style rules). */
  fix?: LintFix
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
// Elements that are natively focusable/clickable — an onClick on these needs no
// extra role/tabIndex for keyboard accessibility.
const INTERACTIVE_TAGS = new Set(['button', 'a', 'input', 'select', 'textarea', 'option'])
// Attribute names with a canonical LLui spelling, keyed by the LOWERCASE form of
// what an author might write. `kind`:
//   'convention' — a multiword DOM attribute written in camelCase. LLui authors
//     attributes in their HTML-NATIVE lowercase form (the same way it uses
//     `class`/`for`, not React's `className`/`htmlFor`, and `aria-*`/`data-*`),
//     so the camelCase spelling is non-idiomatic. It still binds (setAttribute is
//     case-insensitive), so this is runtime-neutral and auto-fixed. The target
//     (`to`) is just the HTML attribute name — an unambiguous lowercasing, so the
//     catch-list can be broad. (DOM IDL property *access* on a node, e.g.
//     `el.tabIndex`, is the JS API and is NOT an element-prop key, so it is never
//     reached by this rule.)
//   'broken' — a React-ism that silently does NOT apply: a `className`/`htmlFor`
//     prop is written verbatim via `setAttribute` as a dead `classname`/`htmlfor`
//     attribute and the class/label is never set. A correctness bug → hard error.
// Keyed by lowercase so any casing of a known name matches; only flagged when the
// WRITTEN spelling differs from `to` (so the lowercase form is never flagged).
interface AttrCorrection {
  to: string
  kind: 'convention' | 'broken'
}
const ATTR_CORRECTIONS = new Map<string, AttrCorrection>([
  ['tabindex', { to: 'tabindex', kind: 'convention' }],
  ['readonly', { to: 'readonly', kind: 'convention' }],
  ['spellcheck', { to: 'spellcheck', kind: 'convention' }],
  ['maxlength', { to: 'maxlength', kind: 'convention' }],
  ['minlength', { to: 'minlength', kind: 'convention' }],
  ['colspan', { to: 'colspan', kind: 'convention' }],
  ['rowspan', { to: 'rowspan', kind: 'convention' }],
  ['contenteditable', { to: 'contenteditable', kind: 'convention' }],
  ['crossorigin', { to: 'crossorigin', kind: 'convention' }],
  ['inputmode', { to: 'inputmode', kind: 'convention' }],
  ['autocomplete', { to: 'autocomplete', kind: 'convention' }],
  ['autofocus', { to: 'autofocus', kind: 'convention' }],
  ['novalidate', { to: 'novalidate', kind: 'convention' }],
  ['formaction', { to: 'formaction', kind: 'convention' }],
  ['classname', { to: 'class', kind: 'broken' }],
  ['htmlfor', { to: 'for', kind: 'broken' }],
])
// Canonical `on*` event-handler names the runtime binds. Mirrors `@llui/dom`'s
// `ElEventMap` — kept here independently (like `ELEMENT_HELPERS`) so the compiler
// needs no `@llui/dom` dependency. The binder only treats `/^on[A-Z]/` as a
// listener, so a miscased `onclick`/`onkeydown` silently never binds — caught by
// the `event-handler-casing` rule, which renames to the canonical form below.
const EVENT_HANDLER_BY_LOWER = new Map<string, string>(
  (
    [
      'onClick',
      'onDblClick',
      'onMouseDown',
      'onMouseUp',
      'onMouseEnter',
      'onMouseLeave',
      'onMouseMove',
      'onMouseOver',
      'onMouseOut',
      'onContextMenu',
      'onPointerDown',
      'onPointerUp',
      'onPointerMove',
      'onPointerEnter',
      'onPointerLeave',
      'onPointerCancel',
      'onKeyDown',
      'onKeyUp',
      'onKeyPress',
      'onInput',
      'onChange',
      'onSubmit',
      'onReset',
      'onFocus',
      'onBlur',
      'onFocusIn',
      'onFocusOut',
      'onScroll',
      'onWheel',
      'onDrag',
      'onDragStart',
      'onDragEnd',
      'onDragOver',
      'onDragEnter',
      'onDragLeave',
      'onDrop',
      'onTouchStart',
      'onTouchEnd',
      'onTouchMove',
    ] as const
  ).map((h) => [h.toLowerCase(), h]),
)
// ELEMENT_HELPERS entries that don't produce a DOM *element* with attributes.
const NON_ELEMENT_HELPERS = new Set(['text', 'el', 'signalText'])

/** True when an arrow/function expression carries the `async` modifier. */
function isAsyncFunction(node: ts.Node): boolean {
  return (
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    (node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false)
  )
}

/** The `type: '<literal>'` discriminant of a type-literal/interface member list,
 * or null when there is no string-literal `type` member (can't reason about it). */
function discriminantOfMembers(members: ts.NodeArray<ts.TypeElement>): string | null {
  for (const m of members) {
    if (!ts.isPropertySignature(m) || !m.name || !ts.isIdentifier(m.name)) continue
    if (m.name.text !== 'type') continue
    if (!m.type || !ts.isLiteralTypeNode(m.type) || !ts.isStringLiteral(m.type.literal)) return null
    return m.type.literal.text
  }
  return null
}

/**
 * Collect the discriminant `type` string literals of a Msg union resolvable
 * WITHIN this file. Returns null when the union can't be fully resolved locally
 * (an imported/composed TypeReference, a non-string discriminant, an
 * intersection, …) — exhaustiveness is only flagged when every variant is
 * visible, so a partial view never produces a false positive.
 */
function collectMsgVariantsLocal(
  sf: ts.SourceFile,
  typeNode: ts.TypeNode,
  seen: Set<string> = new Set(),
): Set<string> | null {
  let t = typeNode
  while (ts.isParenthesizedTypeNode(t)) t = t.type

  if (ts.isUnionTypeNode(t)) {
    const out = new Set<string>()
    for (const member of t.types) {
      const sub = collectMsgVariantsLocal(sf, member, seen)
      if (!sub) return null
      for (const v of sub) out.add(v)
    }
    return out
  }
  if (ts.isTypeLiteralNode(t)) {
    const v = discriminantOfMembers(t.members)
    return v ? new Set([v]) : null
  }
  if (ts.isTypeReferenceNode(t) && ts.isIdentifier(t.typeName)) {
    const name = t.typeName.text
    if (seen.has(name)) return new Set()
    seen.add(name)
    let resolved: Set<string> | null = null
    let found = false
    sf.forEachChild((n) => {
      if (found) return
      if (ts.isTypeAliasDeclaration(n) && n.name.text === name) {
        found = true
        resolved = collectMsgVariantsLocal(sf, n.type, seen)
      } else if (ts.isInterfaceDeclaration(n) && n.name.text === name) {
        found = true
        const v = discriminantOfMembers(n.members)
        resolved = v ? new Set([v]) : null
      }
    })
    return found ? resolved : null // not declared in this file (imported) → bail
  }
  return null
}

/**
 * Find a `switch (msg.type) { … }` in the update reducer and return the set of
 * handled case literals + whether a `default` clause exists. Returns null when
 * there is no analyzable switch on `<msgParam>.type` (e.g. if/else dispatch, or
 * a computed case label) so exhaustiveness stays quiet rather than guess.
 */
function updateSwitchCases(
  body: ts.Node,
  msgParam: string,
): { handled: Set<string>; hasDefault: boolean } | null {
  let result: { handled: Set<string>; hasDefault: boolean } | null = null
  let bailed = false
  const walk = (n: ts.Node): void => {
    if (result || bailed) return
    if (ts.isSwitchStatement(n)) {
      const e = n.expression
      if (
        ts.isPropertyAccessExpression(e) &&
        e.name.text === 'type' &&
        ts.isIdentifier(e.expression) &&
        e.expression.text === msgParam
      ) {
        const handled = new Set<string>()
        let hasDefault = false
        for (const clause of n.caseBlock.clauses) {
          if (ts.isDefaultClause(clause)) hasDefault = true
          else if (ts.isStringLiteralLike(clause.expression)) handled.add(clause.expression.text)
          else {
            bailed = true // computed case label — can't reason about coverage
            return
          }
        }
        result = { handled, hasDefault }
        return
      }
    }
    n.forEachChild(walk)
  }
  walk(body)
  return bailed ? null : result
}

/** Identifier names of a callback's parameters (skips destructured/rest). */
function fnParamNames(fn: ts.Node): string[] {
  if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return []
  return fn.parameters.flatMap((p) => (ts.isIdentifier(p.name) ? [p.name.text] : []))
}

function fnBody(fn: ts.Node): ts.Node | undefined {
  return ts.isArrowFunction(fn) || ts.isFunctionExpression(fn) ? fn.body : undefined
}

/** A pure SINGLE-LEVEL field projection `(p) => p.field` / `(p) => p['field']` —
 * the shape that should be `.at('field')` (a path-narrowed signal depending only
 * on that field) instead of `.map` (which re-reads the whole source). Returns the
 * `{ param, field }` or null. Deliberately matches ONLY a direct property access
 * whose object is the param itself: nested (`p.a.b`), computed (`String(p.x)`,
 * `p.a + p.b`, ternaries, method calls), and `.length`-style derivations fall
 * through to null — those genuinely need `.map`. */
function singleFieldProjection(
  fn: ts.ArrowFunction | ts.FunctionExpression,
): { param: string; field: string } | null {
  if (fn.parameters.length !== 1) return null
  const p = fn.parameters[0]!.name
  if (!ts.isIdentifier(p)) return null
  const param = p.text
  let body: ts.Node = fn.body
  if (ts.isBlock(body)) {
    if (body.statements.length !== 1) return null
    const st = body.statements[0]!
    if (!ts.isReturnStatement(st) || !st.expression) return null
    body = st.expression
  }
  while (ts.isParenthesizedExpression(body)) body = body.expression
  if (
    ts.isPropertyAccessExpression(body) &&
    ts.isIdentifier(body.expression) &&
    body.expression.text === param
  ) {
    return { param, field: body.name.text }
  }
  if (
    ts.isElementAccessExpression(body) &&
    ts.isIdentifier(body.expression) &&
    body.expression.text === param &&
    ts.isStringLiteral(body.argumentExpression)
  ) {
    return { param, field: body.argumentExpression.text }
  }
  return null
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
  const push = (rule: string, message: string, node: ts.Node, fix?: LintFix): void => {
    diags.push({ rule, message, start: node.getStart(sf), length: node.getWidth(sf), fix })
  }

  // A compact, single-line excerpt of an expression for quoting in messages —
  // collapses whitespace and truncates so a long operand doesn't bloat the
  // diagnostic. Quoting the offending text is what lets an LLM patch on the
  // first retry (it can copy the suggested replacement verbatim).
  const snippet = (n: ts.Node): string => {
    const t = n.getText(sf).replace(/\s+/g, ' ').trim()
    return t.length > 48 ? `${t.slice(0, 47)}…` : t
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
      const snip = snippet(expr)
      push(
        'operator-on-signal',
        `Signal \`${snip}\` used in ${ctx}; operate on its value with .map() — e.g. \`${snip}.map(v => …)\` — instead of using the signal directly.`,
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

  // A MAPPED signal expression — the result of `<signal>.map(…)` or `derived(…)`.
  // These carry no statically-known path, so `.at()` on them is unsupported
  // (it throws at runtime and is a compile error in the types). Used to flag the
  // `sig.map(fn).at('x')` foot-gun (`at-after-map`).
  const isMappedSignalExpr = (expr: ts.Expression, roots: Roots): boolean => {
    const e = ts.isParenthesizedExpression(expr) ? expr.expression : expr
    if (!ts.isCallExpression(e)) return false
    if (
      ts.isPropertyAccessExpression(e.expression) &&
      e.expression.name.text === 'map' &&
      isSignalRootedAccess(e.expression.expression, roots)
    ) {
      return true
    }
    return ts.isIdentifier(e.expression) && e.expression.text === 'derived'
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
  // slots, so `peekOk` carries through (handlers within flip it true) — EXCEPT
  // block-body variable declarations: `const isDir = item.peek().type === 'dir'`
  // is the documented render-once row-local idiom, with identical semantics on
  // the authoring path and the compiled factory (wire decls run once per row
  // build), so flagging it would contradict the compiler. Peeks in the returned
  // array's slots stay flagged.
  const visitRender = (
    fn: ts.Node,
    roots: Roots,
    params: readonly string[],
    peekOk: boolean,
  ): void => {
    const body = fnBody(fn)
    if (!body) {
      visit(fn, roots, peekOk)
      return
    }
    const augmented = withParams(roots, params)
    if (ts.isBlock(body)) {
      for (const stmt of body.statements) {
        visit(stmt, augmented, ts.isVariableStatement(stmt) ? true : peekOk)
      }
      return
    }
    visit(body, augmented, peekOk)
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

  // ---- element-level lint: controlled-input + a11y ----
  // Resolve an element-helper call to its tag + props object: `div({...})` /
  // `input({...})` (tag = callee) and `el('input', {...})` (tag = first arg).
  // Returns null for non-element calls (text/el-without-string/structural/etc).
  const elementCall = (
    node: ts.CallExpression,
  ): { tag: string; props: ts.ObjectLiteralExpression | null } | null => {
    const callee = node.expression
    if (
      ts.isIdentifier(callee) &&
      ELEMENT_HELPERS.has(callee.text) &&
      !NON_ELEMENT_HELPERS.has(callee.text)
    ) {
      const a0 = node.arguments[0]
      return { tag: callee.text, props: a0 && ts.isObjectLiteralExpression(a0) ? a0 : null }
    }
    if (ts.isIdentifier(callee) && callee.text === 'el') {
      const a0 = node.arguments[0]
      if (!a0 || !ts.isStringLiteralLike(a0)) return null
      const a1 = node.arguments[1]
      return { tag: a0.text, props: a1 && ts.isObjectLiteralExpression(a1) ? a1 : null }
    }
    return null
  }

  const findProp = (
    obj: ts.ObjectLiteralExpression,
    name: string,
  ): ts.PropertyAssignment | undefined =>
    obj.properties.find(
      (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText(sf) === name,
    )
  const hasProp = (obj: ts.ObjectLiteralExpression, name: string): boolean =>
    obj.properties.some(
      (p) =>
        (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
        p.name.getText(sf) === name,
    )
  // Case-insensitive attribute presence — mirrors the runtime binder, which
  // routes every non-handler prop through `setAttribute`, where HTML attribute
  // names are case-insensitive (so `tabIndex` and `tabindex` bind identically).
  // Handler props are matched EXACTLY by their callers, because the binder only
  // treats `/^on[A-Z]/` as a listener — a lowercase `onclick` is NOT an event
  // handler at runtime. So this helper is for attributes only.
  const hasAttr = (obj: ts.ObjectLiteralExpression, name: string): boolean =>
    obj.properties.some(
      (p) =>
        (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
        p.name.getText(sf).toLowerCase() === name.toLowerCase(),
    )
  // Static string value of a prop, if it's a plain string literal (else undefined).
  const stringPropValue = (obj: ts.ObjectLiteralExpression, name: string): string | undefined => {
    const p = findProp(obj, name)
    return p && ts.isStringLiteralLike(p.initializer) ? p.initializer.text : undefined
  }
  const hasSpread = (obj: ts.ObjectLiteralExpression): boolean =>
    obj.properties.some((p) => ts.isSpreadAssignment(p))
  // The key node + its unquoted text for a (shorthand) property assignment, or
  // null for spreads / computed / numeric keys (not renameable name props).
  const propKey = (p: ts.ObjectLiteralElementLike): { node: ts.Node; text: string } | null => {
    if (!ts.isPropertyAssignment(p) && !ts.isShorthandPropertyAssignment(p)) return null
    const name = p.name
    if (ts.isIdentifier(name) || ts.isStringLiteralLike(name))
      return { node: name, text: name.text }
    return null
  }
  // A rename fix that replaces a key node's span with `to` (a valid identifier
  // key, so it works whether the original was `tabindex:` or `'tabindex':`).
  const renameFix = (nameNode: ts.Node, to: string): LintFix => ({
    title: `Rename to \`${to}\``,
    edits: [{ start: nameNode.getStart(sf), end: nameNode.getEnd(), newText: to }],
  })

  const lintElementCall = (node: ts.CallExpression, roots: Roots): void => {
    const ec = elementCall(node)
    if (!ec || !ec.props) return
    const { tag, props } = ec

    // Attribute / event-handler NAME casing. Checked independently of the spread
    // guard below — a spread can't rename a literally-written key — so these fire
    // even alongside `...attrs`. Each carries a deterministic rename fix.
    for (const p of props.properties) {
      const key = propKey(p)
      if (!key) continue
      const lower = key.text.toLowerCase()

      // event-handler-casing (correctness): a known handler name, miscased. The
      // binder only binds `/^on[A-Z]/`, so `onclick`/`onkeydown` silently never
      // fire — they're written as dead attributes. Rename to the canonical form.
      const canonicalHandler = EVENT_HANDLER_BY_LOWER.get(lower)
      if (canonicalHandler && key.text !== canonicalHandler) {
        push(
          'event-handler-casing',
          `\`${key.text}\` is not bound as an event handler — the runtime only recognizes \`/^on[A-Z]/\` names, so \`${key.text}\` is written as a dead attribute and never fires. Use \`${canonicalHandler}\`.`,
          key.node,
          renameFix(key.node, canonicalHandler),
        )
        continue
      }

      // Attribute-name correction: a camelCase DOM idiom written lowercase
      // (convention — binds fine, auto-fixed) or a React-ism that silently
      // doesn't apply (broken — hard error, with a fix).
      const correction = ATTR_CORRECTIONS.get(lower)
      if (correction && key.text !== correction.to) {
        if (correction.kind === 'convention') {
          push(
            'convention',
            `\`${key.text}\` is a camelCase DOM spelling — LLui authors attributes in their HTML-native lowercase form (like \`class\`/\`for\`/\`aria-*\`). Use \`${correction.to}\`. Both bind identically at runtime; one spelling keeps views consistent.`,
            key.node,
            renameFix(key.node, correction.to),
          )
        } else {
          push(
            'attr-name',
            `\`${key.text}\` does not apply at runtime — LLui uses the HTML-native attribute \`${correction.to}\`. A \`${key.text}\` prop is written verbatim via setAttribute (a dead \`${lower}\` attribute), so its value never takes effect. Rename to \`${correction.to}\`.`,
            key.node,
            renameFix(key.node, correction.to),
          )
        }
      }
    }

    // A spread (`...attrs`) can carry any of the props we check for, so we
    // can't soundly flag missing alt / onInput / role — stay quiet.
    if (hasSpread(props)) return

    // a11y: <img> must have an alt (use `alt: ''` for decorative images).
    if (tag === 'img' && !hasProp(props, 'alt')) {
      push(
        'a11y',
        `<img> is missing an \`alt\` attribute — add \`alt: '…'\` (or \`alt: ''\` for a decorative image) so screen readers can describe it.`,
        node,
      )
    }

    // a11y: onClick on a non-interactive element needs role + tabindex so it is
    // reachable and activatable by keyboard. Two exemptions:
    //  - role="presentation"/"none": the author has explicitly removed the
    //    element from the a11y tree, so it exposes no functionality of its own
    //    (the keyboard story is owned by focusable children). ARIA's
    //    presentational-role conflict resolution also means adding tabindex here
    //    would re-expose native semantics — the opposite of what's wanted.
    //  - tabindex in any casing: `hasAttr` matches it case-insensitively (the
    //    runtime binds it the same way), so a camelCase `tabIndex` still satisfies
    //    keyboard-reachability here. The HTML-native lowercase form is steered
    //    toward by the separate `convention` rule, not by failing a11y.
    const onClick = findProp(props, 'onClick')
    const role = stringPropValue(props, 'role')
    const isPresentational = role === 'presentation' || role === 'none'
    if (
      onClick &&
      !INTERACTIVE_TAGS.has(tag) &&
      !isPresentational &&
      !(hasProp(props, 'role') && hasAttr(props, 'tabindex'))
    ) {
      push(
        'a11y',
        `onClick on a non-interactive <${tag}> is not keyboard-accessible — use a <button>/<a>, add both \`role\` and \`tabindex\` so it can be focused and activated by keyboard, or set \`role: 'presentation'\` if the element exposes no functionality of its own.`,
        onClick.name,
      )
    }

    // controlled-input: a reactive `value` with no onInput/onChange re-asserts
    // state on every update and discards the user's keystrokes.
    if (tag === 'input' || tag === 'textarea') {
      const value = findProp(props, 'value')
      if (
        value &&
        isReactiveSignal(value.initializer, roots) &&
        !hasProp(props, 'onInput') &&
        !hasProp(props, 'onChange')
      ) {
        push(
          'controlled-input',
          `Controlled <${tag}> has a reactive \`value\` but no \`onInput\`/\`onChange\` — the binding overwrites the user's typing on every state update. Add an onInput handler that sends the new value.`,
          value,
        )
      }
    }
  }

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
      let updateFn: ts.ArrowFunction | ts.FunctionExpression | undefined
      for (const prop of node.arguments[0].properties) {
        if (ts.isPropertyAssignment(prop)) {
          const propName = prop.name.getText(sf)
          // async-update: init()/update() must return data synchronously. An
          // async reducer returns a Promise that the runtime treats as state.
          if ((propName === 'init' || propName === 'update') && isAsyncFunction(prop.initializer)) {
            push(
              'async-update',
              `${propName}() must be synchronous and pure — it returns its result as data ([state, effects]); an \`async\` ${propName} returns a Promise that corrupts state. Model async work as an effect handled in onEffect (e.g. @llui/effects http()).`,
              prop.initializer,
            )
          }
          if (
            propName === 'update' &&
            (ts.isArrowFunction(prop.initializer) || ts.isFunctionExpression(prop.initializer))
          ) {
            updateFn = prop.initializer
          }
          if (
            propName === 'view' &&
            (ts.isArrowFunction(prop.initializer) || ts.isFunctionExpression(prop.initializer))
          ) {
            const alias = viewStateAlias(prop.initializer)
            const body = fnBody(prop.initializer)
            if (alias && body) {
              visit(body, singleRoot(alias), false)
              continue
            }
          }
        }
        visit(prop, roots, false) // init/update/onEffect etc.: plain values
      }

      // exhaustive-update: when the Msg union is fully resolvable in this file
      // and update() dispatches via `switch (msg.type)`, flag any variant the
      // switch doesn't handle (and that no `default` would catch).
      const msgArg = node.typeArguments?.[1]
      const updateBody = updateFn ? fnBody(updateFn) : undefined
      const msgParam =
        updateFn && updateFn.parameters[1] && ts.isIdentifier(updateFn.parameters[1].name)
          ? updateFn.parameters[1].name.text
          : null
      if (msgArg && updateBody && msgParam) {
        const variants = collectMsgVariantsLocal(sf, msgArg)
        if (variants && variants.size > 0) {
          const sw = updateSwitchCases(updateBody, msgParam)
          if (sw && !sw.hasDefault) {
            const missing = [...variants].filter((v) => !sw.handled.has(v))
            if (missing.length > 0) {
              push(
                'exhaustive-update',
                `update() does not handle message type(s) ${missing
                  .map((m) => `'${m}'`)
                  .join(
                    ', ',
                  )} — add a case for each (or a \`default\` branch). An unhandled message silently no-ops.`,
                updateFn!,
              )
            }
          }
        }
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

    // element-level lint (controlled-input, a11y) on element-helper calls
    if (ts.isCallExpression(node)) lintElementCall(node, roots)

    // peek-in-slot: a non-reactive snapshot used in a reactive slot (renders
    // once, never updates). Legitimate inside event handlers / derive bodies.
    if (!peekOk && isSignalPeek(node, roots)) {
      // `node` is `<receiver>.peek()` — quote the receiver so the suggested fix
      // is the user's actual signal, and offer the two reactive replacements:
      // `.at('field')` to track a sub-field, `.map(v => …)` to derive a value.
      // For a DELIBERATE one-shot read (keyed remount, value-shape dispatch) the
      // sanctioned shape is a block-body render `const` (already allowed: peekOk
      // flips true for render var-decls), with helpers taking the plain snapshot
      // value — NOT the live signal. Naming that path here keeps people off the
      // laundering trick (wrap in a fn whose param isn't `state`), which would
      // re-open the bypass the non-bypassable-error design exists to prevent.
      const recv = snippet(
        ((node as ts.CallExpression).expression as ts.PropertyAccessExpression).expression,
      )
      push(
        'peek-in-slot',
        `\`${recv}.peek()\` in a reactive slot reads once and never updates. For reactivity use \`${recv}.at('field')\` to track a sub-field, or \`${recv}.map(v => …)\` to derive a value. For a deliberate one-shot read, snapshot it in a block-body render \`const\` (\`render: (item) => { const v = ${recv}.peek(); return […] }\`) and pass the plain value into helpers — don't .peek() inside a helper that takes the live signal. Keep .peek() for event handlers/effects.`,
        node,
      )
    }

    // operator-on-signal
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind
      if (op !== ts.SyntaxKind.EqualsToken) {
        const ctx = `an operator expression (${node.operatorToken.getText(sf)})`
        checkOperand(node.left, ctx, roots)
        checkOperand(node.right, ctx, roots)
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

    // .map / derived bodies — only a `.map` on a SIGNAL is a reactive derive.
    // A plain Array.map (e.g. `OPTS.map(k => option(...))`) runs once at build
    // time and is a legitimate way to spread a static child list, so it must
    // not trip the derive-body rules. (DOM built by an Array.map *inside* a
    // signal `.map` body is still caught: lintDeriveBody walks the whole body.)
    if (ts.isCallExpression(node)) {
      // at-after-map: `sig.map(fn).at('x')` / `derived(…).at('x')` — a mapped
      // signal has no statically-known path to slice. Steer to slicing FIRST.
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'at' &&
        isMappedSignalExpr(node.expression.expression, roots)
      ) {
        push(
          'at-after-map',
          `.at() after .map()/derived() has no statically-known path to slice — slice with .at() BEFORE mapping: \`sig.at('field').map(fn)\`, not \`sig.map(fn).at('field')\`.`,
          node.expression.name,
        )
      }
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'map' &&
        isSignalRootedAccess(node.expression.expression, roots)
      ) {
        const fn = node.arguments[0]
        if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) {
          lintDeriveBody(fn, roots)
          // A plain single-field projection should narrow with `.at`, not `.map`.
          const proj = singleFieldProjection(fn)
          if (proj) {
            push(
              'prefer-at-over-map',
              `Use .at('${proj.field}') instead of .map((${proj.param}) => ${proj.param}.${proj.field}) — .at narrows to a signal that depends only on '${proj.field}', while .map re-reads the whole source on any change.`,
              node,
            )
          }
        }
      }
      if (ts.isIdentifier(node.expression) && node.expression.text === 'derived') {
        const fn = node.arguments[1]
        if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) lintDeriveBody(fn, roots)
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
  /** Present iff the diagnostic is mechanically fixable (see {@link LintFix}). */
  fix?: LintFix
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
      ...(d.fix ? { fix: d.fix } : {}),
    }
  })
}

/**
 * Apply the fixes carried by `messages` to `source`, returning the rewritten
 * code and how many fixes applied vs. were skipped (overlapping with one already
 * applied). Messages without a `fix` are ignored, so a caller can pass a filtered
 * subset (e.g. only `convention` diagnostics) to apply just those. Pure — does
 * not re-lint; the caller decides whether a second pass is warranted.
 */
export function applyLintFixes(
  source: string,
  messages: ReadonlyArray<{ fix?: LintFix }>,
): { code: string; applied: number; skipped: number } {
  const edits: TextEdit[] = []
  for (const m of messages) {
    if (!m.fix) continue
    for (const e of m.fix.edits) edits.push({ start: e.start, end: e.end, text: e.newText })
  }
  if (edits.length === 0) return { code: source, applied: 0, skipped: 0 }
  const { kept, skipped } = mergeNonOverlapping(edits)
  return { code: applyTextEdits(source, kept), applied: kept.length, skipped }
}
