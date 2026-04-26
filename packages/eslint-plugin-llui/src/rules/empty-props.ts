import { AST_NODE_TYPES } from '@typescript-eslint/utils'
import { createRule } from '../createRule.js'
import { ELEMENT_HELPERS } from '../util/element-helpers.js'

/**
 * Warns when an element-helper call passes an empty object literal as
 * the props argument: `div({}, [...])`. The helper signature accepts
 * either `(props, children)` or `(children)`, so the empty bag is
 * always redundant. The fix is to drop the literal: `div([...])`.
 *
 * Migrated from the Vite plugin's `empty-props` diagnostic so the
 * warning surfaces in the editor, not just at build time.
 */
export const emptyPropsRule = createRule({
  name: 'empty-props',
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow passing an empty `{}` props object to element helpers — drop it: `div([...])` instead of `div({}, [...])`.',
    },
    schema: [],
    messages: {
      empty:
        "Empty props object passed to '{{name}}()'. The attrs argument is optional — omit it: {{name}}([...]).",
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type !== AST_NODE_TYPES.Identifier) return
        if (!ELEMENT_HELPERS.has(node.callee.name)) return
        const first = node.arguments[0]
        if (!first || first.type !== AST_NODE_TYPES.ObjectExpression) return
        if (first.properties.length !== 0) return
        context.report({
          node: first,
          messageId: 'empty',
          data: { name: node.callee.name },
        })
      },
    }
  },
})
