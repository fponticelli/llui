import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils'
import { ELEMENT_HELPERS } from './element-helpers.js'

/**
 * State-path scanner for ESTree (the typescript-eslint AST). Mirrors
 * the TS-Compiler-API scanner in `@llui/vite-plugin/src/collect-deps.ts`
 * — same heuristics for what counts as a *reactive accessor*, same
 * depth-2 path normalisation, same allowlist of framework APIs whose
 * arrow-prop values are state-tracked.
 *
 * Used by:
 *  - `bitmask-overflow` rule (counts unique paths, warns past 31)
 *  - co-occurrence detection inside the same rule (per-accessor sets)
 *
 * The Vite-plugin scanner is the source of truth for runtime bit
 * assignment; this scanner is a port of its analysis half. Drift would
 * cause the lint warning to disagree with the runtime bitmask
 * cardinality — mirror changes in both places.
 */

/**
 * Framework-API call names whose object-literal property values are
 * treated as reactive accessors. Mirrors `REACTIVE_API_NAMES` in
 * `collect-deps.ts`.
 */
const REACTIVE_API_NAMES = new Set<string>([
  ...ELEMENT_HELPERS,
  'each',
  'branch',
  'scope',
  'show',
  'memo',
  'portal',
  'foreign',
  'child',
  'errorBoundary',
])

type AccessorFn = TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression

/**
 * Mirror of `isReactiveAccessor` from `collect-deps.ts`:
 *
 *   - `text(s => s.x)` / `memo(s => s.x)` — first arg of a call.
 *   - `div({ title: s => s.title })` — value in a property assignment
 *     inside an object-literal arg of a known reactive API.
 *   - Skips `item(t => t.id)` and `sample(s => s.x)` — not reactive.
 *   - Skips array-method callbacks (`.filter`, `.map`, ...).
 *   - Skips event-handler-shaped keys (`onClick`, `onInput`, ...) and
 *     `key` / `name` props.
 */
function isReactiveAccessor(fn: AccessorFn): boolean {
  const parent = fn.parent
  if (!parent) return false
  // First-arg-of-call pattern.
  if (parent.type === AST_NODE_TYPES.CallExpression && parent.arguments[0] === fn) {
    const callee = parent.callee
    if (callee.type === AST_NODE_TYPES.Identifier) {
      if (callee.name === 'item' || callee.name === 'sample') return false
      return true
    }
    if (callee.type === AST_NODE_TYPES.MemberExpression) {
      if (callee.property.type !== AST_NODE_TYPES.Identifier) return false
      const name = callee.property.name
      if (name === 'text' || name === 'memo') return true
      return false
    }
    return true
  }
  // Property-value-of-reactive-API pattern.
  if (parent.type === AST_NODE_TYPES.Property) {
    const key = parent.key
    if (key.type !== AST_NODE_TYPES.Identifier) return false
    if (/^on[A-Z]/.test(key.name)) return false
    if (key.name === 'key' || key.name === 'name') return false
    let ancestor: TSESTree.Node | undefined = parent.parent
    while (ancestor && ancestor.type !== AST_NODE_TYPES.CallExpression) {
      ancestor = ancestor.parent
    }
    if (!ancestor) return false
    const callExpr = ancestor as TSESTree.CallExpression
    if (callExpr.callee.type !== AST_NODE_TYPES.Identifier) return false
    return REACTIVE_API_NAMES.has(callExpr.callee.name)
  }
  return false
}

/**
 * Resolve a chain like `s.user.name` (rooted at `paramName`) to the
 * depth-2 string `"user.name"`. Returns null if the chain doesn't start
 * at the parameter or if it's empty.
 */
function resolveMemberChain(node: TSESTree.MemberExpression, paramName: string): string | null {
  const parts: string[] = []
  let current: TSESTree.Expression | TSESTree.PrivateIdentifier = node
  while (
    current.type === AST_NODE_TYPES.MemberExpression &&
    !current.computed &&
    current.property.type === AST_NODE_TYPES.Identifier
  ) {
    parts.unshift(current.property.name)
    current = current.object
  }
  if (current.type !== AST_NODE_TYPES.Identifier || current.name !== paramName) return null
  if (parts.length === 0) return null
  return parts.slice(0, 2).join('.')
}

function resolveBracketAccess(node: TSESTree.MemberExpression, paramName: string): string | null {
  if (!node.computed) return null
  if (node.object.type !== AST_NODE_TYPES.Identifier || node.object.name !== paramName) {
    return null
  }
  const arg = node.property
  if (arg.type === AST_NODE_TYPES.Literal && typeof arg.value === 'string') return arg.value
  return null
}

function extractPaths(node: TSESTree.Node, paramName: string, out: Set<string>): void {
  if (node.type === AST_NODE_TYPES.MemberExpression) {
    if (node.computed) {
      const path = resolveBracketAccess(node, paramName)
      if (path) out.add(path)
    } else if (
      node.parent?.type === AST_NODE_TYPES.MemberExpression &&
      node.parent.object === node
    ) {
      // Intermediate node — handled when leaf is visited.
    } else if (node.parent?.type === AST_NODE_TYPES.CallExpression && node.parent.callee === node) {
      // Method call — record the receiver's chain, not the method.
      if (node.object.type === AST_NODE_TYPES.MemberExpression) {
        const chain = resolveMemberChain(node.object, paramName)
        if (chain) out.add(chain)
      }
    } else {
      const chain = resolveMemberChain(node, paramName)
      if (chain) out.add(chain)
    }
  }
  for (const key of Object.keys(node) as (keyof typeof node)[]) {
    if (key === 'parent' || key === 'loc' || key === 'range') continue
    const child = node[key] as unknown
    if (Array.isArray(child)) {
      for (const c of child) {
        if (c && typeof c === 'object' && 'type' in c)
          extractPaths(c as TSESTree.Node, paramName, out)
      }
    } else if (child && typeof child === 'object' && 'type' in (child as object)) {
      extractPaths(child as TSESTree.Node, paramName, out)
    }
  }
}

/**
 * Walk the program, find every reactive accessor, collect the union of
 * all state paths read across them.
 */
export function collectStatePaths(program: TSESTree.Program): Set<string> {
  const paths = new Set<string>()
  const visit = (n: TSESTree.Node | null | undefined) => {
    if (!n) return
    if (
      (n.type === AST_NODE_TYPES.ArrowFunctionExpression ||
        n.type === AST_NODE_TYPES.FunctionExpression) &&
      n.params.length === 1 &&
      n.params[0]!.type === AST_NODE_TYPES.Identifier &&
      isReactiveAccessor(n)
    ) {
      const paramName = (n.params[0] as TSESTree.Identifier).name
      extractPaths(n.body, paramName, paths)
    }
    for (const key of Object.keys(n) as (keyof typeof n)[]) {
      if (key === 'parent' || key === 'loc' || key === 'range') continue
      const child = n[key] as unknown
      if (Array.isArray(child)) {
        for (const c of child) {
          if (c && typeof c === 'object' && 'type' in c) visit(c as TSESTree.Node)
        }
      } else if (child && typeof child === 'object' && 'type' in (child as object)) {
        visit(child as TSESTree.Node)
      }
    }
  }
  visit(program)
  return paths
}

/**
 * Per-accessor path sets — one entry per reactive accessor. Used by
 * the bitmask-overflow co-occurrence pass.
 */
export function collectAccessorPathSets(program: TSESTree.Program): Set<string>[] {
  const sets: Set<string>[] = []
  const visit = (n: TSESTree.Node | null | undefined) => {
    if (!n) return
    if (
      (n.type === AST_NODE_TYPES.ArrowFunctionExpression ||
        n.type === AST_NODE_TYPES.FunctionExpression) &&
      n.params.length === 1 &&
      n.params[0]!.type === AST_NODE_TYPES.Identifier &&
      isReactiveAccessor(n)
    ) {
      const paramName = (n.params[0] as TSESTree.Identifier).name
      const set = new Set<string>()
      extractPaths(n.body, paramName, set)
      if (set.size > 0) sets.push(set)
    }
    for (const key of Object.keys(n) as (keyof typeof n)[]) {
      if (key === 'parent' || key === 'loc' || key === 'range') continue
      const child = n[key] as unknown
      if (Array.isArray(child)) {
        for (const c of child) {
          if (c && typeof c === 'object' && 'type' in c) visit(c as TSESTree.Node)
        }
      } else if (child && typeof child === 'object' && 'type' in (child as object)) {
        visit(child as TSESTree.Node)
      }
    }
  }
  visit(program)
  return sets
}
