import ts from 'typescript'
import { resolveAccessorBody } from './accessor-resolver.js'

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
): void {
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const name = node.expression.text
      if (!NON_DELEGATION_HELPERS.has(name)) {
        const arg0 = node.arguments[0]
        if (arg0 && ts.isIdentifier(arg0) && arg0.text === stateParamName) {
          const resolved = resolveAccessorBody(node.expression)
          if (resolved) follow(resolved)
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
): boolean {
  if (visited.has(accessor)) return false
  visited.add(accessor)

  const params = accessor.parameters
  if (params.length !== 1) return false
  const paramName = params[0]!.name
  if (!ts.isIdentifier(paramName)) return false
  if (!accessor.body) return false
  const before = paths.size

  extractPaths(accessor.body, paramName.text, '', paths)

  // Follow delegations: `(s) => helper(s)` — extract `helper`'s body's
  // state paths too. Reuses the `visited` set across the recursion
  // chain so cycles terminate.
  visitTopLevelDelegations(accessor.body, paramName.text, (resolved) => {
    extractAccessorPaths(resolved, paths, visited)
  })

  return paths.size > before
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
export function collectStatePathsFromSource(sourceFile: ts.SourceFile): Set<string> {
  const paths = new Set<string>()

  function visit(node: ts.Node): void {
    // Inline arrow / function expression at a reactive position.
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      if (isReactiveAccessor(node)) extractAccessorPaths(node, paths)
    }

    // Identifier at a reactive position — resolve to its declaration
    // and extract paths from the resolved body. Skip identifiers
    // imported from elsewhere (resolver returns null) — there's no
    // body to scan, runtime falls back to FULL_MASK.
    if (ts.isIdentifier(node) && isReactiveAccessor(node)) {
      const resolved = resolveAccessorBody(node)
      if (resolved) extractAccessorPaths(resolved, paths)
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return paths
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
} {
  const sourceFile = ts.createSourceFile('input.ts', source, ts.ScriptTarget.Latest, true)

  // Check if file imports from @llui/dom
  if (!hasLluiImport(sourceFile)) {
    return { lo: new Map(), hi: new Map() }
  }

  const paths = collectStatePathsFromSource(sourceFile)
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

  return { lo, hi }
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
    // Skip item(t => t.id) — per-item selectors inside each() render.
    // Skip sample(s => s.x) — imperative one-shot read, no binding created
    // (both the top-level import and the destructured-from-h form).
    if (ts.isIdentifier(parent.expression)) {
      if (parent.expression.text === 'item' || parent.expression.text === 'sample') {
        return false
      }
    }
    // Skip array method callbacks: .filter(t => ...), .map(t => ...), .some(t => ...), etc.
    // Allow view-helper primitive calls: h.text(s => ...), h.memo(s => ...)
    if (ts.isPropertyAccessExpression(parent.expression)) {
      const methodName = parent.expression.name.text
      if (methodName === 'text' || methodName === 'memo') {
        return true
      }
      return false
    }
    return true
  }

  // div({ title: s => s.title }) — value in a property assignment inside an object literal.
  // Only treat as reactive if the containing call is a known framework API whose
  // properties are reactive accessors. Otherwise user-land helpers like
  // sliceHandler({ narrow: (m) => m.type === ... }) would pollute the path set.
  if (ts.isPropertyAssignment(parent)) {
    const key = parent.name
    if (ts.isIdentifier(key)) {
      // Skip event handlers (onClick, onInput, etc.)
      if (/^on[A-Z]/.test(key.text)) return false
      // Skip each() key function and other non-reactive props
      if (key.text === 'key' || key.text === 'name') return false
      // Walk up to find the enclosing call expression
      let ancestor: ts.Node | undefined = parent.parent // ObjectLiteralExpression
      while (ancestor && !ts.isCallExpression(ancestor)) {
        ancestor = ancestor.parent
      }
      if (!ancestor) return false
      const callExpr = ancestor as ts.CallExpression
      if (!ts.isIdentifier(callExpr.expression)) return false
      return REACTIVE_API_NAMES.has(callExpr.expression.text)
    }
  }

  return false
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
