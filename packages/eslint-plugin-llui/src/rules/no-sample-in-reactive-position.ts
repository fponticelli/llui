import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils'
import { createRule } from '../createRule.js'

/**
 * Flags `sample(...)` results being passed directly to a position
 * that expects a reactive accessor — the silent contradiction.
 *
 * `sample(selector)` is a one-shot imperative read at view-construction
 * time; it returns a value, not an accessor. Passing that value to
 * `text` / `unsafeHtml` / a class callback typechecks (the value is a
 * string and these accept strings as static content), but the
 * resulting DOM never updates when state changes — exactly the
 * silent-staleness antipattern users hit with `sample(s => s.list.items.map(...))`,
 * just on a per-field scale.
 *
 *   text(sample(s => s.title))               // ❌ static — never updates
 *   unsafeHtml(sample(s => s.markdown))      // ❌ static
 *   text((s) => s.title)                     // ✓ reactive
 *   text((s) => sample(s => s.title))        // ✓ outer is reactive;
 *                                            //   inner sample is fine
 *                                            //   (re-runs each commit)
 *
 * Detects only the direct nested case: `<accessor-taking>(sample(...))`.
 * Indirect cases (storing sample's result in a const and using it
 * later) need scope analysis we don't do here. The direct case is
 * what people actually write.
 *
 * Generalization of `no-list-render-in-sample` — same antipattern,
 * narrower trigger (any reactive position, not just .map). This rule
 * fires on cases where the user wrapped a state read in `sample` thinking
 * it would "just give me the value"; the linter explains that `sample`
 * is fundamentally an opt-out of reactivity, not a sugar for state-reading.
 */

const REACTIVE_TARGETS = new Set(['text', 'unsafeHtml'])

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

export const noSampleInReactivePositionRule = createRule({
  name: 'no-sample-in-reactive-position',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Flag `sample(...)` results being passed directly to reactive positions like `text(...)` or `unsafeHtml(...)`. `sample` is a one-shot imperative read; its return value is static, so the resulting DOM never updates.',
    },
    schema: [],
    messages: {
      sampleInReactive:
        '`{{callee}}(sample(…))` reads the value once at view-construction and the resulting node never updates. `sample` is an opt-out of reactivity — drop the wrapper to make `{{callee}}` reactive: `{{callee}}((s) => …)` reads on every commit, or `{{callee}}(item.field)` reads from an `each` ItemAccessor.',
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      CallExpression(node) {
        // Match `text(...)` / `unsafeHtml(...)` and their `h.<name>(...)` forms.
        let calleeName: string | null = null
        if (
          node.callee.type === AST_NODE_TYPES.Identifier &&
          REACTIVE_TARGETS.has(node.callee.name)
        ) {
          calleeName = node.callee.name
        } else if (
          node.callee.type === AST_NODE_TYPES.MemberExpression &&
          node.callee.property.type === AST_NODE_TYPES.Identifier &&
          REACTIVE_TARGETS.has(node.callee.property.name)
        ) {
          calleeName = node.callee.property.name
        }
        if (!calleeName) return

        const arg = node.arguments[0]
        if (!arg || !isSampleCall(arg)) return

        context.report({
          node: arg,
          messageId: 'sampleInReactive',
          data: { callee: calleeName },
        })
      },
    }
  },
})
