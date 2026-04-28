import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils'
import { createRule } from '../createRule.js'

/**
 * Warns when `each({items})` receives a factory that doesn't read state.
 * Without state reads, the items list is computed once at mount and the
 * `each` never reconciles — adds, removes, and updates to the list will
 * never appear in the DOM. Almost certainly a bug.
 *
 * Symmetric with `static-on` for `branch`/`scope`. Same heuristic:
 * one-param accessors that ignore the param fire; zero-param accessors
 * fire only when the body is bare-literal (no CallExpression / no
 * MemberExpression — definitionally can't be reading state-derived
 * data through a memo, closure, or item accessor).
 *
 * Examples that fire:
 *   each({ items: () => [1, 2, 3], … })       // literal array
 *   each({ items: (s) => CONSTANT_LIST, … })   // ignored param
 *
 * Examples that don't fire:
 *   each({ items: (s) => s.list, … })          // standard reactive
 *   each({ items: () => memoizedRows(), … })   // CallExpression body
 *   each({ items: () => state.items, … })      // MemberExpression body
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

export const staticItemsRule = createRule({
  name: 'static-items',
  meta: {
    type: 'problem',
    docs: {
      description:
        '`each({items})` factory must read state — otherwise the list is computed once at mount and `each` never reconciles, so adds/removes/updates never appear in the DOM.',
    },
    schema: [],
    messages: {
      static:
        "each(): 'items' reads no state — the list is computed once at mount and `each` never reconciles. Adds, removes, and updates to items will never appear. Reference the state field that holds the list (e.g. `items: (s) => s.list.items`).",
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      CallExpression(node) {
        // Match `each({items, …})` and `h.each({items, …})`.
        let isEach = false
        if (node.callee.type === AST_NODE_TYPES.Identifier && node.callee.name === 'each') {
          isEach = true
        } else if (
          node.callee.type === AST_NODE_TYPES.MemberExpression &&
          node.callee.property.type === AST_NODE_TYPES.Identifier &&
          node.callee.property.name === 'each'
        ) {
          isEach = true
        }
        if (!isEach) return

        const opts = node.arguments[0]
        if (!opts || opts.type !== AST_NODE_TYPES.ObjectExpression) return

        const itemsProp = opts.properties.find(
          (p): p is TSESTree.Property =>
            p.type === AST_NODE_TYPES.Property &&
            p.key.type === AST_NODE_TYPES.Identifier &&
            p.key.name === 'items',
        )
        if (!itemsProp) return

        const value = itemsProp.value
        if (
          value.type !== AST_NODE_TYPES.ArrowFunctionExpression &&
          value.type !== AST_NODE_TYPES.FunctionExpression
        ) {
          // `items: someAccessor` (a reference to a state-reading function) —
          // we can't tell statically whether it reads state. Don't fire.
          return
        }

        // Zero-param: legitimate if the body contains a Call or Member
        // expression (memo / closure / item-accessor read). Bare-literal
        // bodies definitionally don't read anything.
        if (value.params.length === 0) {
          if (bodyMayRead(value.body)) return
          context.report({ node, messageId: 'static' })
          return
        }
        if (value.params.length !== 1) return
        const param = value.params[0]
        if (!param || param.type !== AST_NODE_TYPES.Identifier) return
        if (readsParam(value.body, param.name)) return
        context.report({ node, messageId: 'static' })
      },
    }
  },
})
