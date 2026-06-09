// Signal view transform — rewrite authored reactive slots to the runtime form.
//
// Walks node-producing expressions in a `view` and rewrites:
//   - `text(state.at('count'))`      -> `signalText((s) => s.count, ['count'])`
//   - `text('literal')`              -> `staticText('literal')`
//   - `div({ class: <signal> }, [..])` -> `el('div', { class: react((s) => …, [..]) }, [..])`
// Static props and non-signal values (event handlers, literals) are preserved
// verbatim. Children are transformed recursively.
//
// Source→source (string) output; the surrounding transform (plugin wiring,
// import injection, signal-component detection) consumes it. Structural
// primitives (each/branch/show) and handler peek-lowering are later steps and
// are left verbatim here.
//
// See docs/proposals/signals/README.md.

import ts from 'typescript'
import { signalToProduce } from './lower.js'
import { isSignalExpr, signalPathOf, STATE_ROOTS, type Roots } from './extract-deps.js'

// ── Auto-batch ambient context (Opportunity A) ───────────────────────────────
// Set by the component transform around each view's lowering (and reset after);
// null otherwise. `sendName` is the bag's `send` local name. When active, a
// straight-line event handler that does nothing but call `send(...)` two or more
// times is wrapped in `batch(() => …)`, so a multi-dispatch handler commits ONE
// reconcile instead of N — the provably-safe automatic slice of B (the handler
// body has no statement between the sends that could observe the interim DOM).
// A single-threaded source transform makes this module-scoped ambient state safe.
let autoBatch: { sendName: string; used: boolean } | null = null

/** Activate (or clear) the auto-batch context for the view about to be lowered.
 * Returns the context so the caller can read `.used` afterward and inject `batch`
 * into the bag if a handler was wrapped. */
export function setAutoBatchContext(ctx: { sendName: string; used: boolean } | null): void {
  autoBatch = ctx
}

// ── Lowering-bail telemetry ───────────────────────────────────────────────────
/** A lowering attempt that gave up and fell back to a slower path. Events are
 * facts about ATTEMPTS, not final outcomes: an `each` whose row factory bails
 * (`each-direct`) may still lower on the render-callback path (`signalEach`),
 * and a pass-1 shape bail may be picked up by the pass-2 helper lowering —
 * correlate with the transformed output to classify final tiers. Reason tokens
 * are short, stable kebab-case strings meant to feed coverage telemetry and,
 * later, user-facing `perf` diagnostics. */
export interface LowerBail {
  /** which lowering gave up: the each row factory (`each-direct`), the each
   * render-callback arm (`each-render`), a `show`/`branch` arm, the view-helper
   * pass-2 `each` (`helper-each`), or same-file helper-row inlining
   * (`inline-helper`, reported only once a same-file delegation target was
   * actually identified). */
  kind: 'each-direct' | 'each-render' | 'show' | 'branch' | 'helper-each' | 'inline-helper'
  /** short stable reason token, e.g. 'row-local-signal-alias' */
  reason: string
  /** start offset of the bailing call / row render in the original source file */
  pos: number
}
let bailHook: ((bail: LowerBail) => void) | null = null
/** Set (or clear) the ambient bail-telemetry hook for the file being lowered.
 * Module-level like the auto-batch/helper-decl contexts; the component transform
 * sets it from `SignalTransformOptions.onLowerBail` and clears it in `finally`. */
export function setLowerBailHook(fn: ((bail: LowerBail) => void) | null): void {
  bailHook = fn
}
function reportBail(kind: LowerBail['kind'], reason: string, pos: number): void {
  bailHook?.({ kind, reason, pos })
}
/** Success counterpart for perf diagnostics: records the source position of an
 * `each` whose lowering SUCCEEDED. A success can come from a lowering pass whose
 * surrounding arm is later discarded (the parent falls back verbatim), so a site
 * counts as lowered only when a success event AND a covering text edit agree —
 * the consumer (perf-diagnostics) checks both. */
let eachLoweredHook: ((pos: number) => void) | null = null
export function setEachLoweredHook(fn: ((pos: number) => void) | null): void {
  eachLoweredHook = fn
}

// ── Phase-2 helper-row inlining: same-file view-helper declarations ───────────
// Set by the component transform (the whole file's top-level fn/arrow decls keyed
// by name) before lowering; null otherwise. A row `render: (item) => [rowHelper(item,
// …)]` is inlined by substituting `rowHelper`'s body for the call (params → call
// args), reducing to a normal inline row the existing factory lowers. Same-file only.
type HelperDecl = ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration
let helperDecls: ReadonlyMap<string, HelperDecl> | null = null
export function setHelperDecls(m: ReadonlyMap<string, HelperDecl> | null): void {
  helperDecls = m
}

/** Substitute `subst` param names with their arg source inside `node`, returning the
 * rewritten source — or null when hygiene can't be guaranteed (a param is shadowed
 * by a local/param, or used as an object shorthand `{ locale }` that can't be
 * spliced). Skips property names (`obj.locale`) and object keys. */
function substituteParams(
  node: ts.Node,
  sf: ts.SourceFile,
  subst: Map<string, string>,
): string | null {
  const base = node.getStart(sf)
  let full = node.getText(sf)
  const edits: Array<{ start: number; end: number; text: string }> = []
  let ok = true
  const visit = (n: ts.Node): void => {
    if (!ok) return
    if (ts.isIdentifier(n) && subst.has(n.text)) {
      const p = n.parent
      if (ts.isPropertyAccessExpression(p) && p.name === n) return // obj.NAME — property
      if (ts.isPropertyAssignment(p) && p.name === n) return // { NAME: ... } — key
      if (ts.isShorthandPropertyAssignment(p) && p.name === n) {
        ok = false // { locale } — would need `{ locale: <arg> }`; bail
        return
      }
      if (
        (ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isBindingElement(p)) &&
        p.name === n
      ) {
        ok = false // param shadowed by a local/param binding
        return
      }
      edits.push({ start: n.getStart(sf) - base, end: n.getEnd() - base, text: subst.get(n.text)! })
      return
    }
    n.forEachChild(visit)
  }
  visit(node)
  if (!ok) return null
  edits.sort((a, b) => b.start - a.start)
  for (const e of edits) full = full.slice(0, e.start) + e.text + full.slice(e.end)
  return full
}

/** The leading var declarations + single returned expression of a helper body
 * (concise `=> expr` or block `{ <decls>; return expr }`), or null. */
function helperReturn(
  decl: HelperDecl,
): { declStmts: readonly ts.VariableStatement[]; ret: ts.Expression } | null {
  const body = decl.body
  if (!body) return null
  if (!ts.isBlock(body)) return { declStmts: [], ret: body } // concise arrow `=> expr`
  const declStmts: ts.VariableStatement[] = []
  for (const stmt of body.statements) {
    if (ts.isVariableStatement(stmt)) {
      declStmts.push(stmt)
      continue
    }
    if (ts.isReturnStatement(stmt) && stmt.expression) return { declStmts, ret: stmt.expression }
    return null // a non-decl statement before return — can't inline
  }
  return null
}

/** True when any identifier in `node` (excluding property-access names `obj.NAME`
 * and object keys `{ NAME: … }`, but INCLUDING binding names — a duplicate `const`
 * is a collision too) matches one of `names`. Used as the capture guard when
 * prepending render-side decls to an inlined helper body: a helper that mentions
 * a render-decl name was referring to its own module scope, and inlining the decl
 * above it would capture the reference. */
function referencesIdent(node: ts.Node, names: ReadonlySet<string>): boolean {
  let found = false
  const visit = (n: ts.Node): void => {
    if (found) return
    if (ts.isIdentifier(n) && names.has(n.text)) {
      const p = n.parent
      if (ts.isPropertyAccessExpression(p) && p.name === n) return // obj.NAME
      if (ts.isPropertyAssignment(p) && p.name === n) return // { NAME: ... } key
      found = true
      return
    }
    n.forEachChild(visit)
  }
  visit(node)
  return found
}

/** If `fn` is a row render delegating to a same-file view helper — a bare call
 * `(params) => helper(args)`, an array-wrapped `(params) => [helper(args)]`, or
 * either with leading const/let decls in a block body — inline the helper's body
 * (params → args, render decls prepended) and return the synthetic inlined render
 * arrow + its source file. The helper may return a single element OR an array
 * (the documented `Renderable` shape — its elements become the row's roots).
 * Reduces a helper row to a normal inline row that {@link lowerRowFactory} lowers.
 * Returns null when not inlinable (unknown/cross-file helper, arg/param mismatch,
 * hygiene failure, multi-element render array) — the row then stays on its path. */
function inlineHelperRender(
  fn: ts.Expression,
  sf: ts.SourceFile,
): { fn: ts.Expression; sf: ts.SourceFile } | null {
  if (!helperDecls) return null
  if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return null
  const rr = helperReturn(fn) // render's leading decls + returned expression
  if (!rr) return null
  let renderRet: ts.Expression = rr.ret
  while (ts.isParenthesizedExpression(renderRet)) renderRet = renderRet.expression
  let callEl: ts.Expression
  if (ts.isArrayLiteralExpression(renderRet)) {
    if (renderRet.elements.length !== 1) return null
    callEl = renderRet.elements[0]!
  } else {
    callEl = renderRet // bare-call delegation `(item) => helper(args)`
  }
  if (!ts.isCallExpression(callEl) || !ts.isIdentifier(callEl.expression)) return null
  const decl = helperDecls.get(callEl.expression.text)
  if (!decl) return null
  // From here on the render IS a delegation to a known same-file helper — every
  // failure below is a reportable inlining miss.
  const bail = (reason: string): null => {
    reportBail('inline-helper', reason, fn.getStart(sf))
    return null
  }
  const params = decl.parameters
  if (params.length !== callEl.arguments.length) return bail('arg-count-mismatch')
  const subst = new Map<string, string>()
  for (let i = 0; i < params.length; i++) {
    const pn = params[i]!.name
    if (!ts.isIdentifier(pn)) return bail('destructured-param')
    subst.set(pn.text, callEl.arguments[i]!.getText(sf))
  }
  const hr = helperReturn(decl)
  if (!hr) return bail('helper-body-not-inlinable')
  let helperRet: ts.Expression = hr.ret
  while (ts.isParenthesizedExpression(helperRet)) helperRet = helperRet.expression
  // Render-side decls are prepended to the inlined body — guard against capture:
  // any render-decl name the (pre-substitution) helper body mentions referred to
  // the helper's module scope, and a duplicate decl name is a syntax collision.
  // Helper PARAM names are excluded: inside the helper a param shadows module
  // scope, so a matching identifier is a param reference — substituted away, not
  // captured. (A param can't also be redeclared by a helper-local `const`, so the
  // single scan covers the duplicate-decl collision too.)
  if (rr.declStmts.length > 0) {
    const renderDeclNames = new Set<string>()
    for (const ds of rr.declStmts) {
      for (const d of ds.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) return bail('render-decl-destructured')
        renderDeclNames.add(d.name.text)
      }
    }
    const scanNames = new Set(renderDeclNames)
    for (const p of params) {
      if (ts.isIdentifier(p.name)) scanNames.delete(p.name.text)
    }
    const helperParts: ts.Node[] = [...hr.declStmts, helperRet]
    if (scanNames.size > 0 && helperParts.some((p) => referencesIdent(p, scanNames))) {
      return bail('decl-capture-risk')
    }
  }
  const retSub = substituteParams(helperRet, sf, subst)
  if (retSub === null) return bail('param-substitution-hygiene')
  const declSubs: string[] = rr.declStmts.map((d) => d.getText(sf).replace(/;\s*$/, ''))
  for (const d of hr.declStmts) {
    const s = substituteParams(d, sf, subst)
    if (s === null) return bail('param-substitution-hygiene')
    declSubs.push(s.replace(/;\s*$/, ''))
  }
  // An array-returning helper IS the row's node array; a single element is wrapped.
  const retArr = ts.isArrayLiteralExpression(helperRet) ? retSub : `[${retSub}]`
  const renderParams = fn.parameters.map((p) => p.getText(sf)).join(', ')
  const inlinedSrc =
    declSubs.length > 0
      ? `(${renderParams}) => { ${declSubs.join('; ')}; return ${retArr} }`
      : `(${renderParams}) => ${retArr}`
  const newSf = ts.createSourceFile(
    '__inl.ts',
    `const __r = ${inlinedSrc}`,
    ts.ScriptTarget.Latest,
    true,
  )
  let arrow: ts.Expression | null = null
  const find = (n: ts.Node): void => {
    if (arrow) return
    if (ts.isVariableDeclaration(n) && n.initializer && ts.isArrowFunction(n.initializer)) {
      arrow = n.initializer
      return
    }
    n.forEachChild(find)
  }
  find(newSf)
  return arrow ? { fn: arrow, sf: newSf } : bail('internal-reparse')
}

/** True if `block` is a straight-line sequence of two-or-more bare `send(...)`
 * calls and nothing else — the only handler shape it's provably safe to coalesce
 * (no var reads, control flow, or DOM-observing calls between the dispatches). */
function isStraightLineSends(block: ts.Block, sendName: string): boolean {
  if (block.statements.length < 2) return false
  for (const st of block.statements) {
    if (!ts.isExpressionStatement(st)) return false
    const e = st.expression
    if (
      !ts.isCallExpression(e) ||
      !ts.isIdentifier(e.expression) ||
      e.expression.text !== sendName
    ) {
      return false
    }
  }
  return true
}

/** Render an event-handler initializer to source. `rewriteRoots` (the row-factory
 * path) rewrites `item`/`index`/`state` `.peek()` reads to live-row-ctx reads; omit
 * it for component-level handlers (kept verbatim). When the ambient auto-batch
 * context is active and the handler is a straight-line multi-`send` block, wrap its
 * body in `batch(() => …)` and flag the context so the bag gains a `batch` binding. */
function emitHandler(init: ts.Expression, sf: ts.SourceFile, rewriteRoots?: Roots): string {
  const render = (n: ts.Node): string =>
    rewriteRoots ? rewriteHandlerReads(n, sf, rewriteRoots) : n.getText(sf)
  if (
    autoBatch &&
    (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) &&
    !init.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) &&
    ts.isBlock(init.body) &&
    isStraightLineSends(init.body, autoBatch.sendName)
  ) {
    autoBatch.used = true
    const params = init.parameters.map((p) => p.getText(sf)).join(', ')
    return `(${params}) => batch(() => ${render(init.body)})`
  }
  return render(init)
}

/** The produce-wrapper parameter name for a roots map: `s` for the component
 * view, `ctx` inside an each row (where value prefixes are `ctx.item`/`ctx.state`). */
function paramOf(roots: Roots): string {
  for (const info of roots.values()) return info.value.split('.')[0] ?? 's'
  return 's'
}

/** Roots for an each row: item param -> ctx.item, the component `state` -> ctx.state. */
function eachRoots(itemParam: string): Roots {
  return new Map([
    [itemParam, { value: 'ctx.item', dep: 'item' }],
    ['state', { value: 'ctx.state', dep: 'state' }],
  ])
}

/** True if `expr` is a signal expression that yields a HANDLE (not a peeked value):
 * `item`, `item.at('x')`, `item.map(...)`, `derived(...)` — but NOT `item.peek()` /
 * `item.at('x').peek()`, which return a plain value. A handle-valued block-body local
 * (`const n = item.at('x')`) is opaque to the static tracer (later uses must stay
 * reactive but the alias hides the path) so the row bails on it; a peeked-value local
 * (`const v = item.peek()`) is fine — it lowers to a one-time live-ctx read. */
function isSignalHandleExpr(expr: ts.Expression, roots: Roots): boolean {
  if (!isSignalExpr(expr, roots)) return false
  let e: ts.Expression = expr
  while (ts.isParenthesizedExpression(e)) e = e.expression
  return !(
    ts.isCallExpression(e) &&
    ts.isPropertyAccessExpression(e.expression) &&
    e.expression.name.text === 'peek'
  )
}

// True if the lowered source `src` references `ident` as a FREE identifier — i.e.
// the row param leaked into a verbatim position (an event handler or a helper call
// like `activityItem(item, ...)`) that the lowered factory can't bind. The lowering
// rewrites legitimate row-param reads to `ctx.item`/`getCtx().item` (a property
// access, not a free ref), so a surviving free `item` means a real leak; such a row
// must stay on the authoring path. Parsed + AST-walked (NOT a regex) so a property
// name (`getCtx().item`), an object key, a re-binding, or a string LITERAL that
// merely contains the name as a substring (e.g. `class: 'activity-item'`) is not a
// false positive. Defensive: an unparseable `src` counts as a leak (conservative).
function loweredLeaksIdent(src: string, ident: string): boolean {
  const sf = ts.createSourceFile('__leak.ts', `const __x = (${src})`, ts.ScriptTarget.Latest, true)
  let leaks = false
  const visit = (n: ts.Node): void => {
    if (leaks) return
    if (ts.isIdentifier(n) && n.text === ident) {
      const p = n.parent
      // `obj.item` (property name) / `{ item: … }` (key): not a free reference.
      if (ts.isPropertyAccessExpression(p) && p.name === n) return
      if (ts.isPropertyAssignment(p) && p.name === n) return
      // a binding that re-introduces the name (param/local) — not a leak of the row param.
      if (
        (ts.isParameter(p) || ts.isVariableDeclaration(p) || ts.isBindingElement(p)) &&
        p.name === n
      ) {
        return
      }
      leaks = true // a standalone reference (incl. object shorthand `{ item }`)
      return
    }
    n.forEachChild(visit)
  }
  visit(sf)
  return leaks
}

/** True if `expr` reads a signal handle via `.at(...)`/`.map(...)` on a NON-root
 * bare identifier — i.e. a handle the row-ctx roots (`item`/`index`/`state`) don't
 * cover, such as a view-HELPER's signal param (`mode.at('x')`). Such a read must
 * stay reactive, but a static text/attr slot would mis-emit it as `String(<handle>)`
 * — so the caller bails that row to the authoring path. (`.peek()` is excluded: it
 * returns a VALUE and the handle is in lexical scope, so emitting it once is fine.
 * Array `.map`/`.at` false-positives only forgo the optimization, which is safe.) */
function referencesNonRootSignal(expr: ts.Node, roots: Roots): boolean {
  let found = false
  const visit = (n: ts.Node): void => {
    if (found) return
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      (n.expression.name.text === 'at' || n.expression.name.text === 'map') &&
      ts.isIdentifier(n.expression.expression) &&
      !roots.has(n.expression.expression.text)
    ) {
      found = true
      return
    }
    n.forEachChild(visit)
  }
  visit(expr)
  return found
}

const ELEMENT_HELPERS = new Set([
  'div',
  'span',
  'p',
  'a',
  'button',
  'input',
  'label',
  'form',
  'ul',
  'ol',
  'li',
  'section',
  'header',
  'footer',
  'nav',
  'main',
  'article',
  'aside',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'img',
  'svg',
  'table',
  'thead',
  'tbody',
  'tr',
  'td',
  'th',
  'select',
  'option',
  'textarea',
  'pre',
  'code',
  'small',
  'strong',
  'em',
  'i',
  'b',
  'figure',
  'figcaption',
  'canvas',
  'video',
  'audio',
  'details',
  'summary',
  'dialog',
  'fieldset',
  'legend',
])

function depsArr(deps: readonly string[]): string {
  // dependency paths are dotted property names / numeric indices — no quoting
  // hazards — so single-quote to match the repo's formatting.
  return `[${deps.map((d) => `'${d}'`).join(', ')}]`
}

function unwrap(expr: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(expr) ? unwrap(expr.expression) : expr
}

/** The first parameter name of a callback, or null (used to root a render arm's
 * narrowed signal, e.g. show/branch). */
function firstParam(fn: ts.Expression): string | null {
  if (
    (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) &&
    fn.parameters[0] &&
    ts.isIdentifier(fn.parameters[0].name)
  ) {
    return fn.parameters[0].name.text
  }
  return null
}

/** The discriminant property name from a key arrow `(u) => u.kind`, or null if
 * the arg isn't a single top-level property access on the parameter. */
function discriminantProp(fn: ts.Expression): string | null {
  if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return null
  let body: ts.Node | undefined = fn.body
  if (body && ts.isBlock(body)) body = body.statements.find(ts.isReturnStatement)?.expression
  while (body && ts.isParenthesizedExpression(body)) body = body.expression
  if (body && ts.isPropertyAccessExpression(body) && ts.isIdentifier(body.expression)) {
    return body.name.text
  }
  return null
}

/** Source for a `{ produce, deps }` SignalSpec from a signal expression. */
function specSrc(expr: ts.Expression, sf: ts.SourceFile, roots: Roots): string {
  const { produce, deps } = signalToProduce(expr, sf, roots)
  return `{ produce: (${paramOf(roots)}) => ${produce}, deps: ${depsArr(deps)} }`
}

/** The returned node array of a concise arrow body (`() => [...]`), or null. */
function arrowReturnArray(fn: ts.Expression): ts.ArrayLiteralExpression | null {
  if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return null
  const body = fn.body
  if (body && ts.isArrayLiteralExpression(body)) return body
  if (body && ts.isParenthesizedExpression(body) && ts.isArrayLiteralExpression(body.expression)) {
    return body.expression
  }
  return null
}

/** The row body for direct-factory lowering: any leading `const`/`let` declarations
 * plus the returned node array — for a concise (`=> [...]`) OR block-body
 * (`=> { <decls>; return [...] }`) render. Null when not lowerable as a static
 * skeleton: a non-array return (including a data-conditional `cond ? [a] : [b]`,
 * whose element structure varies per row), or any statement before the `return`
 * that isn't a variable declaration. The declarations are validated + lowered by
 * the caller (`item`/`index`/`state` `.peek()` reads → live row ctx; a signal-bound
 * local bails). */
function rowBody(
  fn: ts.Expression,
): { decls: readonly ts.VariableStatement[]; arr: ts.ArrayLiteralExpression } | null {
  const concise = arrowReturnArray(fn)
  if (concise) return { decls: [], arr: concise }
  if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return null
  const body = fn.body
  if (!body || !ts.isBlock(body)) return null
  const decls: ts.VariableStatement[] = []
  for (const stmt of body.statements) {
    if (ts.isVariableStatement(stmt)) {
      decls.push(stmt)
      continue
    }
    if (ts.isReturnStatement(stmt)) {
      let e: ts.Expression | undefined = stmt.expression
      while (e && ts.isParenthesizedExpression(e)) e = e.expression
      return e && ts.isArrayLiteralExpression(e) ? { decls, arr: e } : null
    }
    return null // a non-declaration statement before the return — can't inline safely
  }
  return null // no array return
}

/**
 * Lower a structural arm/render callback's returned node array to `[node, ...]`
 * source under `armRoots`, collecting binding deps into `collect`, or return null
 * when it can't be SAFELY lowered. Unsafe means either (a) the body isn't a
 * concise array literal — e.g. a block body `(v) => { return [...] }`, which the
 * old code returned verbatim, producing the malformed `() => (v) => {...}` (a
 * function that yields the arrow instead of calling it) — or (b) a bound callback
 * param in `guardParams` survives as a free identifier in the lowered output,
 * meaning it leaked into a verbatim position (a helper call like `row(item)` or an
 * event handler) that the lowered, param-less `() => [...]` arm cannot bind.
 *
 * When this returns null the caller MUST emit the whole structural primitive
 * (each/show/branch) verbatim, so the runtime authoring helper — which binds the
 * real item/index/narrowed signal handle — renders it. Forgoing the lowering
 * optimization is always correct; emitting a free variable is a runtime crash.
 */
function lowerArmArray(
  fn: ts.Expression,
  sf: ts.SourceFile,
  armRoots: Roots,
  guardParams: readonly (string | null)[],
  collect?: Set<string>,
  onBail?: (reason: string) => void,
): string | null {
  const arr = arrowReturnArray(fn)
  if (!arr) {
    onBail?.('arm-not-concise-array')
    return null
  }
  const src = `[${arr.elements.map((e) => transformNodeExpr(e, sf, armRoots, collect)).join(', ')}]`
  for (const p of guardParams) {
    if (p !== null && loweredLeaksIdent(src, p)) {
      onBail?.(`arm-param-leak:${p}`)
      return null
    }
  }
  return src
}

/** Rewrite a node-producing expression to its signal-runtime source. */
export function transformNodeExpr(
  expr: ts.Expression,
  sf: ts.SourceFile,
  roots: Roots = STATE_ROOTS,
  collect?: Set<string>,
): string {
  const node = unwrap(expr)

  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
    const callee = node.expression.text

    if (callee === 'text') {
      const arg = node.arguments[0]
      if (!arg) return node.getText(sf)
      if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
        return `staticText(${arg.getText(sf)})`
      }
      // Only lower when the arg is rooted in the bag signal. A signal-bound LOCAL
      // (e.g. `const n = state.at('n'); … text(n)` in a block-body view) is opaque
      // to the static tracer — leave the call verbatim so the runtime `text`
      // helper consumes the handle. Same fall-through the props path already uses.
      if (!isSignalExpr(arg, roots)) return node.getText(sf)
      const { produce, deps } = signalToProduce(arg, sf, roots)
      if (collect) for (const d of deps) collect.add(d)
      return `signalText((${paramOf(roots)}) => ${produce}, ${depsArr(deps)})`
    }

    if (callee === 'each') {
      // each(items, { key, render: (item, index) => [...] }) -> combined-ctx rows.
      const items = node.arguments[0]
      const opts = node.arguments[1]
      const eachPos = node.getStart(sf)
      if (items && opts && !(ts.isObjectLiteralExpression(opts) && isSignalExpr(items, roots))) {
        // shape guard failed — neither lowering path runs from pass 1. (A
        // non-rooted items source may still be picked up by the pass-2 helper
        // lowering, which keeps the items handle verbatim.)
        reportBail(
          'each-direct',
          ts.isObjectLiteralExpression(opts)
            ? 'items-not-rooted-signal'
            : 'opts-not-object-literal',
          eachPos,
        )
      }
      if (items && opts && ts.isObjectLiteralExpression(opts) && isSignalExpr(items, roots)) {
        let keySrc = '(x) => x'
        let renderFn: ts.Expression | null = null
        let itemParam = 'item'
        let indexParam: string | null = null
        for (const p of opts.properties) {
          if (!ts.isPropertyAssignment(p)) continue
          const name = p.name.getText(sf)
          if (name === 'key') keySrc = p.initializer.getText(sf)
          else if (name === 'render') {
            renderFn = p.initializer
            if (ts.isArrowFunction(renderFn) || ts.isFunctionExpression(renderFn)) {
              if (renderFn.parameters[0] && ts.isIdentifier(renderFn.parameters[0].name))
                itemParam = renderFn.parameters[0].name.text
              if (renderFn.parameters[1] && ts.isIdentifier(renderFn.parameters[1].name))
                indexParam = renderFn.parameters[1].name.text
            }
          }
        }
        // Build the items accessor (component roots) + the each's deps: the items
        // deps PLUS the component-state paths the rows read (render `state.*` deps,
        // un-namespaced), and propagate those to an enclosing collector so a parent
        // `each` reconciles when any of them change. `renderDeps` is filled by
        // whichever lowering path runs (factory bindings or the render arm).
        const emitSource = (renderDeps: ReadonlySet<string>): string => {
          const itemsLowered = signalToProduce(items, sf, roots)
          const rowStateDeps = [...renderDeps]
            .filter((d) => d === 'state' || d.startsWith('state.'))
            .map((d) => (d === 'state' ? '' : d.slice('state.'.length)))
          const sourceDeps = [...new Set([...itemsLowered.deps, ...rowStateDeps])]
          if (collect) {
            for (const d of itemsLowered.deps) collect.add(d)
            for (const d of renderDeps) if (d === 'state' || d.startsWith('state.')) collect.add(d)
          }
          return `{ items: (${paramOf(roots)}) => ${itemsLowered.produce}, deps: ${depsArr(sourceDeps)} }`
        }

        // FAST PATH (tried first): direct-construction `RowFactory` +
        // `signalEachDirect`, skipping the per-row authoring/Mountable/populate/
        // pathHandle overhead. It builds the static element skeleton AND binds the
        // common list row's item/index-referencing event handlers (toggle/remove by
        // id) by reading the live row ctx — so real rows reach this path, not just
        // the handler-free benchmark shape. Reactive attrs/IDL props are bound too.
        const factoryDeps = new Set<string>()
        const factory =
          renderFn && lowerRowFactory(renderFn, itemParam, indexParam, sf, factoryDeps)
        if (factory) {
          eachLoweredHook?.(eachPos)
          return `signalEachDirect(${emitSource(factoryDeps)}, ${keySrc}, ${factory})`
        }
        if (!renderFn) reportBail('each-direct', 'missing-render', eachPos)

        // Render-callback path: lowerable rows the factory can't build directly
        // (structural children, helper calls) but that DON'T leak the row param into
        // a verbatim handler. `lowerArmArray` rewrites item reads to `ctx.item` and
        // guards against either row param leaking and against a non-array body.
        const renderDeps = new Set<string>()
        const body =
          renderFn &&
          lowerArmArray(
            renderFn,
            sf,
            eachRoots(itemParam),
            [itemParam, indexParam],
            renderDeps,
            (r) => reportBail('each-render', r, eachPos),
          )
        if (body != null) {
          eachLoweredHook?.(eachPos)
          return `signalEach(${emitSource(renderDeps)}, ${keySrc}, () => ${body})`
        }
        // unlowerable render -> fall through to verbatim (runtime authoring each)
      }
    }

    if (callee === 'show') {
      // show(cond, (narrowed) => [...], orElse?) — the then-arm's param is the
      // NARROWED signal (rebased onto the cond's path, like a branch arm); the
      // optional 3rd arm renders when the cond is falsy.
      const cond = node.arguments[0]
      const render = node.arguments[1]
      const orElse = node.arguments[2]
      const showPos = node.getStart(sf)
      if (cond && render && !isSignalExpr(cond, roots)) {
        reportBail('show', 'cond-not-rooted-signal', showPos)
      }
      if (cond && render && isSignalExpr(cond, roots)) {
        const condLowered = signalToProduce(cond, sf, roots)
        const condPath = signalPathOf(cond, roots)
        const narrowed = firstParam(render)
        const thenRoots =
          narrowed !== null && condPath !== null
            ? (new Map([
                ...roots,
                [narrowed, { value: condLowered.produce, dep: condPath }],
              ]) as Roots)
            : roots
        // Like `each`, the then-arm's narrowed param is rebased only inside
        // recognized slots — if it leaks into a verbatim helper call / handler (or
        // the cond isn't a simple path, so it isn't rebased at all), or either arm
        // is a non-array body, the lowered `() => [...]` arm can't bind it. Fall
        // back to the runtime authoring `show`, which binds a real narrowed handle.
        const thenBody = lowerArmArray(render, sf, thenRoots, [narrowed], collect, (r) =>
          reportBail('show', r, showPos),
        )
        const elseBody = orElse
          ? lowerArmArray(orElse, sf, roots, [firstParam(orElse)], collect, (r) =>
              reportBail('show', r, showPos),
            )
          : null
        if (thenBody != null && (!orElse || elseBody != null)) {
          // Propagate the condition's deps to the enclosing collector so a parent
          // `each` reconciles its rows when this nested show's condition changes
          // (its arms' value deps are collected by the lowerArmArray calls above).
          if (collect) for (const d of condLowered.deps) collect.add(d)
          const elseSrc = orElse ? `, () => ${elseBody}` : ''
          return `signalShow(${specSrc(cond, sf, roots)}, () => ${thenBody}${elseSrc})`
        }
        // unlowerable arm -> fall through to verbatim (runtime authoring show)
      }
    }

    if (callee === 'branch') {
      // branch(value, 'disc', { arm: (v) => [...], ... }) — each arm receives the
      // NARROWED variant signal `v`, rebased onto the value's path (v.at('x') ->
      // <value>.x). The discriminant spec reads value.<disc> to pick the arm.
      const value = node.arguments[0]
      const discArg = node.arguments[1]
      const arms = node.arguments[2]
      const disc = discArg ? discriminantProp(discArg) : null
      const branchPos = node.getStart(sf)
      const matches3 =
        Boolean(value) &&
        disc !== null &&
        Boolean(arms) &&
        ts.isObjectLiteralExpression(arms!) &&
        isSignalExpr(value!, roots)
      const matches2 =
        Boolean(value) &&
        Boolean(discArg) &&
        ts.isObjectLiteralExpression(discArg!) &&
        isSignalExpr(value!, roots)
      if (value && discArg && !matches3 && !matches2) {
        reportBail(
          'branch',
          isSignalExpr(value, roots) ? 'shape-not-lowerable' : 'value-not-rooted-signal',
          branchPos,
        )
      }
      if (
        value &&
        disc !== null &&
        arms &&
        ts.isObjectLiteralExpression(arms) &&
        isSignalExpr(value, roots)
      ) {
        const valueLowered = signalToProduce(value, sf, roots)
        const valuePath = signalPathOf(value, roots) // 'view', '' (whole), or null
        const discDep = valuePath === null ? null : valuePath === '' ? disc : `${valuePath}.${disc}`
        const discSpec = `{ produce: (${paramOf(roots)}) => (${valueLowered.produce}).${disc}, deps: ${depsArr(
          discDep !== null ? [discDep] : valueLowered.deps,
        )} }`
        // An arm is lowerable only if it's a `PropertyAssignment` whose body is a
        // concise array that doesn't leak its narrowed `v` param into a verbatim
        // helper call / handler (or that doesn't use `v` when the value isn't a
        // simple path, so it can't be rebased). If ANY arm — or a spread / accessor
        // property — can't be lowered, emit the WHOLE branch verbatim so the
        // runtime authoring `branch` binds real narrowed handles for every arm.
        const armsSrc: string[] = []
        let armsOk = true
        for (const p of arms.properties) {
          if (!ts.isPropertyAssignment(p)) {
            reportBail('branch', 'arm-spread-or-accessor', branchPos)
            armsOk = false
            break
          }
          const fn = p.initializer
          const vParam =
            (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) &&
            fn.parameters[0] &&
            ts.isIdentifier(fn.parameters[0].name)
              ? fn.parameters[0].name.text
              : null
          // narrow only when the value is a simple path; otherwise the arm
          // body falls back to the component roots (no `v` narrowing).
          const armRoots =
            vParam !== null && valuePath !== null
              ? (new Map([
                  ...roots,
                  [vParam, { value: valueLowered.produce, dep: valuePath }],
                ]) as Roots)
              : roots
          const armBody = lowerArmArray(fn, sf, armRoots, [vParam], collect, (r) =>
            reportBail('branch', r, branchPos),
          )
          if (armBody == null) {
            armsOk = false
            break
          }
          armsSrc.push(`${p.name.getText(sf)}: () => ${armBody}`)
        }
        if (armsOk) {
          // Propagate the discriminant's deps so a parent `each` reconciles when it
          // changes (arm value deps are collected by the lowerArmArray calls above).
          if (collect)
            for (const d of discDep !== null ? [discDep] : valueLowered.deps) collect.add(d)
          return `signalBranch(${discSpec}, { ${armsSrc.join(', ')} })`
        }
        // unlowerable arm -> fall through to verbatim (runtime authoring branch)
      }
      // 2-arg plain form: branch(stringSignal, { arm: () => [...] }) — the value
      // IS the discriminant; arms are keyed by its value, no narrowed param.
      if (value && discArg && ts.isObjectLiteralExpression(discArg) && isSignalExpr(value, roots)) {
        const armsSrc: string[] = []
        let armsOk = true
        for (const p of discArg.properties) {
          if (!ts.isPropertyAssignment(p)) {
            reportBail('branch', 'arm-spread-or-accessor', branchPos)
            armsOk = false
            break
          }
          const armBody = lowerArmArray(
            p.initializer,
            sf,
            roots,
            [firstParam(p.initializer)],
            collect,
            (r) => reportBail('branch', r, branchPos),
          )
          if (armBody == null) {
            armsOk = false
            break
          }
          armsSrc.push(`${p.name.getText(sf)}: () => ${armBody}`)
        }
        if (armsOk) {
          if (collect) for (const d of signalToProduce(value, sf, roots).deps) collect.add(d)
          return `signalBranch(${specSrc(value, sf, roots)}, { ${armsSrc.join(', ')} })`
        }
        // unlowerable arm -> fall through to verbatim (runtime authoring branch)
      }
    }

    if (callee === 'foreign') {
      // foreign({ tag?, state: { k: <signal> }, mount, unmount })
      const spec = node.arguments[0]
      if (spec && ts.isObjectLiteralExpression(spec)) {
        const props = spec.properties.map((p) => {
          if (
            ts.isPropertyAssignment(p) &&
            p.name.getText(sf) === 'state' &&
            ts.isObjectLiteralExpression(p.initializer)
          ) {
            // lower each declared input signal to a { produce, deps } SignalSpec
            const entries = p.initializer.properties.map((e) =>
              ts.isPropertyAssignment(e)
                ? `${e.name.getText(sf)}: ${specSrc(e.initializer, sf, roots)}`
                : e.getText(sf),
            )
            return `state: { ${entries.join(', ')} }`
          }
          // tag / mount / unmount are imperative — kept verbatim
          return p.getText(sf)
        })
        return `signalForeign({ ${props.join(', ')} })`
      }
    }

    if (ELEMENT_HELPERS.has(callee)) {
      const a0 = node.arguments[0]
      const a1 = node.arguments[1]
      // Statically-lowerable forms: tag() | tag([children]) | tag({props}) |
      // tag({props}, [children]). Anything else — a DYNAMIC children/props
      // expression like `div(section.view(...))` or `div(props, makeRows())` —
      // can't be analyzed at compile time. Leave the WHOLE call verbatim so the
      // runtime authoring helper handles it (its `Array.isArray(a0)` dispatch
      // routes a Node[] arg to children); lowering those would otherwise DROP the
      // dynamic children (emit `el(tag, {}, [])`).
      let propsExpr: ts.ObjectLiteralExpression | undefined
      let childrenExpr: ts.ArrayLiteralExpression | undefined
      let analyzable = false
      if (!a0) {
        analyzable = true // tag()
      } else if (ts.isArrayLiteralExpression(a0)) {
        childrenExpr = a0
        analyzable = true
      } else if (ts.isObjectLiteralExpression(a0)) {
        propsExpr = a0
        if (!a1) analyzable = true
        else if (ts.isArrayLiteralExpression(a1)) {
          childrenExpr = a1
          analyzable = true
        }
        // a1 present but not an array literal -> dynamic children -> not analyzable
      }
      if (!analyzable) return node.getText(sf)
      const propsSrc = propsExpr ? transformProps(propsExpr, sf, roots, collect) : '{}'
      const childrenSrc = childrenExpr
        ? `[${childrenExpr.elements.map((c) => transformNodeExpr(c, sf, roots, collect)).join(', ')}]`
        : '[]'
      return `el(${JSON.stringify(callee)}, ${propsSrc}, ${childrenSrc})`
    }
  }

  // Unrecognized node form (helper call, each/branch/show, ...) — verbatim.
  return node.getText(sf)
}

/** `onClick` -> `click`, `onKeyDown` -> `keydown`. Mirrors the runtime's
 * `eventName` (dom.ts) so a compiled row attaches the same listener the authoring
 * path would. */
function eventName(prop: string): string {
  return prop.slice(2).toLowerCase()
}

/** Roots for lowering an event-handler body in a direct row: the row params and
 * component `state` resolve to reads off the LIVE row ctx (`getCtx().item` / `.index`
 * / `.state`), so a handler reads the current row's values at event time. */
function handlerRoots(itemParam: string, indexParam: string | null): Roots {
  const m = new Map<string, { value: string; dep: string }>([
    [itemParam, { value: 'getCtx().item', dep: 'item' }],
    ['state', { value: 'getCtx().state', dep: 'state' }],
  ])
  if (indexParam) m.set(indexParam, { value: 'getCtx().index', dep: 'index' })
  return m
}

/** Rewrite the `.peek()`-terminated signal reads inside an event-handler expression
 * to reads off the live row ctx (`item.at('id').peek()` -> `getCtx().item.id`),
 * leaving every other token verbatim (so `send`, the message shape, DOM access, and
 * any closed-over locals are preserved). `.peek()` is the only legal way to read a
 * row signal's value in a handler, so matching it covers the toggle/remove pattern;
 * a non-peek row-param use is left untouched and caught by the caller's leak guard
 * (which then bails the whole factory to the render path). */
function rewriteHandlerReads(expr: ts.Node, sf: ts.SourceFile, roots: Roots): string {
  const base = expr.getStart(sf)
  const full = expr.getText(sf)
  const edits: Array<{ start: number; end: number; text: string }> = []
  const visit = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === 'peek' &&
      isSignalExpr(n, roots)
    ) {
      // a row-signal value read — replace `<chain>.peek()` with its lowered source.
      edits.push({
        start: n.getStart(sf) - base,
        end: n.getEnd() - base,
        text: signalToProduce(n, sf, roots).produce,
      })
      return // the receiver is consumed; don't descend into it
    }
    n.forEachChild(visit)
  }
  visit(expr)
  if (edits.length === 0) return full
  edits.sort((a, b) => b.start - a.start) // splice right-to-left so offsets stay valid
  let out = full
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end)
  return out
}

/** Generate a direct-construction `RowFactory` source for a row built from a static
 * element skeleton: static/reactive attrs, static/signal `text` children, and
 * item/index-referencing event handlers (lowered to live-row-ctx reads — the common
 * toggle/remove-by-id list row). Also handles a BLOCK-BODY render
 * (`(item) => { const x = item.peek()…; return [...] }`): leading `const`/`let`
 * locals are emitted once per row (with `.peek()` reads rewritten to live ctx) so
 * element/text/attr/handler slots can reference them — static values computed from a
 * local (e.g. `text(isDir ? '📁' : '📄')`) lower too. Returns the `(doc, getCtx) =>
 * { … return { nodes, bindings } }` source, collecting reactive deps into `collect`,
 * or null to fall
 * back to `signalEach` — for static style./IDL props, non-arrow handlers (e.g.
 * `tagSend(...)`, whose agent-variant registration needs the authoring path),
 * spreads, dynamic args, structural children, helper calls, or `index`/opaque reads
 * it can't wire. See docs/proposals/v2-compiler/compiled-row-construction.md. */
function lowerRowFactory(
  fnIn: ts.Expression,
  itemParam: string,
  indexParam: string | null,
  sfIn: ts.SourceFile,
  collect?: Set<string>,
): string | null {
  // Phase-2 helper-row inlining: `(item) => [rowHelper(item, …)]` → the helper's body
  // inlined (params → args), reducing to a normal inline row. The inlined arrow lives
  // in its own synthetic source file, so rebind `fn`/`sf` to the effective pair.
  const inlined = inlineHelperRender(fnIn, sfIn)
  const fn = inlined ? inlined.fn : fnIn
  const sf = inlined ? inlined.sf : sfIn
  // Bail telemetry: every leaf failure below reports once against the ORIGINAL
  // render's position (the inlined synthetic file has no meaningful offsets).
  // Propagation sites (a child's failure bubbling up) stay silent so a single
  // factory bail produces a single event.
  const bailPos = fnIn.getStart(sfIn)
  const bail = (reason: string): null => {
    reportBail('each-direct', reason, bailPos)
    return null
  }
  const bailF = (reason: string): false => {
    reportBail('each-direct', reason, bailPos)
    return false
  }
  const body = rowBody(fn)
  if (!body || body.arr.elements.length === 0) return bail('row-body-not-array')
  const { decls, arr } = body
  const roots = eachRoots(itemParam)
  const hRoots = handlerRoots(itemParam, indexParam)
  // The row is built by CLONING a per-each-site template (Solid/vanilla's strategy,
  // and what the keyed bench's faster competitors do): the static skeleton (elements,
  // static attrs, literal text) is created ONCE via `createElement` and cached, then
  // `cloneNode(true)`d per row (one C++ deep-copy vs ~N JS→C++ createElement crossings
  // — ~38% faster row construction, measured real-Chromium). Per clone we walk to the
  // dynamic nodes (reactive/per-row text + elements with reactive attrs/handlers) by
  // child-index path and wire them. Two emission buffers:
  //   skel — static skeleton construction (runs once, in `_build`)
  //   wire — per-clone work (block-body locals, node locators, handlers, per-row attrs/text)
  const skel: string[] = []
  const wire: string[] = []
  const bindings: string[] = []
  let counter = 0
  const freshId = (): number => counter++
  // skeleton node id -> its location in the clone: which top root + child-index path.
  const nodePath = new Map<number, { root: number; path: readonly number[] }>()
  // node id -> memoized per-clone locator var (so two bindings on one node share one walk).
  const cloneVar = new Map<number, string>()

  // Emit (once) a per-clone locator for skeleton node `id` and return the var holding
  // the cloned node. A node at a top root (empty path) IS the clone root var `_r{root}`
  // — no walk needed. Otherwise navigate the clone by child index from its root.
  const locate = (id: number): string => {
    const loc = nodePath.get(id)!
    if (loc.path.length === 0) return `_r${loc.root}`
    const cached = cloneVar.get(id)
    if (cached) return cached
    const name = `_c${id}`
    const nav = loc.path.map((i) => `.childNodes[${i}]`).join('')
    wire.push(`const ${name} = _r${loc.root}${nav}`)
    cloneVar.set(id, name)
    return name
  }

  // Block-body locals (e.g. `const isDir = item.peek().type === 'dir'`) run once per
  // ROW (per clone) — emit them at the top of the per-clone section with `item`/`index`/
  // `state` `.peek()` reads rewritten to live-row-ctx reads, so later per-row text/attr/
  // handler slots can reference them. A SIGNAL-bound local (`const n = item.at('x')`)
  // is opaque to the static tracer (its uses must stay reactive but the alias hides
  // the path) → bail to the authoring path.
  for (const ds of decls) {
    for (const d of ds.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || !d.initializer) {
        return bail('row-local-destructured-or-uninitialized')
      }
      if (isSignalHandleExpr(d.initializer, roots)) return bail('row-local-signal-alias') // handle alias — opaque
      wire.push(`const ${d.name.text} = ${rewriteHandlerReads(d.initializer, sf, hRoots)}`)
    }
  }

  const calleeName = (c: ts.CallExpression): string | null =>
    ts.isIdentifier(c.expression) ? c.expression.text : null

  // Build a child node at child-index `path` under skeleton `parentVar`; returns false
  // to bail the whole row. Static literal text bakes into the skeleton; reactive and
  // per-row-computed text become an empty placeholder text node (located + filled per clone).
  const buildChild = (
    child: ts.Expression,
    parentVar: string,
    root: number,
    path: readonly number[],
  ): boolean => {
    if (ts.isStringLiteralLike(child) || ts.isNumericLiteral(child)) {
      skel.push(`${parentVar}.appendChild(doc.createTextNode(${JSON.stringify(child.text)}))`)
      return true
    }
    if (!ts.isCallExpression(child)) return bailF('row-child-unsupported')
    const callee = calleeName(child)
    if (callee === 'text') {
      const arg = child.arguments[0]
      if (!arg) return bailF('row-text-empty')
      if (ts.isStringLiteralLike(arg)) {
        skel.push(`${parentVar}.appendChild(doc.createTextNode(${arg.getText(sf)}))`)
        return true
      }
      if (!isSignalExpr(arg, roots)) {
        // Static (non-signal) text computed from row locals / view scope — e.g.
        // `text(isDir ? '📁' : '📄')` or `text(item.peek().name)`. A placeholder text
        // node in the skeleton, its `.data` written per clone; `.peek()` reads → live
        // ctx, a leaked item/index handle is caught by the final guard. (A `.map`/`.at`
        // arg is a signal → the reactive path below.) Bail if it reads a non-root
        // signal handle (e.g. a helper param) reactively — that must stay reactive.
        if (referencesNonRootSignal(arg, roots)) return bailF('row-text-reads-nonroot-signal')
        const id = freshId()
        nodePath.set(id, { root, path })
        skel.push(`const _n${id} = doc.createTextNode('')`)
        skel.push(`${parentVar}.appendChild(_n${id})`)
        wire.push(`${locate(id)}.data = String(${rewriteHandlerReads(arg, sf, hRoots)})`)
        return true
      }
      const { produce, deps } = signalToProduce(arg, sf, roots)
      if (collect) for (const d of deps) collect.add(d)
      const id = freshId()
      nodePath.set(id, { root, path })
      skel.push(`const _n${id} = doc.createTextNode('')`)
      skel.push(`${parentVar}.appendChild(_n${id})`)
      bindings.push(
        `{ deps: ${depsArr(deps)}, produce: (ctx) => ${produce}, commit: (v) => { ${locate(id)}.data = v == null ? '' : String(v) } }`,
      )
      return true
    }
    if (callee && ELEMENT_HELPERS.has(callee)) {
      const cid = buildElement(child, root, path)
      if (cid === null) return false
      skel.push(`${parentVar}.appendChild(_n${cid})`)
      return true
    }
    return bailF('row-child-unsupported') // structural / helper / unknown -> bail
  }

  // Emit skeleton construction for an element-helper call at child-index `path` under
  // top root `root`; returns its skeleton node id, or null to bail. Static attrs/text
  // go to the skeleton; handlers, reactive attrs, and per-row-computed attrs are wired
  // per clone against the located node.
  function buildElement(
    call: ts.CallExpression,
    root: number,
    path: readonly number[],
  ): number | null {
    const callee = calleeName(call)
    if (!callee || !ELEMENT_HELPERS.has(callee)) return null
    const a0 = call.arguments[0]
    const a1 = call.arguments[1]
    let propsExpr: ts.ObjectLiteralExpression | undefined
    let childrenExpr: ts.ArrayLiteralExpression | undefined
    if (!a0) {
      // tag()
    } else if (ts.isArrayLiteralExpression(a0)) {
      childrenExpr = a0
    } else if (ts.isObjectLiteralExpression(a0)) {
      propsExpr = a0
      if (a1) {
        if (ts.isArrayLiteralExpression(a1)) childrenExpr = a1
        else return bail('row-elem-dynamic-children')
      }
    } else {
      return bail('row-elem-dynamic-args')
    }
    const id = freshId()
    nodePath.set(id, { root, path })
    skel.push(`const _n${id} = doc.createElement(${JSON.stringify(callee)})`)
    if (propsExpr) {
      for (const p of propsExpr.properties) {
        if (!ts.isPropertyAssignment(p)) return bail('row-prop-spread-or-shorthand')
        // The UNQUOTED property name. `p.name.getText()` keeps the source quotes
        // for a string-literal key (`'aria-hidden'` → emits `setAttribute("'aria-
        // hidden'", …)`, a literally-misnamed attribute) — use `.text`, and bail
        // on a computed key (can't name it statically).
        if (
          !ts.isIdentifier(p.name) &&
          !ts.isStringLiteralLike(p.name) &&
          !ts.isNumericLiteral(p.name)
        )
          return bail('row-prop-computed-key')
        const name = p.name.text
        if (/^on[A-Z]/.test(name)) {
          // Event handler. Only a plain function expression is bound directly — its
          // item/index/state `.peek()` reads are lowered to live-row-ctx reads so it
          // can dispatch by row id without a per-row item handle. A `tagSend(...)` or
          // other call form bails (its agent-variant registration needs the authoring
          // path); after rewriting, a non-peek row-param use is caught by the leak
          // guard below, which bails the whole factory to the render path. Attached
          // per clone to the located node.
          const init = p.initializer
          if (!ts.isArrowFunction(init) && !ts.isFunctionExpression(init)) {
            return bail('row-handler-not-inline-fn')
          }
          const handlerSrc = emitHandler(init, sf, hRoots)
          wire.push(
            `${locate(id)}.addEventListener(${JSON.stringify(eventName(name))}, ${handlerSrc})`,
          )
          continue
        }
        if (isSignalExpr(p.initializer, roots)) {
          // Reactive prop -> a binding slot that applies the value to the located
          // (cloned) node via the runtime's `applyAttr` (so style./IDL/content-attr
          // quirks — e.g. a checkbox's `checked` IDL property — are handled identically
          // to the authoring path). Reactive IDL props are why the common
          // `input({ checked: item.at('done') })` row reaches the direct path.
          const { produce, deps } = signalToProduce(p.initializer, sf, roots)
          if (collect) for (const d of deps) collect.add(d)
          bindings.push(
            `{ deps: ${depsArr(deps)}, produce: (ctx) => ${produce}, commit: (v) => applyAttr(${locate(id)}, ${JSON.stringify(name)}, v) }`,
          )
          continue
        }
        if (name.startsWith('style.') || DIRECT_SKIP_ATTRS.has(name)) {
          return bail('row-prop-static-idl-or-style')
        }
        const init = p.initializer
        if (ts.isStringLiteralLike(init) || ts.isNumericLiteral(init)) {
          skel.push(`_n${id}.setAttribute(${JSON.stringify(name)}, ${JSON.stringify(init.text)})`)
        } else if (init.kind === ts.SyntaxKind.TrueKeyword) {
          skel.push(`_n${id}.setAttribute(${JSON.stringify(name)}, "")`)
        } else if (init.kind === ts.SyntaxKind.FalseKeyword) {
          // falsy boolean attr -> absent; nothing to emit
        } else if (referencesNonRootSignal(init, roots)) {
          return bail('row-prop-reads-nonroot-signal') // a non-root handle read reactively
        } else {
          // Static (non-signal) value computed from row locals / view scope — apply
          // once PER CLONE via `applyAttr` on the located node (`.peek()` reads → live
          // ctx; a leaked handle is caught by the final guard). style./IDL names bailed.
          wire.push(
            `applyAttr(${locate(id)}, ${JSON.stringify(name)}, ${rewriteHandlerReads(init, sf, hRoots)})`,
          )
        }
      }
    }
    if (childrenExpr) {
      let ci = 0
      for (const child of childrenExpr.elements) {
        if (!buildChild(child, `_n${id}`, root, [...path, ci])) return null
        ci++ // every child produces exactly one node → child-index === DOM childNodes index
      }
    }
    return id
  }

  const topIds: number[] = []
  for (const el of arr.elements) {
    // A keyed row's top-level node must be a stable ELEMENT (buildSignalEach
    // rejects a bare structural fragment as a row root).
    if (!ts.isCallExpression(el)) return bail('row-top-not-element')
    const callee = calleeName(el)
    if (!callee || !ELEMENT_HELPERS.has(callee)) return bail('row-top-not-element')
    const id = buildElement(el, topIds.length, [])
    if (id === null) return null
    topIds.push(id)
  }

  // Assemble: an IIFE caching the skeleton (one per each-site, built lazily on the
  // first row with that row's `doc`), returning the per-row `(doc, getCtx)` factory.
  const skelReturn = `[${topIds.map((id) => `_n${id}`).join(', ')}]`
  const rootClones = topIds.map((_, r) => `const _r${r} = _sk[${r}].cloneNode(true)`).join('; ')
  const nodesArr = topIds.map((_, r) => `_r${r}`).join(', ')
  const wirePart = wire.length ? `${wire.join('; ')}; ` : ''
  const src =
    `(() => { let _sk; const _build = (doc) => { ${skel.join('; ')}; return ${skelReturn} }; ` +
    `return (doc, getCtx) => { if (_sk === undefined) _sk = _build(doc); ${rootClones}; ${wirePart}` +
    `return { nodes: [${nodesArr}], bindings: [${bindings.join(', ')}] } } })()`
  // Safety net: a row param that survived as a FREE identifier (a non-peek row-param
  // use a handler/binding couldn't rewrite — e.g. `onClick: () => f(item)` passing
  // the handle) would be `item is not defined` at runtime. Bail so the render path
  // (real item/index handles) takes it instead. (`getCtx().item`/`ctx.item` reads
  // are `.`-prefixed, so they don't trip this — see `loweredLeaksIdent`.)
  if (loweredLeaksIdent(src, itemParam)) return bail(`row-param-leak:${itemParam}`)
  if (indexParam !== null && loweredLeaksIdent(src, indexParam)) {
    return bail(`row-param-leak:${indexParam}`)
  }
  return src
}

/** Attribute names the runtime applies as live IDL properties (not `setAttribute`);
 * the direct fast path bails on static occurrences so the slow path's `applyAttr`
 * handles them. Mirrors the runtime's `DOM_PROPERTIES`. */
const DIRECT_SKIP_ATTRS = new Set(['value', 'checked', 'selected', 'indeterminate'])

/** Lower a view-HELPER-scoped `each(items, { key, render })` to `eachDirect(items,
 * key, factory)` — the handle-consuming authoring variant. Unlike the component-view
 * each (whose items root in the bag `state`, lowered to a `{ items, deps }` source),
 * a helper's items source roots in a CALL-SITE-bound signal param the compiler can't
 * statically resolve, so the items expression is kept VERBATIM (a runtime handle) and
 * only the ROW is compiled to a `RowFactory`. Returns null (→ leave the authoring
 * `each`) when the row isn't factory-lowerable — incl. when it reads a non-root
 * handle reactively (guarded inside `lowerRowFactory`). Used by the view-helper pass. */
export function lowerHelperEach(node: ts.CallExpression, sf: ts.SourceFile): string | null {
  if (!ts.isIdentifier(node.expression) || node.expression.text !== 'each') return null
  const pos = node.getStart(sf)
  const bail = (reason: string): null => {
    reportBail('helper-each', reason, pos)
    return null
  }
  const items = node.arguments[0]
  const opts = node.arguments[1]
  if (!items || !opts || !ts.isObjectLiteralExpression(opts)) {
    return bail('opts-missing-or-not-object')
  }
  let keySrc: string | null = null
  let renderFn: ts.Expression | null = null
  let itemParam = 'item'
  let indexParam: string | null = null
  for (const p of opts.properties) {
    if (!ts.isPropertyAssignment(p)) return bail('opt-spread-or-shorthand')
    const name = p.name.getText(sf)
    if (name === 'key') keySrc = p.initializer.getText(sf)
    else if (name === 'render') {
      renderFn = p.initializer
      if (ts.isArrowFunction(renderFn) || ts.isFunctionExpression(renderFn)) {
        if (renderFn.parameters[0] && ts.isIdentifier(renderFn.parameters[0].name))
          itemParam = renderFn.parameters[0].name.text
        if (renderFn.parameters[1] && ts.isIdentifier(renderFn.parameters[1].name))
          indexParam = renderFn.parameters[1].name.text
      }
    } else return bail(`unrecognized-opt:${name}`) // bail conservatively
  }
  if (keySrc === null || !renderFn) return bail('missing-key-or-render')
  const factory = lowerRowFactory(renderFn, itemParam, indexParam, sf)
  if (!factory) return null // the factory reported its own bail reason
  eachLoweredHook?.(pos)
  return `eachDirect(${items.getText(sf)}, ${keySrc}, ${factory})`
}

function transformProps(
  obj: ts.ObjectLiteralExpression,
  sf: ts.SourceFile,
  roots: Roots,
  collect?: Set<string>,
): string {
  if (obj.properties.length === 0) return '{}'
  const parts = obj.properties.map((p) => {
    if (ts.isPropertyAssignment(p)) {
      const name = p.name.getText(sf)
      if (isSignalExpr(p.initializer, roots)) {
        const { produce, deps } = signalToProduce(p.initializer, sf, roots)
        if (collect) for (const d of deps) collect.add(d)
        return `${name}: react((${paramOf(roots)}) => ${produce}, ${depsArr(deps)})`
      }
      // `on*` event handler: kept verbatim, but a straight-line multi-`send` body is
      // auto-wrapped in `batch(...)` so the burst commits one reconcile (Opportunity A).
      if (/^on[A-Z]/.test(name)) return `${name}: ${emitHandler(p.initializer, sf)}`
      return `${name}: ${p.initializer.getText(sf)}`
    }
    return p.getText(sf) // shorthand / spread / method — verbatim
  })
  return `{ ${parts.join(', ')} }`
}
