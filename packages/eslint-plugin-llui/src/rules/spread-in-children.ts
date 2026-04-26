import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils'
import { createRule } from '../createRule.js'
import { ELEMENT_HELPERS } from '../util/element-helpers.js'

/**
 * Warns when an element-helper's children array contains a spread:
 * `div([...someList()])`. Spreads disable the compiler's template-clone
 * optimization because the child count is no longer statically known.
 *
 * Scope-aware suppression: when the spread source resolves to a
 * locally-bounded binding (`const x = [...]`, `const x = fn(...)`,
 * `const x = other.map(...)` where `other` is bounded), the child count
 * is statically determinable and `each()` isn't an applicable fix —
 * those cases stay silent. Only genuinely-dynamic spreads warn.
 *
 * Migrated from the Vite plugin's `spread-in-children` diagnostic.
 */

const ARRAY_ITERATION_METHODS = new Set([
  'map',
  'filter',
  'flatMap',
  'slice',
  'concat',
  'reverse',
  'sort',
])

/**
 * Walk the identifier's enclosing scopes and find a matching
 * `VariableDeclarator` initialiser. Mirrors the Vite scanner's
 * `findVariableDeclarationInScope`.
 */
function resolveBindingInitializer(
  ident: TSESTree.Identifier,
): TSESTree.Expression | null {
  let scope: TSESTree.Node | undefined = ident.parent
  const seenFunctionBoundary = false
  void seenFunctionBoundary
  while (scope) {
    const init = findDeclaratorInScope(scope, ident.name, ident)
    if (init !== undefined) return init
    if (scope.type === AST_NODE_TYPES.Program) break
    scope = scope.parent
  }
  return null
}

function findDeclaratorInScope(
  scope: TSESTree.Node,
  name: string,
  from: TSESTree.Node,
): TSESTree.Expression | null | undefined {
  let result: TSESTree.Expression | null | undefined
  const visit = (n: TSESTree.Node | null | undefined) => {
    if (!n || result !== undefined) return
    // Skip nested function bodies that don't contain `from`.
    if (
      n !== from.parent &&
      (n.type === AST_NODE_TYPES.FunctionDeclaration ||
        n.type === AST_NODE_TYPES.FunctionExpression ||
        n.type === AST_NODE_TYPES.ArrowFunctionExpression)
    ) {
      return
    }
    if (
      n.type === AST_NODE_TYPES.VariableDeclarator &&
      n.id.type === AST_NODE_TYPES.Identifier &&
      n.id.name === name
    ) {
      result = n.init ?? null
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
  for (const key of Object.keys(scope) as (keyof typeof scope)[]) {
    if (key === 'parent' || key === 'loc' || key === 'range') continue
    const child = scope[key] as unknown
    if (Array.isArray(child)) {
      for (const c of child) {
        if (c && typeof c === 'object' && 'type' in c) visit(c as TSESTree.Node)
      }
    } else if (child && typeof child === 'object' && 'type' in (child as object)) {
      visit(child as TSESTree.Node)
    }
  }
  return result
}

/**
 * Is the receiver of a method call (the `x` in `x.map(...)`) a bounded
 * array source? Bounded means: resolves to a named array-literal
 * binding. Inline literals are intentionally NOT bounded — `[1,2,3].map`
 * spreads should still warn so authors see the canonical "use each()"
 * shape.
 */
function isBoundedArrayReceiver(receiver: TSESTree.Expression): boolean {
  if (receiver.type !== AST_NODE_TYPES.Identifier) return false
  const init = resolveBindingInitializer(receiver)
  if (!init) return false
  if (init.type === AST_NODE_TYPES.ArrayExpression) return true
  if (init.type === AST_NODE_TYPES.TSAsExpression) {
    return init.expression.type === AST_NODE_TYPES.ArrayExpression
  }
  return false
}

function isBoundedInitializer(init: TSESTree.Expression): boolean {
  if (init.type === AST_NODE_TYPES.ArrayExpression) return true
  if (init.type === AST_NODE_TYPES.TSAsExpression) {
    return isBoundedInitializer(init.expression as TSESTree.Expression)
  }
  if (init.type === AST_NODE_TYPES.CallExpression) {
    const callee = init.callee
    if (callee.type === AST_NODE_TYPES.Identifier) return true
    if (
      callee.type === AST_NODE_TYPES.MemberExpression &&
      callee.property.type === AST_NODE_TYPES.Identifier
    ) {
      if (!ARRAY_ITERATION_METHODS.has(callee.property.name)) return true
      return isBoundedArrayReceiver(callee.object)
    }
  }
  return false
}

function isBoundedSpreadSource(expr: TSESTree.Expression): boolean {
  if (expr.type === AST_NODE_TYPES.Identifier) {
    const init = resolveBindingInitializer(expr)
    if (!init) return false
    return isBoundedInitializer(init)
  }
  if (expr.type === AST_NODE_TYPES.CallExpression) {
    const callee = expr.callee
    if (
      callee.type === AST_NODE_TYPES.MemberExpression &&
      callee.property.type === AST_NODE_TYPES.Identifier
    ) {
      if (!ARRAY_ITERATION_METHODS.has(callee.property.name)) return true
      return isBoundedArrayReceiver(callee.object)
    }
    return true
  }
  return false
}

const spreadInChildrenRule = createRule({
  name: 'spread-in-children',
  meta: {
    type: 'problem',
    docs: {
      description:
        "Disallow spreading a dynamic array into an element helper's children — disables template-clone compilation. Use each() for dynamic lists.",
    },
    schema: [],
    messages: {
      noSpread:
        "Spread in children array of '{{name}}()' disables template-clone compilation. For dynamic child counts, use each() instead.",
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type !== AST_NODE_TYPES.Identifier) return
        if (!ELEMENT_HELPERS.has(node.callee.name)) return
        for (const arg of node.arguments) {
          if (arg.type !== AST_NODE_TYPES.ArrayExpression) continue
          for (const el of arg.elements) {
            if (!el || el.type !== AST_NODE_TYPES.SpreadElement) continue
            if (isBoundedSpreadSource(el.argument)) continue
            context.report({
              node: el,
              messageId: 'noSpread',
              data: { name: node.callee.name },
            })
            break
          }
        }
      },
    }
  },
})

export default spreadInChildrenRule
export { spreadInChildrenRule }
