import { AST_NODE_TYPES } from '@typescript-eslint/utils'
import { createRule } from '../createRule.js'

/**
 * Warns when a file imports `@llui/dom` (or `@llui/components`) via a
 * namespace import (`import * as L from '@llui/dom'`). The compiler's
 * `transform` pass walks the file looking for *named* references to
 * element helpers and structural primitives — namespace imports route
 * every call through `L.div(...)` etc., which the matcher doesn't
 * recognise. Result: template-clone compilation and `elSplit` rewriting
 * silently disable for every helper call in the file.
 *
 * Migrated from the Vite plugin's `namespace-import` diagnostic.
 */
const TARGETS = new Set(['@llui/dom', '@llui/components'])

export const namespaceImportRule = createRule({
  name: 'namespace-import',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow namespace imports from `@llui/dom`/`@llui/components` — the compiler only recognises named-import helpers, so namespace forms silently disable template-clone optimization.',
    },
    schema: [],
    messages: {
      namespace:
        "Namespace import '{{local}}' from '{{source}}' disables compiler optimizations. Use named imports instead: import {{ braceOpen }} div, text, ... {{ braceClose }} from '{{source}}'.",
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      ImportDeclaration(node) {
        const src = node.source.value
        if (typeof src !== 'string' || !TARGETS.has(src)) return
        for (const spec of node.specifiers) {
          if (spec.type !== AST_NODE_TYPES.ImportNamespaceSpecifier) continue
          context.report({
            node: spec,
            messageId: 'namespace',
            data: {
              local: spec.local.name,
              source: src,
              braceOpen: '{',
              braceClose: '}',
            },
          })
        }
      },
    }
  },
})
