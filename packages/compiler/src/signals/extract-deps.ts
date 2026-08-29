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
// WHICH `derived`/`constant` counts is decided by IMPORT PROVENANCE
// (`HelperBindings`), never by identifier text — see `signalFactoryOf` and #238.
//
// See docs/proposals/signals/README.md "Dependency Analysis".

import ts from 'typescript'
import { analyzeAccessor } from './analyze-deps.js'
import { HelperBindings } from './helper-bindings.js'

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

/**
 * The signal roots a component `view` destructures from its bag parameter, or
 * null when the function isn't a signal view (no object-pattern bag, or no
 * `state` in it). The returned root is keyed by the LOCAL alias the body uses,
 * so `view: ({ state: st }) => …` roots at `st`.
 *
 * Shared by the component transform (which lowers against these roots) and the
 * file-level dep collector (which analyzes against them) so both agree on what
 * "the state" is called in a given view.
 */
export function viewSignalRoots(viewFn: ts.ArrowFunction | ts.FunctionExpression): Roots | null {
  const param = viewFn.parameters[0]
  if (!param || !ts.isObjectBindingPattern(param.name)) return null
  for (const el of param.name.elements) {
    if (!ts.isIdentifier(el.name)) continue
    const key =
      el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : el.name.text
    if (key === 'state') return singleRoot(el.name.text)
  }
  return null
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

/** The `@llui/dom` calls that PRODUCE a signal out of thin air rather than
 * navigating an existing one: `derived(inputs, fn)` and `constant(value)`. */
export type SignalFactory = 'derived' | 'constant'

const SIGNAL_FACTORIES: ReadonlySet<string> = new Set<SignalFactory>(['derived', 'constant'])

/**
 * Which `@llui/dom` signal FACTORY `e` calls — `derived` / `constant` — or `null`
 * when it is not one.
 *
 * Resolved through {@link HelperBindings}, never by bare identifier text. That is
 * the whole point of this function existing (#238): the name test that used to sit
 * inline in {@link isSignalExpr} matched ANY callee spelled `derived`, so a
 * consumer's own `derived()` helper took a build-stopping `operator-on-signal`
 * report on code that did nothing wrong — while `constant` (which the framework
 * gained later) was not in that list at all, so `operator-on-signal` and
 * `peek-in-slot` were silently OFF for it and `text(constant(false) ? 'y' : 'n')`
 * compiled clean and rendered the truthy arm forever. Both directions come from
 * asking the name instead of the import.
 *
 * It fails CLOSED: a name bound at module scope to anything but a `@llui/dom`
 * export, a lexical shadow, an unresolvable/cyclic/type-only import — all resolve
 * to `null`, i.e. "not a signal", i.e. no diagnostic. A missed lint is a missed
 * lint; a false positive breaks a build.
 */
export function signalFactoryOf(e: ts.Expression, bindings: HelperBindings): SignalFactory | null {
  if (!ts.isCallExpression(e)) return null
  const canonical = bindings.resolveCall(e)
  return canonical !== null && SIGNAL_FACTORIES.has(canonical) ? (canonical as SignalFactory) : null
}

/** Permissive, import-less bindings: every bare name falls back to canonical-name
 * recognition (still shadow-aware). The `@llui/dom`-less default for callers that
 * genuinely have no module context — an expression parsed in isolation by a unit
 * test. Production callers thread `HelperBindings.fromSourceFile(sf)`; that is why
 * `bindings` is a REQUIRED parameter below rather than defaulting to this. */
export const PERMISSIVE_BINDINGS: HelperBindings = HelperBindings.empty()

/**
 * Is `expr` STRUCTURALLY a signal expression (a `state`/`.at`/`.map`/`.peek`
 * chain, or a `derived(...)`/`constant(...)` factory call)? Strict on shape — does
 * NOT return true merely because a signal appears somewhere inside (e.g. an event
 * handler `() => send(state.at('x').peek())` is NOT a signal expression). Used to
 * distinguish reactive slots from handlers/static values in the view transform.
 *
 * `bindings` is REQUIRED and carries the file's `@llui/dom` import provenance:
 * whether `derived`/`constant` at this site is the framework's or the consumer's
 * own is not answerable from the identifier text, and answering it wrongly costs
 * either a false build error or a silently unchecked slot (#238).
 */
export function isSignalExpr(
  expr: ts.Expression,
  bindings: HelperBindings,
  roots: Roots = STATE_ROOTS,
): boolean {
  const e = unwrapCasts(expr)
  if (signalPathOf(e, roots) !== null) return true
  if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression)) {
    const m = e.expression.name.text
    if (m === 'map' || m === 'at' || m === 'peek')
      return isSignalExpr(e.expression.expression, bindings, roots)
  }
  return signalFactoryOf(e, bindings) !== null
}

/**
 * The set of absolute dependency paths a signal-valued expression reads.
 */
export function analyzeSignalExpr(
  rawExpr: ts.Expression,
  bindings: HelperBindings,
  roots: Roots = STATE_ROOTS,
): Set<string> {
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
        return analyzeSignalExpr(recv, bindings, roots)
      }
      // non-literal callback (e.g. imported fn): inter-procedural narrowing is a
      // later step — coarsen to the whole source.
      return srcPath !== null ? new Set([srcPath]) : analyzeSignalExpr(recv, bindings, roots)
    }

    if (method === 'at') {
      // `.at` on a non-simple receiver (signalPathOf was null) — coarsen.
      return analyzeSignalExpr(recv, bindings, roots)
    }
  }

  // derived([s0, s1, ...], fn) — the framework's `derived`, by import provenance.
  // (`constant(v)` is the other factory and is deliberately absent: it carries no
  // dependency path at all, so it contributes nothing to rebase.)
  if (ts.isCallExpression(expr) && signalFactoryOf(expr, bindings) === 'derived') {
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
        else unionInto(out, analyzeSignalExpr(input, bindings, roots)) // coarsen this input
      })
      return out
    }
  }

  // Unknown form in a reactive slot (operators on signals are a rule error, so
  // this is rare). Defensive: union the deps of any signal sub-expression.
  const result = new Set<string>()
  expr.forEachChild((c) => {
    if (isExpr(c)) unionInto(result, analyzeSignalExpr(c, bindings, roots))
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
