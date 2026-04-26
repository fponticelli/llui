import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils'
import { createRule } from '../createRule.js'

/**
 * Warns when an `<input>` or `<textarea>` has a *reactive* `value`
 * binding (an arrow that reads state) but no `onInput`/`onChange`
 * handler. The bidirectional flow is broken: every state update
 * overwrites whatever the user typed because the DOM property is
 * patched but no message ever flows the new value back into state.
 *
 * Constant `value: 'foo'` is fine — the input is initialised once and
 * not bound. The diagnostic only fires when the value would re-evaluate
 * on each state change.
 *
 * Migrated from the Vite plugin's `controlled-input` diagnostic.
 */
function getProps(obj: TSESTree.ObjectExpression): Map<string, TSESTree.Node> {
  const out = new Map<string, TSESTree.Node>()
  for (const p of obj.properties) {
    if (p.type !== AST_NODE_TYPES.Property) continue
    if (p.key.type !== AST_NODE_TYPES.Identifier) continue
    out.set(p.key.name, p.value)
  }
  return out
}

export const controlledInputRule = createRule({
  name: 'controlled-input',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Warn when an input/textarea has a reactive `value` binding without `onInput`/`onChange` — user input gets overwritten on each state update.',
    },
    schema: [],
    messages: {
      missingHandler:
        "Controlled <{{tag}}>: reactive 'value' binding without 'onInput' handler. The binding will overwrite user input on every state update.",
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type !== AST_NODE_TYPES.Identifier) return
        const tag = node.callee.name
        if (tag !== 'input' && tag !== 'textarea') return
        const propsArg = node.arguments[0]
        if (!propsArg || propsArg.type !== AST_NODE_TYPES.ObjectExpression) return
        const props = getProps(propsArg)
        const value = props.get('value')
        if (!value) return
        if (
          value.type !== AST_NODE_TYPES.ArrowFunctionExpression &&
          value.type !== AST_NODE_TYPES.FunctionExpression
        ) {
          return
        }
        if (!props.has('onInput') && !props.has('onChange')) {
          context.report({ node, messageId: 'missingHandler', data: { tag } })
        }
      },
    }
  },
})
