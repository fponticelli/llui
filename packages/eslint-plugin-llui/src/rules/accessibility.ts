import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils'
import { createRule } from '../createRule.js'
import { ELEMENT_HELPERS, INTERACTIVE_ELEMENTS } from '../util/element-helpers.js'

/**
 * Two a11y nudges:
 *
 *  - `<img>` without `alt` — screen readers fall back to the filename
 *    (often nonsense). Authors who deliberately want decorative
 *    behaviour should use `alt=""`.
 *  - `onClick` on a non-interactive element (`div`, `span`, etc.)
 *    without `role` — keyboard users cannot reach it. Either add
 *    `role='button' tabIndex={0}` or rewrite as `<button>`.
 *
 * Migrated from the Vite plugin's `accessibility` diagnostic.
 */
function staticPropKeys(obj: TSESTree.ObjectExpression): Set<string> {
  const out = new Set<string>()
  for (const p of obj.properties) {
    if (p.type !== AST_NODE_TYPES.Property) continue
    if (p.key.type === AST_NODE_TYPES.Identifier) {
      out.add(p.key.name)
    } else if (p.key.type === AST_NODE_TYPES.Literal && typeof p.key.value === 'string') {
      out.add(p.key.value)
    }
  }
  return out
}

export const accessibilityRule = createRule({
  name: 'accessibility',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Flag missing `alt` on `<img>` and `onClick` on non-interactive elements without an ARIA role — both block screen-reader and keyboard users.',
    },
    schema: [],
    messages: {
      missingAlt:
        "<img> has no 'alt' attribute. Add alt text for screen readers, or alt='' for decorative images.",
      clickWithoutRole:
        "onClick on <{{tag}}> without role. Non-interactive elements with click handlers are not keyboard-accessible. Add role='button' and tabIndex={0}, or use <button>.",
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type !== AST_NODE_TYPES.Identifier) return
        const tag = node.callee.name
        if (!ELEMENT_HELPERS.has(tag)) return
        const props = node.arguments[0]
        if (!props || props.type !== AST_NODE_TYPES.ObjectExpression) return
        const keys = staticPropKeys(props)

        if (tag === 'img' && !keys.has('alt')) {
          context.report({ node, messageId: 'missingAlt' })
        }

        if (keys.has('onClick') && !INTERACTIVE_ELEMENTS.has(tag) && !keys.has('role')) {
          context.report({ node, messageId: 'clickWithoutRole', data: { tag } })
        }
      },
    }
  },
})
