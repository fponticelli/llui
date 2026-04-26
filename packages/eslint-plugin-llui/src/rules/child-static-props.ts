import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils'
import { createRule } from '../createRule.js'

/**
 * Two failure modes around `child()`'s `props` argument:
 *
 *  1. `props` is a static object literal — it never updates when the
 *     parent's state changes, so the child gets stuck with the values
 *     it had at first mount. `props` must be a reactive accessor:
 *     `props: (s) => ({ ... })`.
 *
 *  2. `props` is an accessor, but it returns a literal that contains
 *     fresh nested object/array literals. `child()` diffs each
 *     top-level prop with `Object.is`, so a freshly-allocated nested
 *     value compares unequal on every parent update. `propsMsg` then
 *     fires on every render — wasted work at best, an infinite loop
 *     when paired with a naive `onMsg` forwarder.
 *
 * Migrated from the Vite plugin's `child-static-props` diagnostic.
 */

function getReturnedObjectLiteral(
  fn: TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression,
): TSESTree.ObjectExpression | null {
  const body = fn.body
  // (s) => ({ ... })
  if (body.type === AST_NODE_TYPES.ObjectExpression) return body
  // (s) => (({ ... }))
  // ESTree doesn't surface ParenthesizedExpression — parens are stripped.
  // Block body with a single return.
  if (body.type === AST_NODE_TYPES.BlockStatement) {
    for (const stmt of body.body) {
      if (stmt.type !== AST_NODE_TYPES.ReturnStatement) continue
      if (!stmt.argument) continue
      if (stmt.argument.type === AST_NODE_TYPES.ObjectExpression) return stmt.argument
    }
  }
  return null
}

function keyText(key: TSESTree.PropertyNonComputedName['key']): string {
  if (key.type === AST_NODE_TYPES.Identifier) return key.name
  if (key.type === AST_NODE_TYPES.Literal && typeof key.value === 'string') return key.value
  return '<?>'
}

export const childStaticPropsRule = createRule({
  name: 'child-static-props',
  meta: {
    type: 'problem',
    docs: {
      description:
        '`child()`’s `props` must be a reactive accessor returning stable references — static literals never update, fresh nested literals fire propsMsg every render.',
    },
    schema: [],
    messages: {
      staticLiteral:
        "child(): 'props' is a static object literal. It must be a reactive accessor function (s => ({ ... })) so props update when parent state changes.",
      freshNested:
        "child(): the 'props' accessor returns a fresh {{kind}} literal for '{{key}}'. Prop diffing uses Object.is per key, so a freshly-constructed reference reports changed every render — propsMsg will fire on every parent update. Hoist to a module-level constant, reuse a reference from state, or return null from propsMsg when the value is unchanged.",
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type !== AST_NODE_TYPES.Identifier) return
        if (node.callee.name !== 'child') return
        const arg = node.arguments[0]
        if (!arg || arg.type !== AST_NODE_TYPES.ObjectExpression) return
        for (const prop of arg.properties) {
          if (prop.type !== AST_NODE_TYPES.Property) continue
          if (prop.key.type !== AST_NODE_TYPES.Identifier || prop.key.name !== 'props') continue
          const value = prop.value
          if (value.type === AST_NODE_TYPES.ObjectExpression) {
            context.report({ node, messageId: 'staticLiteral' })
            continue
          }
          if (
            value.type !== AST_NODE_TYPES.ArrowFunctionExpression &&
            value.type !== AST_NODE_TYPES.FunctionExpression
          ) {
            continue
          }
          const returned = getReturnedObjectLiteral(value)
          if (!returned) continue
          for (const k of returned.properties) {
            if (k.type !== AST_NODE_TYPES.Property) continue
            const init = k.value
            if (
              init.type !== AST_NODE_TYPES.ObjectExpression &&
              init.type !== AST_NODE_TYPES.ArrayExpression
            ) {
              continue
            }
            const kind = init.type === AST_NODE_TYPES.ArrayExpression ? 'array' : 'object'
            context.report({
              node: k,
              messageId: 'freshNested',
              data: {
                kind,
                key: keyText(k.key as TSESTree.PropertyNonComputedName['key']),
              },
            })
          }
        }
      },
    }
  },
})
