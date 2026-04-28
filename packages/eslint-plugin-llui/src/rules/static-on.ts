import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils'
import { createRule } from '../createRule.js'

/**
 * Warns when `scope({ on })` or `branch({ on })` receives a discriminant
 * accessor that doesn't read any state. Without state reads, the key
 * never changes after mount and the subtree never rebuilds — almost
 * certainly a bug.
 *
 * Migrated from the Vite plugin's `static-on` diagnostic.
 */

/**
 * Heuristic for "this body might read mutable state from somewhere."
 * Returns true if the body contains a CallExpression or
 * MemberExpression — both of which can route to mutable sources
 * (item accessors, memo readers, closure-captured selectors). Returns
 * false only for bodies whose deepest content is a literal or bare
 * identifier, which definitionally can't change after mount.
 */
function bodyMayRead(body: TSESTree.Node): boolean {
  let found = false
  const visit = (n: TSESTree.Node | null | undefined) => {
    if (!n || found) return
    if (n.type === AST_NODE_TYPES.CallExpression || n.type === AST_NODE_TYPES.MemberExpression) {
      found = true
      return
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

function readsParam(node: TSESTree.Node, paramName: string): boolean {
  let found = false
  const visit = (n: TSESTree.Node | null | undefined) => {
    if (!n || found) return
    if (
      n.type === AST_NODE_TYPES.MemberExpression &&
      n.object.type === AST_NODE_TYPES.Identifier &&
      n.object.name === paramName
    ) {
      found = true
      return
    }
    if (
      n.type === AST_NODE_TYPES.Identifier &&
      n.name === paramName &&
      // The bare identifier read counts only when used as something
      // other than the object root we already detected. A `s` token
      // alone is rare in `on` accessors but treat it as a state read.
      true
    ) {
      // Skip when it's the `object` of a MemberExpression handled above.
      const parent = (n as { parent?: TSESTree.Node }).parent
      if (parent && parent.type === AST_NODE_TYPES.MemberExpression && parent.object === n) {
        // Already counted via MemberExpression case.
        return
      }
      // Bare identifier reference — author may have destructured the
      // accessor's body (uncommon). Treat as a read.
      // Do nothing; we don't want bare-name to count, since `on: (s) => 'x'`
      // doesn't actually read state.
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
  visit(node)
  return found
}

export const staticOnRule = createRule({
  name: 'static-on',
  meta: {
    type: 'problem',
    docs: {
      description:
        '`scope`/`branch`’s `on` accessor must read state — otherwise the key never changes and the subtree mounts once, then stagnates.',
    },
    schema: [],
    messages: {
      static:
        "{{name}}(): 'on' reads no state — the key never changes, so the subtree mounts once and never rebuilds. Is this intentional? If so, replace with a static builder; if not, reference the state field(s) that drive the discriminant.",
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type !== AST_NODE_TYPES.Identifier) return
        const name = node.callee.name
        if (name !== 'scope' && name !== 'branch') return
        const opts = node.arguments[0]
        if (!opts || opts.type !== AST_NODE_TYPES.ObjectExpression) return
        const onProp = opts.properties.find(
          (p): p is TSESTree.Property =>
            p.type === AST_NODE_TYPES.Property &&
            p.key.type === AST_NODE_TYPES.Identifier &&
            p.key.name === 'on',
        )
        if (!onProp) return
        const value = onProp.value
        if (
          value.type !== AST_NODE_TYPES.ArrowFunctionExpression &&
          value.type !== AST_NODE_TYPES.FunctionExpression
        ) {
          return
        }
        // Zero-param arrow is legitimate when invoked inside an
        // `each.render` callback — `on: () => item.kind()` reads from
        // the closed-over ItemAccessor, which itself tracks state via
        // the each binding. We can't always tell from AST whether
        // we're inside an each or not, so the heuristic: skip the
        // warning if the body contains a CallExpression or
        // MemberExpression — both signal "reading something
        // potentially state-derived." Bare-literal bodies
        // (`() => 'x'`) still fire below.
        if (value.params.length === 0) {
          if (bodyMayRead(value.body)) return
          context.report({ node, messageId: 'static', data: { name } })
          return
        }
        if (value.params.length !== 1) return
        const param = value.params[0]
        if (!param || param.type !== AST_NODE_TYPES.Identifier) return
        if (readsParam(value.body, param.name)) return
        context.report({ node, messageId: 'static', data: { name } })
      },
    }
  },
})
