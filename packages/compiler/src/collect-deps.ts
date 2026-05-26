import ts from 'typescript'
import { resolveAccessorBody } from './accessor-resolver.js'

/**
 * Mutable collector for "the file's __prefixes must degrade to the
 * whole-state sentinel" — written by every accessor walker that sees
 * an opaque shape (unresolvable delegation, dynamic `s[expr]`, state
 * in a spread, etc.). The first triggering site is captured so a
 * downstream diagnostic can point the author at the line that
 * silently degraded mask precision for every binding in the file.
 *
 * Subsequent leaks DON'T overwrite — the surface diagnostic is "fix
 * this one and rerun"; flooding the user with every leak found is
 * lower value than a precise first cause.
 */
export interface OpaqueOut {
  value: boolean
  /** First opaque shape encountered. Stable across calls — only set when value flips false→true. */
  node?: ts.Node
  /** Short human label for the shape (e.g. "dynamic element access `s[expr]`"). */
  shape?: string
}

function markOpaque(out: OpaqueOut, node: ts.Node, shape: string): void {
  if (out.value) return
  out.value = true
  out.node = node
  out.shape = shape
}

/**
 * Names whose first arg is itself a reactive accessor (the existing
 * arrow walker handles them) or which are explicitly excluded
 * (sample/item read state imperatively / per-row, not as state
 * accessors). When a delegating accessor's body contains a call to one
 * of these, we don't follow it — recursion is reserved for "this is
 * just a thin wrapper that hands the state to another local helper."
 */
const NON_DELEGATION_HELPERS = new Set(['sample', 'item', 'memo', 'text', 'unsafeHtml'])

/**
 * Walk a delegating accessor's body looking for calls to OTHER local
 * functions that take the state param verbatim — `helper(s)` where
 * `s` matches the outer accessor's param name. For each, hand the
 * resolved declaration back so the caller can recurse into its body.
 *
 * Skips:
 *   - Framework helpers (`memo`, `text`, etc.) — their arrow args are
 *     visited by the top-level arrow walker; we'd double-count.
 *   - Method calls (`s.items.filter(...)`) — the callee is a builtin,
 *     not a local function we can resolve.
 *   - Nested function bodies — params inside a `(item) => …` shadow
 *     ours, so a `helper(s)` deep in there isn't (necessarily)
 *     handing OUR state in. Conservative: don't recurse through
 *     lambda boundaries.
 */
function visitTopLevelDelegations(
  body: ts.Node,
  stateParamName: string,
  follow: (resolved: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration) => void,
  onUnresolved?: (node: ts.Node) => void,
): void {
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const name = node.expression.text
      if (!NON_DELEGATION_HELPERS.has(name)) {
        const arg0 = node.arguments[0]
        if (arg0 && ts.isIdentifier(arg0) && arg0.text === stateParamName) {
          const resolved = resolveAccessorBody(node.expression)
          if (resolved) follow(resolved)
          else if (onUnresolved) onUnresolved(node)
        }
      }
    }
    // Don't descend into nested function bodies — their params shadow
    // ours, and any call inside them isn't unambiguously delegating
    // our state.
    if (
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node) ||
      ts.isFunctionDeclaration(node)
    ) {
      return
    }
    ts.forEachChild(node, visit)
  }
  // If the body itself is a function, there's nothing at the top
  // level to inspect — its own body is a separate scope.
  if (ts.isArrowFunction(body) || ts.isFunctionExpression(body) || ts.isFunctionDeclaration(body)) {
    return
  }
  visit(body)
}

/**
 * Extract paths from a callable accessor (arrow / fn-expr / fn-decl)
 * into the given set. Recurses through call-delegations to other local
 * helpers so that `(s) => filtered(s)` / `(s) => { void s.x; return
 * inner(s) }` correctly contribute the helper's state-path reads.
 * Without recursion the precise mask under-counts — fields read only
 * via the helper drop off the bitmask, and any sibling reactive
 * accessor that reads them produces a non-zero `dirty` that AND'd with
 * the narrow each.__mask is zero, silently skipping the reconcile.
 *
 * `visited` breaks cycles on mutually-recursive helpers — terminates
 * the walk; doesn't try to be precise about what such helpers read.
 */
function extractAccessorPaths(
  accessor: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration,
  paths: Set<string>,
  visited: Set<ts.Node> = new Set(),
  opaqueOut?: OpaqueOut,
): boolean {
  if (visited.has(accessor)) return false
  visited.add(accessor)

  const params = accessor.parameters
  if (params.length !== 1) return false
  const paramName = params[0]!.name
  if (!ts.isIdentifier(paramName)) {
    // Destructured/anonymous param — the path walker can't follow
    // reads through it. Conservative: mark the accessor as opaque so
    // the synthesis pipeline emits a whole-state sentinel.
    if (opaqueOut) markOpaque(opaqueOut, paramName, 'destructured accessor parameter')
    return false
  }
  if (!accessor.body) return false
  const before = paths.size

  extractPaths(accessor.body, paramName.text, '', paths)

  // Detect opaque state flow alongside path extraction. Mirrors the
  // classifier in `transform.ts`'s `computeAccessorMask` (Identifier
  // `s` used in a non-tracked position) — any leak means a precise
  // `__prefixes` table is insufficient because a field read only
  // through the leak never enters fieldBits and the runtime can't
  // dirty it on change.
  if (opaqueOut) detectOpaqueStateFlow(accessor.body, paramName.text, opaqueOut)

  // Follow delegations: `(s) => helper(s)` — extract `helper`'s body's
  // state paths too. Reuses the `visited` set across the recursion
  // chain so cycles terminate. When the callee is unresolvable
  // (function parameter, import, destructured), the same logic that
  // forces FULL_MASK in `computeAccessorMask` flags the file as
  // opaque here, so the sentinel gets emitted.
  visitTopLevelDelegations(
    accessor.body,
    paramName.text,
    (resolved) => {
      extractAccessorPaths(resolved, paths, visited, opaqueOut)
    },
    (callNode) => {
      if (opaqueOut) markOpaque(opaqueOut, callNode, 'unresolvable delegating call `helper(s)`')
    },
  )

  return paths.size > before
}

/**
 * Mirror of the classifier in `computeAccessorMask` (transform.ts). An
 * accessor "leaks state" — and so demands the conservative
 * FULL_MASK / whole-state sentinel — when the state identifier `s`
 * appears in any position OTHER than:
 *   - the param binding itself
 *   - the root of `s.x.y…` (PropertyAccessExpression)
 *   - the root of `s['literal']` / `s[0]` (ElementAccess with literal key)
 *   - arg0 of `helper(s)` with an Identifier callee (handled by the
 *     delegation visitor — resolvable → recursion, unresolvable →
 *     marks opaque via the callback)
 *
 * Every other context (NewExpression arg, TaggedTemplate span, spread,
 * const-alias, conditional branch, method-call arg, dynamic key
 * `s[expr]`, return-the-whole-state, …) is treated as a leak.
 */
function detectOpaqueStateFlow(body: ts.Node, stateParam: string, out: OpaqueOut): void {
  function visit(node: ts.Node): void {
    if (out.value) return
    if (ts.isIdentifier(node) && node.text === stateParam) {
      const parent = node.parent
      const isBinding = !!parent && ts.isParameter(parent)
      if (!isBinding) {
        let isTracked = false
        let shape = 'state used outside a tracked container'
        if (parent) {
          if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
            isTracked = true
          } else if (ts.isElementAccessExpression(parent) && parent.expression === node) {
            if (
              ts.isStringLiteralLike(parent.argumentExpression) ||
              ts.isNumericLiteral(parent.argumentExpression)
            ) {
              isTracked = true
            } else {
              shape = 'dynamic element access `s[<expr>]`'
            }
          } else if (
            ts.isCallExpression(parent) &&
            ts.isIdentifier(parent.expression) &&
            parent.arguments[0] === node &&
            !NON_DELEGATION_HELPERS.has(parent.expression.text)
          ) {
            // The delegation visitor either recurses into the resolved
            // body (transitively detecting opaque inside) or flags
            // opaque via its second callback for unresolvable callees.
            isTracked = true
          } else if (ts.isCallExpression(parent) && parent.arguments[0] === node) {
            // Method-call with state as arg0 (e.g. `host.dirtyAt(s, e, p)`).
            // The callee is a PropertyAccessExpression, not an
            // Identifier — the mask classifier can't trace through
            // method dispatch, so this leaks state. The runtime stays
            // correct via the file-wide sentinel, but every binding
            // in the file re-evaluates on every state change.
            shape = `method call \`${describeCallee(parent.expression)}(s, …)\``
          } else if (ts.isNewExpression(parent)) {
            shape = 'state passed to a constructor (`new X(s)`)'
          } else if (ts.isSpreadElement(parent) || ts.isSpreadAssignment(parent)) {
            shape = 'state spread (`{...s}` / `[...s]`)'
          } else if (ts.isConditionalExpression(parent)) {
            shape = 'state in a conditional branch (`cond ? s : other`)'
          } else if (ts.isAsExpression(parent) || ts.isTypeAssertionExpression(parent)) {
            shape = 'type assertion wrapping state (`(s as T).foo`)'
          }
        }
        if (!isTracked) {
          markOpaque(out, node, shape)
          return
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(body)
}

function describeCallee(node: ts.Expression): string {
  if (ts.isIdentifier(node)) return node.text
  if (ts.isPropertyAccessExpression(node)) {
    return `${describeCallee(node.expression)}.${node.name.text}`
  }
  return '<expr>'
}

/**
 * Walk the AST and collect every unique state access path referenced by
 * a reactive accessor. A reactive accessor is one of:
 *
 *   - An inline arrow / function expression at a reactive position
 *     (`text(s => s.count)`, `div({ title: s => s.title })`,
 *     `show({ when: s => s.gated })`, etc.).
 *   - An Identifier at a reactive position that resolves to a callable
 *     in this file — a const-bound arrow / function expression,
 *     a hoisted function declaration, or `const x = memo(arrow)`.
 *
 * The second case lets authors refactor a literal arrow into a named
 * helper without losing the reactive-mask optimization (a precise mask
 * for `__dirty` and structural-primitive `__mask`). Without it, the
 * runtime falls back to FULL_MASK — correct, but every binding fires
 * on every state change.
 *
 * Shared by the bit-assignment path (`collectDeps`, below) and the
 * `diagnostics.ts` bitmask-overflow warning.
 */
export function collectStatePathsFromSource(sourceFile: ts.SourceFile): {
  paths: Set<string>
  opaque: boolean
  opaqueNode?: ts.Node
  opaqueShape?: string
} {
  const paths = new Set<string>()
  const opaqueOut: OpaqueOut = { value: false }

  function visit(node: ts.Node): void {
    // Inline arrow / function expression at a reactive position.
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      if (isReactiveAccessor(node)) extractAccessorPaths(node, paths, undefined, opaqueOut)
    }

    // Identifier at a reactive position — resolve to its declaration
    // and extract paths from the resolved body. Identifiers that
    // resolve elsewhere (imports, etc.) leave a binding the walker
    // can't see — treat the host file as opaque so the sentinel fires.
    if (ts.isIdentifier(node) && isReactiveAccessor(node)) {
      const resolved = resolveAccessorBody(node)
      if (resolved) extractAccessorPaths(resolved, paths, undefined, opaqueOut)
      else markOpaque(opaqueOut, node, `unresolvable accessor reference \`${node.text}\``)
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return {
    paths,
    opaque: opaqueOut.value,
    opaqueNode: opaqueOut.node,
    opaqueShape: opaqueOut.shape,
  }
}

/**
 * Per-accessor path sets — one entry per reactive arrow/function. Used
 * by the bitmask-overflow diagnostic to find clusters of paths that
 * always fire together (co-occurrence analysis).
 */
export function collectAccessorPathSets(sourceFile: ts.SourceFile): Set<string>[] {
  const sets: Set<string>[] = []

  function visit(node: ts.Node): void {
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      if (isReactiveAccessor(node)) {
        const set = new Set<string>()
        if (extractAccessorPaths(node, set)) sets.push(set)
      }
    }

    if (ts.isIdentifier(node) && isReactiveAccessor(node)) {
      const resolved = resolveAccessorBody(node)
      if (resolved) {
        const set = new Set<string>()
        if (extractAccessorPaths(resolved, set)) sets.push(set)
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return sets
}

/**
 * Pre-scan a source file to collect all unique state access paths
 * referenced by reactive accessors (arrow functions in props and text() calls).
 *
 * Returns a pair of maps:
 *   - `lo`: paths at bit positions 0..30, with value `1 << position`
 *   - `hi`: paths at bit positions 31..61, with value `1 << (position - 31)`
 *
 * Bit positions past 61 collapse to `-1` (FULL_MASK) in the `lo` map and
 * cause every binding reading them to re-evaluate on every cycle. The
 * `bitmask-overflow` lint rule warns the user to restructure state.
 *
 * Components with ≤31 paths see an empty `hi` map; the compiler skips
 * all high-word emit so the generated code is byte-identical to the
 * pre-multi-word baseline.
 */
export function collectDeps(
  source: string,
  extraPaths?: ReadonlySet<string>,
): {
  lo: Map<string, number>
  hi: Map<string, number>
  opaque: boolean
  /** AST node that first triggered the opaque-flow flag (if any). */
  opaqueNode?: ts.Node
  /** Short human label for the opaque shape. */
  opaqueShape?: string
} {
  const sourceFile = ts.createSourceFile('input.ts', source, ts.ScriptTarget.Latest, true)

  // Check if file imports from @llui/dom
  if (!hasLluiImport(sourceFile)) {
    return { lo: new Map(), hi: new Map(), opaque: false }
  }

  const { paths, opaque, opaqueNode, opaqueShape } = collectStatePathsFromSource(sourceFile)
  // Cross-file extension (v2c pipeline integration): the host adapter may
  // pass paths discovered by `crossFileAccessorPaths()` — paths read
  // through in-repo view-helpers in *other* files. Union them with the
  // file-local set before bit assignment. Without this merge the
  // sentinel-`show()` workaround from v2b §1 remains necessary; with
  // it, helpers in other files contribute to the consumer's __prefixes
  // table automatically.
  if (extraPaths) {
    for (const p of extraPaths) paths.add(p)
  }

  const lo = new Map<string, number>()
  const hi = new Map<string, number>()
  let index = 0
  for (const path of paths) {
    if (index < 31) {
      lo.set(path, 1 << index)
    } else if (index < 62) {
      hi.set(path, 1 << (index - 31))
    } else {
      // Past 61 paths — graceful FULL_MASK fallback in the low word.
      // Realistic LLui components shouldn't hit this; the lint rule
      // fires well before.
      lo.set(path, -1)
    }
    index++
  }

  return { lo, hi, opaque, opaqueNode, opaqueShape }
}

function hasLluiImport(sourceFile: ts.SourceFile): boolean {
  for (const stmt of sourceFile.statements) {
    if (
      ts.isImportDeclaration(stmt) &&
      ts.isStringLiteral(stmt.moduleSpecifier) &&
      stmt.moduleSpecifier.text === '@llui/dom'
    ) {
      return true
    }
  }
  return false
}

/**
 * Determines if a node is at a reactive-accessor position — either an
 * inline arrow / function expression OR an identifier that's about to
 * be resolved to one. The check is identity-based on `parent.arguments[0]`
 * etc., so the same logic works for both shapes.
 *
 * Exported so the cross-file walker can use the same gate. Without this
 * gate the walker descends into every 1-param arrow in the file —
 * including `onEffect: (bag) => bag.send(...)` — and pollutes
 * `__prefixes` with non-state property names (issue #5, bug 3).
 */
export function isReactiveAccessor(node: ts.Node): boolean {
  const parent = node.parent

  // text(s => s.count) — first arg to a call
  if (ts.isCallExpression(parent) && parent.arguments[0] === node) {
    // Bare-identifier callee — only the small set of @llui/dom primitives
    // that take a reactive accessor as arg[0] qualifies. Defaulting to
    // `true` here used to misclassify every user mutator (change(updater),
    // dispatch(s), setTimeout(fn, ms), array helpers like
    // `tryGet(s).then(arrow)`, etc.) as a reactive accessor, with two
    // downstream symptoms: (a) the path collector treated the arrow's
    // param as state and polluted `__prefixes` with phantom paths;
    // (b) the opaque-state-flow lint walked the body and flagged
    // perfectly legitimate updater patterns like
    // `change((c) => cond ? newC : c)` as "state in conditional branch".
    // The PropertyAssignment branch below already uses the equivalent
    // allow-list pattern (`REACTIVE_API_NAMES.has(...)`); this branch
    // is now symmetric.
    //
    // Destructured-renamed View-bag aliases (`view: ({text: t}) =>
    // [t(s => ...)]`) resolve via the primitive's property name, so the
    // membership check uses the original primitive name rather than the
    // local alias. Without this, `t(s => s.count)` would silently skip
    // path collection and mask injection.
    if (ts.isIdentifier(parent.expression)) {
      const originalName = resolveBareIdentToPrimitive(parent.expression)
      return REACTIVE_BARE_IDENT_ARG0.has(originalName)
    }
    // Skip array method callbacks: .filter(t => ...), .map(t => ...), .some(t => ...), etc.
    // Allow view-helper primitive calls — same set as the bare-identifier
    // allow-list above, kept in sync so `h.text(s => …)` and `text(s => …)`
    // are treated symmetrically.
    if (ts.isPropertyAccessExpression(parent.expression)) {
      if (REACTIVE_BARE_IDENT_ARG0.has(parent.expression.name.text)) return true
      return false
    }
    return false
  }

  // div({ title: s => s.title }) — value in a property assignment inside an object literal.
  // Only treat as reactive if the containing call is a known framework API whose
  // properties are reactive accessors. Otherwise user-land helpers like
  // sliceHandler({ narrow: (m) => m.type === ... }) would pollute the path set.
  if (ts.isPropertyAssignment(parent)) {
    // The `node` here might be the property KEY rather than the VALUE
    // — ts.forEachChild iterates both. Only the value is a reactive
    // position; without this guard, the `title` Identifier in
    // `div({ title: arrow })` would route into the value-classification
    // branch and (since it has no resolvable accessor body) flip the
    // file's `opaque` flag, silently degrading mask precision for
    // every component in the file. The bug was latent for a long time
    // because no diagnostic surfaced the resulting whole-state
    // sentinel; the file-wide opaque-accessor diagnostic added in
    // 2026-05 made it visible.
    if (parent.initializer !== node) return false
    const key = parent.name
    if (ts.isIdentifier(key)) {
      // Skip event handlers (onClick, onInput, etc.)
      if (/^on[A-Z]/.test(key.text)) return false
      // Skip each() key function and other non-reactive props
      if (key.text === 'key' || key.text === 'name') return false
      // Skip view-builder slots: `default` / `render` / `fallback` on the
      // structural primitives. Their callbacks receive a View<S, M> bag,
      // not state — e.g. `branch({ default: (h) => h.text(...) })`. The
      // single param is `h`, not `s`; treating it as a reactive accessor
      // makes the opaque-flow walker chase `h` references as if they
      // were state. The runtime knows these slots are view builders;
      // the compiler did not, until now.
      if (key.text === 'default' || key.text === 'render' || key.text === 'fallback') {
        return false
      }
      // Skip `cases.<k>` — the nested-object form of branch() cases.
      // Each value is `(h: View<S, M>) => Node[]`, same as `default`.
      // Identified by the enclosing object literal sitting in a
      // `cases:` property assignment.
      const enclosingObjLit = parent.parent
      if (enclosingObjLit && ts.isObjectLiteralExpression(enclosingObjLit)) {
        const outerPA = enclosingObjLit.parent
        if (
          outerPA &&
          ts.isPropertyAssignment(outerPA) &&
          ts.isIdentifier(outerPA.name) &&
          outerPA.name.text === 'cases'
        ) {
          return false
        }
      }
      // Walk up to find the enclosing call expression
      let ancestor: ts.Node | undefined = parent.parent // ObjectLiteralExpression
      while (ancestor && !ts.isCallExpression(ancestor)) {
        ancestor = ancestor.parent
      }
      if (!ancestor) return false
      const callExpr = ancestor as ts.CallExpression
      // Bare identifier: `scope({on: …})`, `div({title: …})`, etc.
      if (ts.isIdentifier(callExpr.expression)) {
        return REACTIVE_API_NAMES.has(callExpr.expression.text)
      }
      // Method-call form: `h.scope({on: …})`, `h.show({when: …})`, etc.
      // The docs and View bag promote this shape; without recognizing it
      // here, paths read ONLY through a structural primitive's
      // `on`/`when`/`items` accessor never enter `__prefixes`, so the
      // runtime dirty mask can't see changes to those fields and the
      // structural block silently fails to reconcile.
      if (ts.isPropertyAccessExpression(callExpr.expression)) {
        return REACTIVE_API_NAMES.has(callExpr.expression.name.text)
      }
      return false
    }
  }

  return false
}

// Framework primitives whose first positional argument IS a reactive
// accessor (an arrow taking state). The set is intentionally tiny —
// every other bare-identifier callee with an arrow arg0 (user mutators,
// async helpers, timers, array constructors, …) must NOT be visited as
// a reactive accessor, or its closure parameter gets misclassified as
// state and its body gets walked by the opaque-flow lint.
//
// Excluded by design:
//   - `sample(s => s.x)` — imperative one-shot read, no binding.
//   - `item(t => t.x)` — per-item selector inside an `each.render`
//     callback; the param is per-row, not the component's state.
//   - `track({ deps })` — takes an object literal, not an arrow.
//   - `provide(key, accessor)` — accessor is arg1, not arg0.
const REACTIVE_BARE_IDENT_ARG0 = new Set(['text', 'memo', 'unsafeHtml', 'selector'])

/**
 * Resolve a bare-identifier callee back to the original primitive name,
 * unwrapping the alias forms an author can produce locally:
 *
 *   - Destructure rename in a function parameter — the canonical View-bag
 *     pattern: `view: ({text: t}) => [t(s => …)]` aliases `t` to `text`.
 *   - Destructure rename in a `const { ... } = …` declaration.
 *   - Const rebinding: `const t = text; t(s => …)` aliases `t` to `text`.
 *
 * The walker climbs the lexical scope finding the innermost binding for
 * `ident.text`; for const rebinding it recursively follows the
 * initializer when it's another bare Identifier (with a visited-set
 * guard against cycles like `const a = b; const b = a`). Stops at the
 * first non-Identifier initializer — `const t = someCall()` returns
 * `'t'` unchanged, because the value isn't a primitive name we can
 * statically pin.
 *
 * Restricted to local lexical resolution. Cross-file alias chains
 * (`import { t } from './aliases'`) are the cross-file resolver's job;
 * this AST-only predicate stops at the module boundary.
 */
function resolveBareIdentToPrimitive(ident: ts.Identifier): string {
  const result = resolveBareIdentFrom(ident, ident.text, new Set())
  return result ?? ident.text
}

// Returns:
//   - string: the resolved primitive-candidate name (caller checks
//     REACTIVE_BARE_IDENT_ARG0 membership).
//   - null: a local declaration was found that shadows the name with
//     a value the resolver can't follow (e.g. `const t = someCall()`,
//     `const t = (x) => …`). The caller should treat as a non-primitive
//     local binding. Distinguishing `null` from "name unchanged" matters
//     when the name happens to match a primitive — e.g.
//     `const text = (x) => x.toUpperCase()` followed by `text((s) => …)`
//     must NOT be classified as reactive.
function resolveBareIdentFrom(
  fromNode: ts.Node,
  name: string,
  visited: Set<string>,
): string | null {
  if (visited.has(name)) return null
  visited.add(name)
  let node: ts.Node = fromNode
  while (node.parent) {
    const parent = node.parent
    let params: readonly ts.ParameterDeclaration[] | null = null
    let statements: readonly ts.Statement[] | null = null
    if (
      ts.isArrowFunction(parent) ||
      ts.isFunctionExpression(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isMethodDeclaration(parent)
    ) {
      params = parent.parameters
    } else if (ts.isBlock(parent) || ts.isSourceFile(parent) || ts.isModuleBlock(parent)) {
      statements = parent.statements
    }
    if (params) {
      for (const param of params) {
        if (!ts.isObjectBindingPattern(param.name)) continue
        const hit = findInBindingPattern(param.name, name)
        if (hit !== null) return hit
      }
      // Identifier-binding parameter shadowing (`(text: …) => text(…)`):
      // the parameter itself binds `name` to whatever the caller passed,
      // which we can't see locally. Treat as shadowed.
      for (const param of params) {
        if (ts.isIdentifier(param.name) && param.name.text === name) return null
      }
    }
    if (statements) {
      for (const stmt of statements) {
        if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === name) {
          // `function text(...) { … }` — local function shadows the name.
          return null
        }
        if (ts.isImportDeclaration(stmt)) {
          if (importShadowsName(stmt, name)) {
            // Imported binding with this name. We can't statically
            // confirm whether it actually resolves to the @llui/dom
            // primitive (could be `import { text } from './my-utils'`),
            // so the caller mustn't assume primitive-hood blindly.
            // Defer to the existing transform.ts viewHelperNames pass,
            // which IS import-aware, and treat as a primitive-named
            // binding here. Returning `name` preserves the existing
            // predicate behavior for direct `import { text } from
            // '@llui/dom'`; the residual user-shadows-via-rename-import
            // case is a pre-existing predicate gap (transform.ts has
            // the same gap), not regressed by this change.
            return name
          }
        }
        if (!ts.isVariableStatement(stmt)) continue
        const isConst = !!(stmt.declarationList.flags & ts.NodeFlags.Const)
        for (const decl of stmt.declarationList.declarations) {
          // `const { text: t } = h` — destructure rename.
          if (ts.isObjectBindingPattern(decl.name)) {
            const hit = findInBindingPattern(decl.name, name)
            if (hit !== null) return hit
            continue
          }
          if (!ts.isIdentifier(decl.name) || decl.name.text !== name) continue
          // Bound to `name` at this scope — stop here regardless of how
          // it's bound. Either we can follow (const rebinding to another
          // identifier) or this is a shadowing definition we can't see
          // through.
          if (isConst && decl.initializer && ts.isIdentifier(decl.initializer)) {
            return resolveBareIdentFrom(decl.initializer, decl.initializer.text, visited)
          }
          return null
        }
      }
    }
    node = parent
  }
  return name
}

function importShadowsName(imp: ts.ImportDeclaration, name: string): boolean {
  const clause = imp.importClause
  if (!clause) return false
  if (clause.name && clause.name.text === name) return true // default import
  const bindings = clause.namedBindings
  if (!bindings) return false
  if (ts.isNamespaceImport(bindings)) return bindings.name.text === name
  if (ts.isNamedImports(bindings)) {
    for (const spec of bindings.elements) {
      if (spec.name.text === name) return true
    }
  }
  return false
}

function findInBindingPattern(pat: ts.ObjectBindingPattern, localName: string): string | null {
  for (const element of pat.elements) {
    if (!ts.isIdentifier(element.name)) continue
    if (element.name.text !== localName) continue
    // `{ text: t }` — propertyName='text', name='t' → original is 'text'.
    // `{ text }` — no propertyName, name='text' → original is 'text'.
    if (element.propertyName && ts.isIdentifier(element.propertyName)) {
      return element.propertyName.text
    }
    return localName
  }
  return null
}

// Framework APIs whose object-literal arguments contain reactive accessors.
// Arrow functions in property values of these calls are state-tracked.
const REACTIVE_API_NAMES = new Set([
  // Element helpers (see ELEMENT_HELPERS in transform.ts — we keep a superset here)
  ...[
    'a',
    'abbr',
    'article',
    'aside',
    'b',
    'blockquote',
    'br',
    'button',
    'canvas',
    'code',
    'dd',
    'details',
    'dialog',
    'div',
    'dl',
    'dt',
    'em',
    'fieldset',
    'figcaption',
    'figure',
    'footer',
    'form',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'header',
    'hr',
    'i',
    'iframe',
    'img',
    'input',
    'label',
    'legend',
    'li',
    'main',
    'mark',
    'nav',
    'ol',
    'optgroup',
    'option',
    'output',
    'p',
    'pre',
    'progress',
    'section',
    'select',
    'small',
    'span',
    'strong',
    'sub',
    'summary',
    'sup',
    'table',
    'tbody',
    'td',
    'textarea',
    'tfoot',
    'th',
    'thead',
    'time',
    'tr',
    'ul',
    'video',
  ],
  // Structural primitives
  'each',
  'branch',
  'scope',
  'show',
  'memo',
  'portal',
  'foreign',
  'child',
  'errorBoundary',
  // track({ deps: (s) => [...] }) — explicit reactivity declaration for
  // paths static analysis can't infer. The compiler treats `deps` as a
  // reactive accessor so its paths fold into the host component's
  // __prefixes; the call expression is then stripped from emission
  // (see transform.ts). v2b §3.
  'track',
])

/**
 * Extract state access paths from an expression body.
 * Handles:
 * - Direct property access: param.field, param.field.subfield
 * - Bracket notation with string literal: param['field']
 */
function extractPaths(node: ts.Node, paramName: string, _prefix: string, paths: Set<string>): void {
  if (ts.isPropertyAccessExpression(node)) {
    // Skip if this is an intermediate in a deeper chain
    if (ts.isPropertyAccessExpression(node.parent)) {
      // handled when the leaf is visited
    }
    // Skip if this is the callee of a method call: s.todos.filter(...)
    else if (ts.isCallExpression(node.parent) && node.parent.expression === node) {
      // It's a method call — record the object, not the method
      // e.g. s.todos.filter(...) → record 'todos', not 'todos.filter'
      if (ts.isPropertyAccessExpression(node.expression)) {
        const chain = resolvePropertyChain(node.expression, paramName)
        if (chain) paths.add(chain)
      }
    } else {
      const chain = resolvePropertyChain(node, paramName)
      if (chain) {
        paths.add(chain)
      }
    }
  }

  if (ts.isElementAccessExpression(node)) {
    const chain = resolveElementAccess(node, paramName)
    if (chain) {
      paths.add(chain)
    }
  }

  ts.forEachChild(node, (child) => extractPaths(child, paramName, _prefix, paths))
}

/**
 * Resolve a property access chain like s.user.name to "user.name".
 * Returns null if the chain doesn't start with the state parameter.
 * Stops at depth 2.
 */
function resolvePropertyChain(node: ts.PropertyAccessExpression, paramName: string): string | null {
  const parts: string[] = []
  let current: ts.Expression = node

  while (ts.isPropertyAccessExpression(current)) {
    parts.unshift(current.name.text)
    current = current.expression
  }

  // The root must be the state parameter
  if (!ts.isIdentifier(current) || current.text !== paramName) {
    return null
  }

  // Limit to depth 2
  if (parts.length > 2) {
    return parts.slice(0, 2).join('.')
  }

  return parts.join('.')
}

/**
 * Resolve bracket access with string literal: s['count'] → "count"
 */
function resolveElementAccess(node: ts.ElementAccessExpression, paramName: string): string | null {
  if (!ts.isIdentifier(node.expression) || node.expression.text !== paramName) {
    return null
  }

  if (ts.isStringLiteral(node.argumentExpression)) {
    return node.argumentExpression.text
  }

  return null
}
