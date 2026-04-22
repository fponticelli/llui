import { AST_NODE_TYPES } from '@typescript-eslint/utils'
import { createRule } from '../createRule'

const callbackProps = new Set(['onSuccess', 'onError', 'onLoad', 'onChange', 'onMessage'])

export default createRule({
  name: 'string-effect-callback',
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow string-based effect callbacks',
    },
    schema: [],
    messages: {
      stringEffectCallback:
        "String-based effect callback '{{name}}' is deprecated. Use a typed message constructor: {{name}}: (data) => ({ type: '{{value}}', payload: data }).",
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      Property(node) {
        if (
          node.key.type === AST_NODE_TYPES.Identifier &&
          callbackProps.has(node.key.name) &&
          node.value.type === AST_NODE_TYPES.Literal &&
          typeof node.value.value === 'string'
        ) {
          context.report({
            node,
            messageId: 'stringEffectCallback',
            data: {
              name: node.key.name,
              value: node.value.value,
            },
          })
        }
      },
    }
  },
})
