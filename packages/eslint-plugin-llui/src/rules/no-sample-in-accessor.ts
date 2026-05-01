import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils'
import { createRule } from '../createRule.js'

/**
 * Flags `sample()` / `h.sample()` calls inside an accessor passed to a
 * known structural primitive (`each.items`, `each.key`, `branch.on`,
 * `show.when`, `scope.on`, `child.props`, `foreign.props`) or a known
 * binding helper (`text`, `unsafeHtml`).
 *
 * Why it's wrong: accessors are pure functions of their parameter. The
 * compiler computes a mask from `param.X` reads on the parameter only;
 * `sample(s2 => s2.X)` is invisible because `s2` is a fresh identifier.
 * The hidden read either:
 *
 *   - skips reconciliation when the sampled state changes (mask gating
 *     filters it out), causing UI to go stale silently, or
 *   - throws at the first reconcile because the runtime no longer sets
 *     a render context during the update phase. In both cases the bug
 *     is invisible at compile time.
 *
 * To depend on outer state inside an accessor, lift it into the
 * accessor's parameter:
 *
 * ```ts
 * // ❌ wrong — sample() in key is invisible to mask gating
 * each({
 *   items: (s) => s.rows,
 *   key: (it) => `${it.id}|${sample(s => s.rev)}`,
 * })
 *
 * // ✅ right — bake outer state into the items map
 * each({
 *   items: (s) => s.rows.map((it) => ({ it, rev: s.rev })),
 *   key: (r) => `${r.it.id}|${r.rev}`,
 * })
 * ```
 *
 * The runtime backstop in `@llui/dom` throws a targeted error if this
 * pattern reaches production, but lint catches it at edit time with no
 * runtime cost.
 *
 * Sister rule of `no-sample-in-reactive-position`, which catches the
 * adjacent antipattern of passing `sample()`'s *result* (a static value)
 * to a reactive position. This rule catches `sample()` *invoked from
 * inside* an accessor (a static read inside a reactive context).
 */

// Map of primitive-call-callee-name → set of property names whose values
// are accessors. The rule walks each accessor body for sample() calls.
const ACCESSOR_PROPS_BY_PRIMITIVE: Record<string, Set<string>> = {
  each: new Set(['items', 'key']),
  branch: new Set(['on']),
  show: new Set(['when']),
  scope: new Set(['on']),
  child: new Set(['props']),
  foreign: new Set(['props']),
}

// Binding helpers whose first argument is the reactive accessor. The body
// of that arrow runs at every commit — sample() inside it is the same
// hidden-dep antipattern.
const BINDING_HELPERS = new Set(['text', 'unsafeHtml'])

function isSampleCall(node: TSESTree.Node): boolean {
  if (node.type !== AST_NODE_TYPES.CallExpression) return false
  if (node.callee.type === AST_NODE_TYPES.Identifier && node.callee.name === 'sample') {
    return true
  }
  if (
    node.callee.type === AST_NODE_TYPES.MemberExpression &&
    node.callee.property.type === AST_NODE_TYPES.Identifier &&
    node.callee.property.name === 'sample'
  ) {
    return true
  }
  return false
}

function findFirstSampleInside(body: TSESTree.Node): TSESTree.CallExpression | null {
  let found: TSESTree.CallExpression | null = null
  const visit = (n: TSESTree.Node | null | undefined): void => {
    if (!n || found) return
    if (isSampleCall(n)) {
      found = n as TSESTree.CallExpression
      return
    }
    // Don't descend into nested function bodies — a sample() inside a
    // separate inner closure (event handler, callback for an effect)
    // isn't running in the accessor's reactive position. Limiting the
    // walk to the direct accessor body avoids false positives like
    //   key: (it) => { onClick: () => sample(...) }
    if (
      n.type === AST_NODE_TYPES.ArrowFunctionExpression ||
      n.type === AST_NODE_TYPES.FunctionExpression ||
      n.type === AST_NODE_TYPES.FunctionDeclaration
    ) {
      // Top-level body itself is a function — don't skip it; only skip
      // _nested_ functions encountered during traversal.
      if (n !== body) return
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
  visit(body)
  return found
}

function getCalleeName(callee: TSESTree.Expression | TSESTree.PrivateIdentifier): string | null {
  if (callee.type === AST_NODE_TYPES.Identifier) return callee.name
  if (
    callee.type === AST_NODE_TYPES.MemberExpression &&
    callee.property.type === AST_NODE_TYPES.Identifier
  ) {
    return callee.property.name
  }
  return null
}

export const noSampleInAccessorRule = createRule({
  name: 'no-sample-in-accessor',
  meta: {
    type: 'problem',
    docs: {
      description:
        "`sample()` inside an accessor (each.key, each.items, branch.on, show.when, scope.on, child.props, foreign.props, or a binding accessor like `text(s => …)`) reads outer state invisibly to the compiler's mask analysis and breaks reconciliation. Lift the dep into the accessor's parameter instead.",
    },
    schema: [],
    messages: {
      sampleInAccessor:
        "`sample()` inside `{{primitive}}({{prop}}: …)` reads state outside the accessor's parameter — invisible to the compiler's mask analysis. The accessor must be a pure function of its parameter. Lift the outer state into the parameter (e.g. for `each.key`, bake the dep into `items`: `items: (s) => s.rows.map(it => ({ it, rev: s.rev }))`, then `key: (r) => \\`${r.it.id}|${r.rev}\\``).",
      sampleInBinding:
        "`sample()` inside `{{primitive}}((s) => …)` is redundant and invisible to mask analysis. Read the state directly via the accessor's parameter — `{{primitive}}((s) => s.field)` re-runs reactively on every commit; the `sample()` wrapper bypasses that.",
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      CallExpression(node) {
        const name = getCalleeName(node.callee)
        if (!name) return

        // Structural primitives — first arg is options object with named accessor props
        const accessorProps = ACCESSOR_PROPS_BY_PRIMITIVE[name]
        if (accessorProps !== undefined) {
          const opts = node.arguments[0]
          if (!opts || opts.type !== AST_NODE_TYPES.ObjectExpression) return
          for (const prop of opts.properties) {
            if (prop.type !== AST_NODE_TYPES.Property) continue
            if (prop.key.type !== AST_NODE_TYPES.Identifier) continue
            if (!accessorProps.has(prop.key.name)) continue
            const value = prop.value
            if (
              value.type !== AST_NODE_TYPES.ArrowFunctionExpression &&
              value.type !== AST_NODE_TYPES.FunctionExpression
            ) {
              continue
            }
            const sample = findFirstSampleInside(value.body)
            if (sample) {
              context.report({
                node: sample,
                messageId: 'sampleInAccessor',
                data: { primitive: name, prop: prop.key.name },
              })
            }
          }
          return
        }

        // Binding helpers — first arg is the accessor arrow itself
        if (BINDING_HELPERS.has(name)) {
          const arg = node.arguments[0]
          if (
            !arg ||
            (arg.type !== AST_NODE_TYPES.ArrowFunctionExpression &&
              arg.type !== AST_NODE_TYPES.FunctionExpression)
          ) {
            return
          }
          const sample = findFirstSampleInside(arg.body)
          if (sample) {
            context.report({
              node: sample,
              messageId: 'sampleInBinding',
              data: { primitive: name },
            })
          }
        }
      },
    }
  },
})
