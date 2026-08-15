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
//   empty-props       — `div({}, [...])`: a throwaway empty object literal in the
//                       props position. The element helpers already take a
//                       children-only call (`div([...])`), so the `{}` buys
//                       nothing and costs one allocation per call plus a
//                       `lowerProps({})` key walk on the element MOUNT path — the
//                       hot path for list rendering (issue #82, same class as #58).
//                       Performance + noise; has a fix (blocking, like attr-name).
//   agent-annotation-syntax — a malformed agent annotation (`@intent`/`@example`/
//                       `@warning`/`@emits`/`@routeGated`/`@should`/`@validates`):
//                       an unescaped quote inside the string, an unterminated
//                       string, an unquoted argument, wrong arity. The grammar
//                       DROPS what it can't read unambiguously, and a dropped
//                       `@routeGated` is an ungated action while a dropped
//                       `@validates` is an unchecked field — both silent at
//                       runtime, so the build is the only place to say so
//                       (issue #89; the audit's `agent-validates-syntax`,
//                       generalized to every tag in the shared grammar).
//   tag-send-drift    — a `tagSend(send, ['x'], () => send({type:'y'}))` whose
//                       hand-written variant list disagrees with the `type` its
//                       own handler dispatches. That list becomes
//                       `__lluiVariants`, which the agent/devtools surface reads
//                       to tell an LLM which Msg variants a control can emit, so
//                       a drifted tag is a string that LIES to a model — silent
//                       at runtime, like #89 and #92 (issue #118).
//
// Each diagnostic has a message, a source position (start offset + length), and —
// for the rename-style rules above — a `fix` (see {@link LintFix}/{@link applyLintFixes}).

import ts from 'typescript'
import { isSignalExpr, singleRoot, unwrapCasts, STATE_ROOTS, type Roots } from './extract-deps.js'
import { applyTextEdits, mergeNonOverlapping, type TextEdit } from './apply-edits.js'
import { ELEMENT_HELPERS as ELEMENT_TAGS, ALL_ELEMENT_HELPERS } from './element-helpers.js'
import { HelperBindings, bindingNames, scopeIntroduces } from './helper-bindings.js'
import { ANNOTATION_TAGS, scanAnnotationCalls } from '../annotation-args.js'
import type { ParsedModule } from '../parse.js'

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
// Callees that construct a DOM node inside a .map/derived body (no-node-construction):
// every element tag plus the text-node helpers. `ELEMENT_TAGS` is the shared set
// (element-helpers.ts) so this can't drift from the transform's lowering list.
const NODE_HELPERS = new Set<string>([...ELEMENT_TAGS, 'text', 'el', 'signalText'])
const REACTIVE_METHODS = new Set(['peek', 'at', 'map'])
// Elements that are natively focusable/clickable — an onClick on these needs no
// extra role/tabIndex for keyboard accessibility.
// `summary` is natively interactive: it toggles its parent `<details>` and is
// keyboard-focusable/activatable (Enter/Space) with no author-supplied
// role/tabindex, so an `onClick` on it is fine. `label` forwards activation to
// its associated control (which carries the keyboard story), so it's exempt too.
const INTERACTIVE_TAGS = new Set([
  'button',
  'a',
  'input',
  'select',
  'textarea',
  'option',
  'summary',
  'label',
])
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
// `ElEventMap` — kept here independently (like `ELEMENT_TAGS`) so the compiler
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
// No signal roots — used to lint reducer/effect bodies, whose params are plain values.
const EMPTY_ROOTS: Roots = new Map()

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

/** Names a node introduces into its child scope that would SHADOW an outer root:
 * a function-like node's parameters, and a block's local variable declarations.
 * Rooting is scope-aware — when a param/local rebinds a root name (e.g. a reducer
 * `update: (state, msg) => …`, where `state` is a PLAIN value), the root is
 * dropped for that subtree so the lint doesn't treat the plain value as a signal.
 * Mirrors the scope-shadowing the accessor analyzer (analyze-deps.ts) already does. */
function scopeShadowedNames(node: ts.Node): string[] {
  if (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  ) {
    return node.parameters.flatMap((p) => bindingNames(p.name))
  }
  // A Block or the SourceFile itself introduces its `const`/`let`/`var` names into
  // scope — a module-scope `const state = […]` must shed the root so a plain value
  // named like a signal root isn't linted as one.
  if (ts.isBlock(node) || ts.isSourceFile(node)) {
    const out: string[] = []
    for (const st of node.statements) {
      if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) out.push(...bindingNames(d.name))
      }
    }
    return out
  }
  return []
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
  // Per-file `@llui/dom` binding set — gates framework-call recognition so a
  // user's own function named `text`/`each`/`div`, or an aliased import, is
  // treated correctly (see helper-bindings.ts). A `null` resolution means the
  // callee is not a framework helper and the helper-specific rules skip it.
  const bindings = HelperBindings.fromSourceFile(sf)
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
    return ts.isIdentifier(e.expression) && bindings.resolve(e.expression) === 'derived'
  }

  // ---- inside a .map/derived body: pure-derive + no-node-construction ----
  const lintDeriveBody = (fn: ts.ArrowFunction | ts.FunctionExpression, roots: Roots): void => {
    const body = fn.body
    const walk = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const callee = n.expression
        if (ts.isIdentifier(callee)) {
          const canon = bindings.resolve(callee)
          if (canon !== null && NODE_HELPERS.has(canon)) {
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
    const canon = ts.isIdentifier(callee) ? bindings.resolve(callee) : null
    if (canon !== null && ELEMENT_TAGS.has(canon)) {
      const a0 = node.arguments[0]
      return { tag: canon, props: a0 && ts.isObjectLiteralExpression(a0) ? a0 : null }
    }
    if (canon === 'el') {
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
  // A prop present with a value that is NOT the literal `false` — used to exempt
  // readonly/disabled inputs from controlled-input (an un-typeable input's reactive
  // value legitimately re-asserts state). A shorthand (`{ readonly }`) counts as truthy.
  const hasTruthyProp = (obj: ts.ObjectLiteralExpression, name: string): boolean =>
    obj.properties.some((p) => {
      if (ts.isShorthandPropertyAssignment(p)) return p.name.getText(sf) === name
      if (ts.isPropertyAssignment(p) && p.name.getText(sf) === name) {
        return p.initializer.kind !== ts.SyntaxKind.FalseKeyword
      }
      return false
    })
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

  // ---- empty-props: a throwaway `{}` in an element helper's props position ----
  //
  // The element helpers dispatch on their first argument (`Array.isArray(a0)` in
  // `elementHelper`), so the children-only call `div([…])` is already supported.
  // A `{}` in the props position therefore buys nothing and costs one object
  // literal per call plus a `lowerProps({})` key walk on the element MOUNT path —
  // the hot path for list rendering (issue #82).
  //
  // "Genuinely empty" is decided SYNTACTICALLY and as narrowly as possible: the
  // argument node must ITSELF be an `ObjectLiteralExpression` with zero
  // `properties`. Consequences, all of them deliberate:
  //   • `{ ...attrs }` — a spread is a property element, so `properties.length`
  //     is 1 and the literal never matches (the spread source may be non-empty).
  //   • `cond ? {} : props`, `props`, `makeProps()`, `{} as ElProps` — none is an
  //     object-literal NODE, so none is reached. The rule never reasons about
  //     what an expression might EVALUATE to; a false positive here fails a valid
  //     build, which is strictly worse than missing a case.
  //   • `el('div', {}, …)` is NOT covered: `el`'s props parameter is positional
  //     with a `= {}` default, so omitting it allocates exactly the same object.
  //     There is nothing to save and no children-only form to rewrite to.
  //
  // The CHILDREN argument is checked too, and this is load-bearing: the rewrite
  // `tag({}, c)` → `tag(c)` re-dispatches `c` through the helper's overloads, and
  // that only typechecks when `c` is provably `readonly ChildNode[]`. It is not,
  // for the common
  //     function card(children?: Renderable) { return div({}, children) }
  // — which COMPILES today, because the two-argument overload's `children` is
  // optional, but whose rewrite `div(children)` matches NEITHER overload
  // (`Renderable | undefined` isn't `readonly ChildNode[]`; `Renderable` isn't
  // `ElProps`). The correct rewrite there is `div(children ?? [])`, which the rule
  // cannot know. A string-edit lint has no checker, so the only sound syntactic
  // proxy is an ARRAY LITERAL in the children position — `tag({}, [ … ])`, whose
  // rewrite is `tag([ … ])` by construction. `tag({}, anythingElse)` is left
  // alone: emitting a fix we cannot prove typechecks is worse than missing a
  // site, because `@llui/mcp` serializes `fix.edits` straight to LLM clients
  // (tools/source.ts, tools/debug-api.ts) which apply them unreviewed.
  // NAMESPACED (SVG) helpers are covered identically — `ALL_ELEMENT_HELPERS`, not
  // the lowering-only `ELEMENT_TAGS` — because they share the same call forms.
  const lintEmptyProps = (node: ts.CallExpression): void => {
    const callee = node.expression
    if (!ts.isIdentifier(callee)) return
    const canon = bindings.resolve(callee)
    if (canon === null || !ALL_ELEMENT_HELPERS.has(canon)) return
    // Only the two provably-rewritable shapes: `tag({})` and `tag({}, [ … ])`.
    const args = node.arguments
    if (args.length < 1 || args.length > 2) return
    const props = args[0]!
    if (!ts.isObjectLiteralExpression(props) || props.properties.length > 0) return
    if (args.length === 2 && !ts.isArrayLiteralExpression(args[1]!)) return

    const name = callee.text
    const children = args[1]
    // Delete the props argument AND its separator. With children, that is
    // everything up to where the children argument starts; without, everything up
    // to the closing paren (which also sweeps up a trailing comma — `div({},)`
    // would otherwise be fixed into the syntax error `div(,)`).
    const end = children ? children.getStart(sf) : node.getEnd() - 1
    const fix: LintFix = {
      title: 'Remove the empty props object',
      edits: [{ start: props.getStart(sf), end, newText: '' }],
    }
    const lead = children
      ? `\`${name}({}, …)\` passes an empty props object — the element helpers accept a children-only call, so write \`${name}(…)\` with just the children.`
      : `\`${name}({})\` passes an empty props object — the props argument is optional, so write \`${name}()\`.`
    push(
      'empty-props',
      `${lead} An empty \`{}\` allocates a throwaway object on every call and routes through \`lowerProps({})\` instead of \`lowerProps(undefined)\` on the element mount path — the hot path for list rendering.`,
      props,
      fix,
    )
  }

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
        !hasProp(props, 'onChange') &&
        // readonly / disabled inputs can't be typed into, so re-asserting state is fine
        !hasTruthyProp(props, 'readonly') &&
        !hasTruthyProp(props, 'disabled')
      ) {
        push(
          'controlled-input',
          `Controlled <${tag}> has a reactive \`value\` but no \`onInput\`/\`onChange\` — the binding overwrites the user's typing on every state update. Add an onInput handler that sends the new value.`,
          value,
        )
      }
    }

    // controlled-input (checkbox/radio): a reactive `checked` with no
    // onChange/onInput has the same overwrite bug as `value` — the binding
    // re-asserts state on every update and discards the user's toggle.
    if (tag === 'input') {
      const checked = findProp(props, 'checked')
      if (
        checked &&
        isReactiveSignal(checked.initializer, roots) &&
        !hasProp(props, 'onInput') &&
        !hasProp(props, 'onChange') &&
        // readonly / disabled inputs can't be toggled, so re-asserting state is fine
        !hasTruthyProp(props, 'readonly') &&
        !hasTruthyProp(props, 'disabled')
      ) {
        push(
          'controlled-input',
          `Controlled <input> has a reactive \`checked\` but no \`onChange\`/\`onInput\` — the binding overwrites the user's toggle on every state update. Add an onChange handler that sends the new checked state.`,
          checked,
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
      bindings.resolveCall(node) === 'component' &&
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
          // Reducer/effect bodies operate on PLAIN values (their params are the
          // current state / message / effect, not signals) — lint them with NO
          // signal roots so a param named `state` isn't treated as a signal.
          if (propName === 'init' || propName === 'update' || propName === 'onEffect') {
            visit(prop, EMPTY_ROOTS, false)
            continue
          }
        }
        visit(prop, roots, false) // other config props: plain values
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
    if (ts.isCallExpression(node)) {
      const callee = bindings.resolveCall(node)
      if (callee === 'each') return visitEach(node, roots, peekOk)
      if (callee === 'show') return visitShow(node, roots, peekOk)
      if (callee === 'branch') return visitBranch(node, roots, peekOk)
    }

    // element-level lint (controlled-input, a11y) on element-helper calls
    if (ts.isCallExpression(node)) {
      lintElementCall(node, roots)
      lintEmptyProps(node)
    }

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
      if (ts.isIdentifier(node.expression) && bindings.resolve(node.expression) === 'derived') {
        const fn = node.arguments[1]
        if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) lintDeriveBody(fn, roots)
      }
    }

    // Scope-aware rooting: drop any root name this node's params/locals rebind,
    // so a plain value that happens to be named like a root isn't linted as a signal.
    let childRoots = roots
    const shadowed = scopeShadowedNames(node)
    if (shadowed.some((n) => roots.has(n))) {
      const m = new Map(roots)
      for (const n of shadowed) m.delete(n)
      childRoots = m
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
        const isDerived =
          ts.isIdentifier(node.expression) && bindings.resolve(node.expression) === 'derived'
        if ((isMap && c === node.arguments[0]) || (isDerived && c === node.arguments[1])) {
          childPeek = true
        }
      }
      visit(c, childRoots, childPeek)
    })
  }
  // Seed `state` as a signal root by convention, but `scopeShadowedNames` sheds it
  // wherever a local binding (module-scope `const state = […]`, a method param, etc.)
  // rebinds the name to a plain value — so only a free/ambient `state` (the component
  // signal) is linted as a signal.
  visit(sf, STATE_ROOTS, false)
  diags.push(...annotationSyntaxDiagnostics(sf))
  // Same cost discipline as `lintTagSendSource` (#93): `tagSend` is a
  // LIBRARY-author helper, so almost no component file contains one, and the
  // drift walk is a full extra pass over the tree on every keystroke-save.
  // `sf.text` is already in hand here — no parse, one substring search.
  if (sf.text.includes('tagSend')) diags.push(...tagSendDriftDiagnostics(sf, bindings))
  return diags
}

// A cheap pre-check so a file with no agent annotation at all never pays for
// the comment walk. Mirrors the call form the grammar recognizes (`@tag(`).
const ANNOTATION_CALL_PRECHECK = new RegExp(
  `@(?:${Object.keys(ANNOTATION_TAGS).join('|')})[ \\t]*\\(`,
)

/**
 * The two tags whose first argument is compiled and RUN at the agent boundary,
 * with the name it is bound to there (`list-actions.ts` / `validate-payload.ts`).
 */
const PREDICATE_TAGS: Readonly<Record<string, string>> = {
  routeGated: 'state',
  validates: 'v',
}

/**
 * Borrow the JS parser to check a predicate string, exactly as the runtime
 * will wrap it. Returns the parse error's message, or null when it parses.
 * The constructed function is DISCARDED — nothing is evaluated here.
 */
function predicateSyntaxError(src: string, boundName: string): string | null {
  try {
    new Function(boundName, `return (${src})`)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : 'syntax error'
  }
}

/**
 * ---- agent-annotation-syntax: a malformed agent annotation ----
 *
 * The rule the #36 audit called for as `agent-validates-syntax`, generalized:
 * it covers every tag in the shared annotation grammar (`annotation-args.ts`),
 * not just `@validates`, because all seven parsers share one tokenizer now.
 *
 * WHY IT MUST BE A BUILD ERROR: an annotation the grammar cannot read
 * unambiguously is DROPPED (never half-read). Dropping is the safe outcome for
 * the parser but not for the author — a dropped `@routeGated` is an ungated
 * variant the agent may dispatch, and a dropped `@validates` is a field nobody
 * checks. Both are invisible at runtime (the agent boundary catches its
 * `new Function` failures and degrades to "allow"), so the build is the only
 * place the author can still be told (issue #89).
 *
 * TWO CHECKS, because a well-formed annotation is not automatically a working
 * one:
 *   1. the ARGUMENT GRAMMAR (`annotation-args.ts`), and
 *   2. for the two PREDICATE tags, that the captured string is parseable
 *      JavaScript. `@routeGated("")`, `@validates("")` and an unbalanced paren
 *      (`@validates("f(v)) === 1")`) sail through the grammar and then fail the
 *      boundary's `new Function`, which degrades to gate-open / accept-all —
 *      the very outcome this issue exists to prevent, reached by an ordinary
 *      typo. The check CONSTRUCTS a function to borrow the JS parser and
 *      throws the result away; it never calls it, so nothing is evaluated at
 *      build time.
 *
 * `@example` additionally accepts a bare JSON object/array literal
 * (`@example({"type":"inc"})` — issue #98), which the grammar validates as
 * JSON for the same reason check 2 exists: a balanced-but-not-JSON literal
 * reads fine and then hands an LLM a payload it cannot use.
 *
 * BOTH `@example` spellings stay supported permanently and produce the same
 * value, rather than one replacing the other: the quoted form is the only one
 * that can carry prose or a `send(…)` snippet, and the JSON form is the only
 * one an author writes without escaping every inner quote. The convention is
 * JSON for payloads, quoted for everything else — and this repo's own payload
 * examples (`packages/agent-e2e/src/host.ts`) use the JSON form, because a
 * source that contradicts the documented preference is what an LLM copies.
 *
 * SCOPE — deliberately narrow, and this is the false-positive story: only
 * `/** … *\/` blocks in the positions the extractors actually READ are checked
 * — a type alias, each member of its union, and any property signature. JSDoc
 * on a function/const/parameter is PROSE (this repo's own sources document the
 * grammar with `@emits("k1", "k2", ...)` and `@validates(...)` placeholders),
 * and an annotation there would be inert anyway, so flagging it would fail
 * valid builds for no safety gain. A line comment, a plain `/* *\/` block, and
 * a string literal are never comments the extractors read, so they are never
 * flagged either. A tag NOT in the call form (standard block-form `@example`
 * followed by a code block) is not an annotation at all and is left alone.
 *
 * THE ONE ACCEPTED FALSE POSITIVE: prose in a SCANNED position that opens a
 * paren right after a tag — `@example (see the docs)` on a Msg variant — reads
 * as a malformed call and errors. That is the deliberate price of catching
 * `@validates(v > 0)`, which is an author reaching for the annotation and
 * getting silence; the two shapes are indistinguishable without guessing
 * intent. A scan of 61,308 real files (this repo plus 60k `node_modules`
 * sources) found ZERO occurrences, so the trade is heavily one-sided — but it
 * IS a trade, and it is written down here rather than discovered later.
 */
function annotationSyntaxDiagnostics(sf: ts.SourceFile): SignalDiagnostic[] {
  if (!ANNOTATION_CALL_PRECHECK.test(sf.text)) return []
  const out: SignalDiagnostic[] = []
  const seen = new Set<number>()
  const scanAt = (pos: number): void => {
    for (const range of ts.getLeadingCommentRanges(sf.text, pos) ?? []) {
      if (range.kind !== ts.SyntaxKind.MultiLineCommentTrivia) continue
      if (seen.has(range.pos)) continue
      seen.add(range.pos)
      const text = sf.text.slice(range.pos, range.end)
      if (!text.startsWith('/**')) continue
      const scan = scanAnnotationCalls(text)
      for (const err of scan.errors) {
        out.push({
          rule: 'agent-annotation-syntax',
          message: err.message,
          start: range.pos + err.start,
          length: err.length,
        })
      }
      for (const call of scan.calls) {
        const bound = PREDICATE_TAGS[call.tag]
        if (bound === undefined) continue
        const src = call.args[0]
        if (src === undefined) continue
        const failure = predicateSyntaxError(src, bound)
        if (failure === null) continue
        out.push({
          rule: 'agent-annotation-syntax',
          message:
            `\`@${call.tag}("${src}")\` is not a valid JavaScript expression (${failure}). ` +
            `The runtime compiles it as \`new Function('${bound}', 'return (' + src + ')')\`; ` +
            'a predicate that does not parse degrades to ' +
            (call.tag === 'routeGated' ? 'an ALWAYS-OPEN gate' : 'ACCEPT-EVERYTHING validation') +
            ` at the agent boundary. Write an expression in \`${bound}\` that returns a boolean.`,
          start: range.pos + call.start,
          length: call.length,
        })
      }
    }
  }
  const walk = (node: ts.Node): void => {
    if (ts.isTypeAliasDeclaration(node)) {
      // The alias's own JSDoc, then one scan position per union member —
      // mirroring `extractMsgAnnotations` / `readLeadingJSDocForMember`: a
      // member's JSDoc sits BEFORE its `|` separator, which is not part of the
      // member node, so the scan starts at the previous member's `end` (and at
      // the alias body's `pos` for the first).
      scanAt(node.pos)
      const body = node.type
      if (ts.isUnionTypeNode(body)) {
        body.types.forEach((_m, i) => {
          const prev = i === 0 ? undefined : body.types[i - 1]
          scanAt(prev === undefined ? body.pos : prev.end)
        })
      } else {
        scanAt(body.pos)
      }
    } else if (ts.isPropertySignature(node)) {
      // `@should` / `@validates` on a Msg or State field.
      scanAt(node.pos)
    }
    node.forEachChild(walk)
  }
  walk(sf)
  out.sort((a, b) => a.start - b.start)
  return out
}

/**
 * ---- tag-send-drift: a `tagSend` variant list that disagrees with its handler ----
 *
 * `tagSend(send, ['touch'], () => send({ type: 'touch', field: name }))` states
 * the same fact TWICE, and until this rule nothing checked that the two agree.
 * The compiler-emitted tags cannot drift — they are derived from the `send`
 * call itself — but every HAND-WRITTEN call site in `@llui/components`,
 * `@llui/agent` and `@llui/markdown-editor` (and in any consumer writing their
 * own `connect`) carries the variant names as free-standing string literals.
 *
 * WHY IT MUST BE A BUILD ERROR: `__lluiVariants` is read at
 * `packages/dom/src/signals/element.ts` and feeds the agent/devtools surface —
 * it is how an agent learns which Msg variants a control can emit. A drifted
 * tag is therefore a string that LIES to a model, silently, with no runtime
 * symptom: the same class as #89 (a truncated predicate at the agent boundary)
 * and #92 (an analyzer returning wrong dependency answers). A type-level fix
 * (`readonly M['type'][]`) catches a MISSPELLING but not drift — `'touch'` and
 * `'blur'` are both valid `M['type']`, so only reading the handler can tell
 * them apart. Hence a rule, on top of the narrowed signature.
 *
 * TWO DIRECTIONS, with different soundness, and the asymmetry is the whole
 * design — a false positive here blocks a valid library build:
 *
 *   1. DISPATCHED-BUT-UNDECLARED is checked whenever the dispatch is
 *      ATTRIBUTABLE to this call: a literal `send({type:'x'})` where `send`
 *      still resolves to the dispatcher that was tagged, in code that runs when
 *      the handler runs. Under those two conditions the dispatch provably
 *      happens and a list omitting `'x'` understates the handler no matter what
 *      else the body does. Both conditions are real constraints, not
 *      paperwork — a `send` rebound by an inner scope is a DIFFERENT function
 *      (see {@link scanHandlerDispatches}), and a function that is merely
 *      RETURNED does not run — and getting either wrong reports a variant the
 *      control cannot emit.
 *   2. DECLARED-BUT-NEVER-DISPATCHED is checked ONLY when the handler's
 *      dispatch set is provably COMPLETE, because "I did not see it" is not
 *      "it does not happen": `tagSend(send, ['commit'], (e) =>
 *      commitFromEvent(e))` dispatches one call away, and flagging it would
 *      fail a valid build. Completeness requires every call in the body to be
 *      either a readable dispatch or an inert event method on one of the
 *      handler's own parameters ({@link isInertParameterMethodCall} — an
 *      allowlist, `e.preventDefault()` and two siblings, and nothing else).
 *      ANY other call, a tagged template, a `new`, a returned function, a
 *      dispatch with an unreadable payload, or one mention of the dispatcher
 *      outside callee position forfeits it.
 *
 * When the two directions disagree about a shape, BAIL: an unreported drift is
 * a missed lint, a false positive is a build this rule breaks for a consumer
 * who did nothing wrong.
 *
 * The whole rule bails — reporting nothing — unless all three arguments are
 * readable: an identifier dispatcher, an array literal of string literals, and
 * an inline function. A spread/computed list, a named-function handler, or a
 * `tagSend` of another arity is invisible to this analysis, not a violation.
 */
function tagSendDriftDiagnostics(sf: ts.SourceFile, bindings: HelperBindings): SignalDiagnostic[] {
  const out: SignalDiagnostic[] = []
  const push = (message: string, node: ts.Node): void => {
    out.push({
      rule: 'tag-send-drift',
      message,
      start: node.getStart(sf),
      length: node.getWidth(sf),
    })
  }

  const walk = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && bindings.resolveCall(node) === 'tagSend') {
      checkTagSendCall(node, push, bindings)
    }
    node.forEachChild(walk)
  }
  walk(sf)
  out.sort((a, b) => a.start - b.start)
  return out
}

/** One readable dispatch found in a handler body, plus the node to point at. */
interface SeenDispatch {
  variant: string
  node: ts.Node
}

function checkTagSendCall(
  call: ts.CallExpression,
  push: (message: string, node: ts.Node) => void,
  bindings: HelperBindings,
): void {
  if (call.arguments.length !== 3) return
  const [dispatcher, list, handler] = call.arguments
  if (dispatcher === undefined || list === undefined || handler === undefined) return
  // The dispatcher must be a plain identifier: it is the only thing that lets a
  // call inside the handler be attributed to THIS tag.
  if (!ts.isIdentifier(dispatcher)) return
  if (!ts.isArrowFunction(handler) && !ts.isFunctionExpression(handler)) return

  const declared = readVariantList(list)
  if (declared === null) return

  const scan = scanHandlerDispatches(handler, dispatcher.text, bindings)

  // Direction 1 — sound unconditionally.
  for (const seen of scan.dispatches) {
    if (declared.some((d) => d.value === seen.variant)) continue
    push(
      `\`tagSend\` dispatches \`{ type: '${seen.variant}' }\` but its variant list is ` +
        `[${declared.map((d) => `'${d.value}'`).join(', ')}] — add '${seen.variant}' to the list, ` +
        'or fix the dispatched type. That list becomes `__lluiVariants`, which the agent/devtools ' +
        'surface reads to tell an LLM which Msg variants this control can emit; a list that ' +
        'disagrees with the handler lies to the agent, silently and with no runtime symptom.',
      seen.node,
    )
  }

  // Direction 2 — only when nothing in the body could dispatch unseen.
  if (!scan.complete) return
  for (const tag of declared) {
    if (scan.dispatches.some((s) => s.variant === tag.value)) continue
    push(
      `\`tagSend\` declares variant '${tag.value}' but its handler never dispatches ` +
        `\`{ type: '${tag.value}' }\` — remove it from the list, or dispatch it. That list becomes ` +
        '`__lluiVariants`, which the agent/devtools surface reads to tell an LLM which Msg ' +
        'variants this control can emit; a variant it cannot actually emit lies to the agent.',
      tag.node,
    )
  }
}

/** The variant list, or null when any element is not a plain string literal
 * (a spread, a computed name, an identifier) — unreadable is not a violation.
 *
 * Read through `as const` / `satisfies` / parentheses first, via the same
 * {@link unwrapCasts} the dep analyzer uses — one unwrap helper, as with #96's
 * parenthesized types. An assertion is ERASED, so the array literal underneath
 * is exactly what reaches `__lluiVariants` at runtime, and its elements are
 * still checked below. Skipping this made the rule bail on the very spelling
 * the narrowed `readonly M['type'][]` signature pushes authors toward — the
 * type asking for `as const` while the rule silently switched itself off for
 * that call site. The unwrap does NOT resolve bindings: a hoisted `VARIANTS`
 * is still unreadable, `as const` or not. */
function readVariantList(expr: ts.Expression): { value: string; node: ts.Node }[] | null {
  const list = unwrapCasts(expr)
  if (!ts.isArrayLiteralExpression(list)) return null
  const out: { value: string; node: ts.Node }[] = []
  for (const el of list.elements) {
    if (!ts.isStringLiteralLike(el)) return null
    out.push({ value: el.text, node: el })
  }
  return out
}

/**
 * Every readable `dispatcher({type: '…'})` inside `handler`, plus whether the
 * set is COMPLETE — i.e. whether anything in the body could dispatch a variant
 * this scan did not see. See the rule's doc comment for why the two answers
 * carry different weight.
 *
 * Nested functions are walked: `setTimeout(() => send({type:'tick'}))` really
 * does dispatch `tick`. That same `setTimeout(…)` is a bare-identifier call, so
 * it also costs completeness — correct on both counts.
 *
 * SCOPE-AWARENESS is what makes direction 1 sound, and it is the one thing this
 * walk cannot re-derive by hand. `dispatcherName` identifies the tagged
 * dispatcher only while that name still RESOLVES to it: inside
 * `items.forEach(({ send }) => send({type:'inner'}))` or after a
 * `const send = other`, the same spelling is a DIFFERENT function, and
 * attributing its dispatches to this tag reports a variant the control cannot
 * emit. The prune uses {@link scopeIntroduces} — the repo's most complete
 * shadowing predicate (params, block `const`/`let`/`var`, hoisted
 * `function`/`class`, `for` initializers, `catch`) — because re-deriving
 * shadowing per walker is how the cases at the end of that list get forgotten.
 * Below a rebinding scope the subtree is still walked (its calls still cost
 * completeness); only the dispatcher ATTRIBUTION stops.
 *
 * The scan covers the handler's PARAMETER LIST as well as its body, and both
 * halves of that matter. The parameters are a binding scope — the nearest one,
 * so the shadowing prune has to start at the handler node itself or it misses
 * the case it exists for — and a parameter DEFAULT is ordinary code that runs
 * on every call, so a call there costs completeness and a dispatcher mention
 * there escapes. "Default" means every position one can be written in,
 * INCLUDING inside a binding pattern (`({ x = compute() })`), which lives under
 * `p.name` rather than `p.initializer`.
 *
 * A nested `tagSend` is likewise not this call's business: the inner call is
 * checked on its own, so its handler is skipped rather than folded into the
 * outer tag's dispatch set.
 */
function scanHandlerDispatches(
  handler: ts.ArrowFunction | ts.FunctionExpression,
  dispatcherName: string,
  bindings: HelperBindings,
): { dispatches: SeenDispatch[]; complete: boolean } {
  const dispatches: SeenDispatch[] = []
  let complete = true
  // The handler's own parameter names — see {@link isInertParameterMethodCall}.
  const params = new Set(handler.parameters.flatMap((p) => bindingNames(p.name)))

  // `live` is false once the walk is inside a scope that REBINDS the dispatcher
  // name; the identifier there denotes something else entirely.
  const walk = (n: ts.Node, live: boolean): void => {
    const inScope = live && !scopeIntroduces(n, dispatcherName)

    if (inScope && ts.isIdentifier(n) && n.text === dispatcherName && !isCalleeOf(n)) {
      // The dispatcher escaping as a VALUE (`helper(send)`, `{ onX: send }`)
      // means dispatches can happen out of sight.
      complete = false
    }
    // Neither is a CallExpression, so the walk used to step straight past both
    // while keeping completeness — and both run arbitrary code that can reach
    // the dispatcher. A tag function receives the interpolations; a constructor
    // body is ordinary code.
    if (ts.isTaggedTemplateExpression(n) || ts.isNewExpression(n)) complete = false

    if (ts.isCallExpression(n)) {
      if (inScope && ts.isIdentifier(n.expression) && n.expression.text === dispatcherName) {
        const variant = literalMsgType(n.arguments[0])
        if (variant === null) complete = false
        else dispatches.push({ variant, node: n.arguments[0] ?? n })
      } else if (!isInertParameterMethodCall(n, params)) {
        complete = false
      }
      if (bindings.resolveCall(n) === 'tagSend' && n.arguments.length === 3) {
        // Walk the dispatcher and the list (a `send` mentioned there still
        // escapes) but NOT the inner handler.
        const nestedHandler = n.arguments[2]
        for (const arg of n.arguments) if (arg !== nestedHandler) walk(arg, inScope)
        return
      }
    }

    // A function that is RETURNED rather than invoked does not run when this
    // handler runs, so neither its dispatches nor its silence say anything
    // about this tag. Bail on both counts: skip the subtree (no attribution)
    // and forfeit completeness (it may dispatch anything, later).
    if (isReturnedFunction(n)) {
      complete = false
      // …but a member node carries positions that are NOT part of its deferred
      // body and DO run when the literal is built — see
      // {@link memberBuildTimeExpressions}. They are walked with the OUTER
      // liveness, not `inScope`: both a computed key and a decorator are
      // evaluated outside the member's own parameter scope, so a parameter
      // spelling the dispatcher must not prune them.
      for (const e of memberBuildTimeExpressions(n)) walk(e, live)
      return
    }

    n.forEachChild((c) => walk(c, inScope))
  }
  // The handler's OWN parameter list is a scope and a body, and the walk used
  // to start past both. Two consequences, both false positives:
  //   * a parameter that rebinds the name (`({ send }: Ctx) => send({…})`,
  //     `(send: Ctx['send']) => …`) is the SAME shadowing case as an inner
  //     `items.forEach(({ send }) => …)`, one scope up — so the handler itself
  //     must reach `scopeIntroduces` rather than being assumed live;
  //   * a parameter DEFAULT is code that runs on every call, so a call there
  //     costs completeness and a dispatcher mention there escapes, exactly as
  //     in the body. Skipping the parameter list claimed a completeness the
  //     handler had not earned.
  // Defaults are evaluated in the PARAMETER scope, where the parameter names
  // are already bound, so they take the same liveness as the body.
  //
  // BOTH places a default can hide are walked. `p.initializer` is only the
  // default of a WHOLE parameter (`(e = compute())`); a default written inside
  // the parameter's binding PATTERN — `({ x = compute() })`, `([x = compute()])`,
  // `({ o: { x = compute() } })` — hangs off a `BindingElement` under `p.name`
  // and is reached only by walking the pattern. That is the same defect one
  // position further in, and it cost the same two things: a call there runs on
  // every call (completeness) and a dispatcher mention there escapes or
  // dispatches. Walking the pattern also makes a parameter behave exactly like
  // the `const { … } = x` the body walk already handles.
  //
  // The `isIdentifier` guard is not an optimization: a plain parameter name IS
  // the binding, so if it spells the dispatcher then `scopeIntroduces` has
  // already made `live` false — walking it could only re-read the name in
  // DECLARATION position, which is never a read.
  const live = !scopeIntroduces(handler, dispatcherName)
  for (const p of handler.parameters) {
    if (!ts.isIdentifier(p.name)) walk(p.name, live)
    if (p.initializer !== undefined) walk(p.initializer, live)
  }
  walk(handler.body, live)
  return { dispatches, complete }
}

/** The node kinds whose BODY is deferred past the expression that builds them —
 * what "a returned closure does not run" can be true OF. Arrow and function
 * expressions used to be the whole list, which made the spelling decide the
 * verdict: `{ h: function () { … } }` was skipped while the identical, more
 * idiomatic `{ h() { … } }` was attributed (#182). A method shorthand, an
 * accessor and a constructor defer exactly as an arrow does — none run when
 * the object or class literal is built.
 *
 * NOT here, deliberately:
 *   • `ClassStaticBlockDeclaration` — a static block RUNS when the class
 *     expression is evaluated, i.e. inside the handler.
 *   • the class expression ITSELF — only its function-like members defer; its
 *     static field initializers and static blocks are ordinary code the walk
 *     must keep reading. It is a transparent CONTAINER (see
 *     {@link isTransparentReturnContainer}), never a skipped subtree. */
function isDeferredBody(n: ts.Node): boolean {
  return (
    ts.isArrowFunction(n) ||
    ts.isFunctionExpression(n) ||
    ts.isMethodDeclaration(n) ||
    ts.isGetAccessorDeclaration(n) ||
    ts.isSetAccessorDeclaration(n) ||
    ts.isConstructorDeclaration(n)
  )
}

/** Everything on a SKIPPED member node that is nevertheless evaluated when the
 * object or class literal is BUILT — i.e. inside the handler — and therefore
 * must still be walked. A member is skipped as a whole subtree, so each of these
 * has to be rescued by name; they are the same kind of exception as a returned
 * class's `static {}` block and `static h = …` initializer, one level down.
 *
 *   • the COMPUTED name: `{ [k()]() { … } }` evaluates `k()` when the literal is
 *     built. (An arrow in a PROPERTY position never had this problem — its
 *     sibling `ComputedPropertyName` hangs off the `PropertyAssignment`, which
 *     the walk keeps visiting. Skipping the member made a method the one
 *     position where a computed key stopped being read.)
 *   • the member's own DECORATORS and its parameters' DECORATORS: a decorator
 *     expression is evaluated when the class expression is evaluated, exactly
 *     like a heritage clause. Only classes have these, so an object-literal
 *     member contributes none.
 *
 * A parameter DEFAULT is deliberately absent: it runs when the member is
 * CALLED, which is the deferred half. */
function memberBuildTimeExpressions(n: ts.Node): ts.Node[] {
  const out: ts.Node[] = []
  if (
    ts.isMethodDeclaration(n) ||
    ts.isGetAccessorDeclaration(n) ||
    ts.isSetAccessorDeclaration(n)
  ) {
    if (ts.isComputedPropertyName(n.name)) out.push(n.name.expression)
  }
  if (ts.canHaveDecorators(n)) out.push(...(ts.getDecorators(n) ?? []))
  if (ts.isFunctionLike(n)) {
    for (const p of n.parameters) {
      if (ts.canHaveDecorators(p)) out.push(...(ts.getDecorators(p) ?? []))
    }
  }
  return out
}

/** True when `n` is a deferred-body node the handler RETURNS — reachable from
 * the return expression (a `return` statement's operand, or the concise body of
 * an enclosing arrow) WITHOUT passing through a call.
 *
 * "Without passing through a call" is the whole boundary, and both sides of it
 * are load-bearing:
 *
 *   • A returned closure does not run when the handler runs, so neither its
 *     dispatches nor its silence describe this tag. Direct return position was
 *     always handled; a closure returned inside an object or array literal
 *     (`return { h: () => send({type:'inner'}) }`, `return [() => …]`) was NOT,
 *     and got attributed to the handler — a direction-1 false positive against
 *     the rule's own doctrine, in a NON-BYPASSABLE build error (#157).
 *   • A function passed as an ARGUMENT stays attributed:
 *     `setTimeout(() => send({type:'tick'}))` really does dispatch, and so may
 *     `use({ h: () => … })` — the call can invoke it immediately. Treating every
 *     container as transparent would switch direction 1 off for the single most
 *     common dispatch shape there is.
 *
 * TRANSPARENT means every position whose value can BECOME the returned value
 * with no call in between — and it must mean the WHOLE of that, not the shapes
 * that happened to be reported. This rule's sibling walk (the handler's
 * parameter list) surfaced FOUR times, each round fixing one position further
 * in, which is why the invariant in CLAUDE.md says the next walker has to mean
 * all of it. So: the erased wrappers, object and array literals, a class
 * expression's members, a class field's initializer, a conditional's arms, and a
 * logical/comma operand. Anything else — a call argument above all, but also a
 * variable declaration, a template, a `new` — ends the walk with `false`, which
 * merely keeps the pre-existing attribution.
 *
 * The other half of "the whole of the position" is WHAT can sit there
 * ({@link isDeferredBody}): the container list was widened for #157 while the
 * start-kind guard still read arrow-or-function-expression only, so a method
 * shorthand, an accessor, a constructor and a class-field arrow inside a
 * returned container stayed attributed — the same false positive, one node kind
 * out, and on the MORE idiomatic spelling (#182).
 *
 * Both directions agree about the shapes this widens: skipping the subtree
 * removes a direction-1 attribution AND forfeits completeness, so direction 2
 * cannot start reporting because of it. */
function isReturnedFunction(n: ts.Node): boolean {
  if (!isDeferredBody(n)) return false
  let cur: ts.Node = n
  let parent: ts.Node | undefined = cur.parent
  while (parent !== undefined) {
    if (ts.isReturnStatement(parent)) return true
    if (ts.isArrowFunction(parent) && parent.body === cur) return true
    if (!isTransparentReturnContainer(cur, parent)) return false
    cur = parent
    parent = cur.parent
  }
  return false
}

/** Is `parent` a node that a returned value can sit INSIDE without being called
 * — i.e. does "`parent` is returned" imply "`cur` is returned"? See
 * {@link isReturnedFunction} for why the list is exactly this short. */
function isTransparentReturnContainer(cur: ts.Node, parent: ts.Node): boolean {
  // Erased wrappers: the value that reaches the return IS `cur`.
  if (
    ts.isParenthesizedExpression(parent) ||
    ts.isAsExpression(parent) ||
    ts.isSatisfiesExpression(parent) ||
    ts.isTypeAssertionExpression(parent) ||
    ts.isNonNullExpression(parent)
  ) {
    return parent.expression === cur
  }
  // `return [() => …]` — every ELEMENT of a returned array is returned with it.
  // Spread (`return [...(() => …)]`) is a `SpreadElement`, which is not in this
  // list and so ends the walk.
  //
  // The membership tests here and below (`elements`/`properties`/`members`)
  // redden NO test today: every other direct child of these three nodes is
  // already terminated earlier in the walk. They are defensive on purpose — an
  // unconditional `true` answers for positions it never looked at, which is
  // exactly the shape that turns unsound the day a kind is added above it, and
  // this function has already been widened twice (#157, #182).
  if (ts.isArrayLiteralExpression(parent)) return parent.elements.some((e) => e === cur)
  // `return { h: () => … }` — via the property assignment that holds it.
  if (ts.isPropertyAssignment(parent)) return parent.initializer === cur
  // `return { h() { … } }` / `{ get h() { … } }` — a member sits directly under
  // the object literal. Its computed NAME does not (see
  // {@link memberBuildTimeExpressions}); it runs when the literal is built.
  if (ts.isObjectLiteralExpression(parent)) return parent.properties.some((p) => p === cur)
  // `return class { h() { … } }` — a MEMBER of a returned class expression is
  // returned with it. A heritage clause (`extends mixin()`) is not a member and
  // is evaluated at class-evaluation time, so it ends the walk.
  if (ts.isClassExpression(parent)) return parent.members.some((m) => m === cur)
  // `return class { h = () => … }` — a class field's initializer builds the
  // closure but never calls it. This holds for a `static` field too: the
  // initializer is evaluated inside the handler, but only the ARROW is skipped
  // here, and any call in that initializer (`static h = compute()`) is an
  // ordinary node the walk still reads.
  if (ts.isPropertyDeclaration(parent)) return parent.initializer === cur
  // `return cond ? () => … : null` — either ARM can be the returned value; the
  // CONDITION cannot (it is consumed, not returned).
  if (ts.isConditionalExpression(parent)) {
    return parent.whenTrue === cur || parent.whenFalse === cur
  }
  // `return cached ?? (() => …)`, `a || (() => …)`, `(log(), () => …)`. For the
  // short-circuit operators either operand can be the value; for the comma the
  // left one is discarded, so only the right is.
  if (ts.isBinaryExpression(parent)) {
    const op = parent.operatorToken.kind
    if (
      op === ts.SyntaxKind.QuestionQuestionToken ||
      op === ts.SyntaxKind.BarBarToken ||
      op === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      return true
    }
    return op === ts.SyntaxKind.CommaToken && parent.right === cur
  }
  return false
}

/** True when `id` occupies the callee position of its parent call. */
function isCalleeOf(id: ts.Identifier): boolean {
  const parent = id.parent
  return parent !== undefined && ts.isCallExpression(parent) && parent.expression === id
}

/**
 * The event methods a handler may call without forfeiting completeness.
 *
 * This is an ALLOWLIST, not a heuristic, and that is the point. Completeness is
 * only ever an excuse to run direction 2, so the bar is "this call provably
 * cannot reach the dispatcher" — which nothing but a known-inert DOM method
 * clears. `ctx.commit()`, `opt.onSelect?.()`, `api.save()`, `cb()` and
 * `emit({type:'pick'})` are all calls into code this analysis cannot see, and
 * any of them may dispatch; an earlier predicate forgave every call ROOTED at a
 * parameter and so rejected all five as over-declarations.
 *
 * The list stays this short deliberately, and it costs nothing to keep it that
 * way: across every `tagSend` handler in this workspace, ALL 156 method calls
 * made on a handler parameter are `preventDefault` (152) or `stopPropagation`
 * (4). Forgiving exactly these keeps direction 2 alive on real call sites
 * without forgiving one call that could dispatch. Adding a name here is a
 * soundness decision, not a convenience one — it must be a method that provably
 * cannot reach the dispatcher.
 */
const INERT_EVENT_METHODS: ReadonlySet<string> = new Set([
  'preventDefault',
  'stopPropagation',
  'stopImmediatePropagation',
])

/**
 * True for exactly `p.preventDefault()` — a zero-argument call of an
 * {@link INERT_EVENT_METHODS} member directly on one of the handler's own
 * parameters.
 *
 * Every clause is load-bearing, and each excludes a real false positive:
 * the callee must be a PROPERTY access (`cb()` and `args[0]()` are not),
 * spelled statically (`e['go']()` is not), naming an inert method
 * (`ctx.commit()` does not), on a bare parameter identifier (`this.x.save()`
 * does not), with no arguments (`bus.on(send)` has one).
 */
function isInertParameterMethodCall(call: ts.CallExpression, params: ReadonlySet<string>): boolean {
  const callee = call.expression
  if (!ts.isPropertyAccessExpression(callee)) return false
  if (!ts.isIdentifier(callee.name)) return false
  if (!INERT_EVENT_METHODS.has(callee.name.text)) return false
  if (!ts.isIdentifier(callee.expression)) return false
  if (!params.has(callee.expression.text)) return false
  return call.arguments.length === 0
}

/** The `type` of a dispatched message when it is a readable object literal with
 * a string-literal `type` and no spread; null otherwise (a variable payload, a
 * computed type, a spread that could carry its own `type`). */
function literalMsgType(arg: ts.Expression | undefined): string | null {
  if (arg === undefined || !ts.isObjectLiteralExpression(arg)) return null
  let found: string | null = null
  for (const prop of arg.properties) {
    // A spread can contribute (or override) `type`, so the literal is no longer
    // the whole story.
    if (ts.isSpreadAssignment(prop)) return null
    if (!ts.isPropertyAssignment(prop)) continue
    const name = prop.name
    const key = ts.isIdentifier(name) ? name.text : ts.isStringLiteralLike(name) ? name.text : null
    if (key !== 'type') continue
    if (!ts.isStringLiteralLike(prop.initializer)) return null
    found = prop.initializer.text
  }
  return found
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
 * Run the signal lint rules over an already-parsed module, returning diagnostics
 * with resolved line/column. The adapter (vite plugin) surfaces these as build
 * errors. Call only on confirmed signal components.
 *
 * Takes a {@link ParsedModule} so the tree it lints is the SAME one the transform
 * and the cross-file resolver use — one parse per dev transform (#93). The
 * module also fixes the ScriptKind from the real filename: a `.ts` file using the
 * generic-arrow form (`const id = <T>(x: T): T => x`) misparses as JSX under TSX
 * and fires a spurious `operator-on-signal` error.
 */
export function lintSignalSource(mod: ParsedModule): SignalLintMessage[] {
  const sf = mod.sourceFile()
  return resolvePositions(sf, lintSignals(sf))
}

/**
 * Run ONLY `agent-annotation-syntax` over a module that is not a signal
 * component. A Msg union commonly lives in a plain `msg.ts` sibling that
 * carries no `component(` call, so `lintSignalSource` never sees it — yet that
 * is exactly where `@routeGated`/`@validates` are authored. The adapter calls
 * this for every other TS module it transforms.
 *
 * The cheap string pre-check runs against `mod.text` BEFORE the module is parsed,
 * so a file with no agent annotation costs a regex and nothing else — which is
 * what keeps this affordable on every module in the project.
 */
export function lintAnnotationSyntaxSource(mod: ParsedModule): SignalLintMessage[] {
  if (!ANNOTATION_CALL_PRECHECK.test(mod.text)) return []
  const sf = mod.sourceFile()
  return resolvePositions(sf, annotationSyntaxDiagnostics(sf))
}

/**
 * Run ONLY `tag-send-drift` over a module that is not a signal component — the
 * companion to {@link lintAnnotationSyntaxSource}, and needed for the same
 * reason: `tagSend` is a LIBRARY-author helper, so the canonical call site is a
 * plain `connect()` module with no `component(` call in it, which
 * `lintSignalSource` never sees. Without this the rule would cover only the
 * rarest call sites.
 *
 * Same pre-check discipline: the name is looked for in `mod.text` BEFORE the
 * module is parsed, so a module that never mentions `tagSend` costs one
 * substring search.
 */
export function lintTagSendSource(mod: ParsedModule): SignalLintMessage[] {
  if (!mod.text.includes('tagSend')) return []
  const sf = mod.sourceFile()
  return resolvePositions(sf, tagSendDriftDiagnostics(sf, HelperBindings.fromSourceFile(sf)))
}

function resolvePositions(
  sf: ts.SourceFile,
  diags: readonly SignalDiagnostic[],
): SignalLintMessage[] {
  return diags.map((d) => {
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
