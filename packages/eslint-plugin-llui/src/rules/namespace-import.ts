import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils'
import { createRule } from '../createRule.js'

/**
 * Forbids namespace imports (`import * as L from '@llui/...'`) from any
 * LLui package whose surface is reactive-aware or modular.
 *
 * Two costs:
 *
 *   1. **Correctness** — the `@llui/vite-plugin` compiler walks the
 *      file looking for *named* references to element helpers and
 *      structural primitives. Namespace forms route every call
 *      through `L.div(...)`; the matcher doesn't recognise the member
 *      access shape. Result: template-clone compilation and
 *      `elSplit` rewriting silently disable for the whole file.
 *
 *   2. **Bundle size** — `import * as C from '@llui/components'`
 *      defeats tree-shaking. Even with `sideEffects: false`, the
 *      bundler can only drop unused exports if every reference is
 *      statically resolvable; namespace imports often degrade to
 *      "include everything" depending on how `C` is used downstream.
 *
 * Autofix: enumerate every member-access on the namespace local
 * (`L.div`, `L.text`, …) plus every direct reference to the local
 * (which we can't autofix — leave a comment), build a named-import
 * specifier list, and rewrite. Only fires when EVERY reference is a
 * static `L.<member>` access — bail otherwise so we don't strip
 * dynamic uses like `someFn(L)`.
 *
 * Migrated from the Vite plugin's `namespace-import` diagnostic.
 */

// Packages whose surface is broad enough that namespace imports cause
// tree-shaking degradation, or whose runtime depends on the
// `@llui/vite-plugin` compiler recognising named call sites.
const TARGETS = new Set([
  '@llui/dom',
  '@llui/components',
  '@llui/router',
  '@llui/transitions',
  '@llui/effects',
  '@llui/agent',
])

export const namespaceImportRule = createRule({
  name: 'namespace-import',
  meta: {
    type: 'problem',
    fixable: 'code',
    docs: {
      description:
        'Disallow namespace imports from `@llui/*` packages — the compiler only recognises named-import helpers (so namespace forms silently disable template-clone optimization), and namespace imports defeat tree-shaking on broad-surface packages like `@llui/components`.',
    },
    schema: [],
    messages: {
      namespace:
        "Namespace import '{{local}}' from '{{source}}' disables compiler optimizations and defeats tree-shaking. Use named imports instead: import {{ braceOpen }} div, text, ... {{ braceClose }} from '{{source}}'.",
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      ImportDeclaration(node) {
        const src = node.source.value
        if (typeof src !== 'string' || !TARGETS.has(src)) return

        // A single ImportDeclaration can carry multiple specifiers — the
        // namespace specifier is the one we care about. There can be at
        // most one per import statement (TS rules; one default + one
        // namespace would be invalid).
        const nsSpec = node.specifiers.find(
          (s): s is TSESTree.ImportNamespaceSpecifier =>
            s.type === AST_NODE_TYPES.ImportNamespaceSpecifier,
        )
        if (!nsSpec) return

        const localName = nsSpec.local.name

        // Collect every reference to the namespace local in the file.
        // The autofix can run only when EVERY reference is a
        // PropertyAccess `local.<member>` we can rewrite to a named
        // import. Bare references (`pass(L)`, `Object.keys(L)`,
        // `<L.X>` JSX-style) defeat the rewrite — we report without a
        // fix in that case.
        const scope = context.sourceCode.getScope(node)
        // Walk to the module/global scope where the import lives.
        let target = scope
        while (target.type !== 'module' && target.type !== 'global' && target.upper) {
          target = target.upper
        }
        const variable = target.variables.find((v) => v.name === localName)

        const usedMembers = new Set<string>()
        let canAutofix = true

        if (variable) {
          for (const ref of variable.references) {
            if (ref.identifier === nsSpec.local) continue // the import binding itself
            const id = ref.identifier
            const parent = id.parent
            // Need `parent.X` shape with the local on the left.
            if (
              parent &&
              parent.type === AST_NODE_TYPES.MemberExpression &&
              parent.object === id &&
              !parent.computed &&
              parent.property.type === AST_NODE_TYPES.Identifier
            ) {
              usedMembers.add(parent.property.name)
              continue
            }
            // Anything else — bare reference, dynamic access, etc.
            canAutofix = false
          }
        } else {
          canAutofix = false
        }

        context.report({
          node: nsSpec,
          messageId: 'namespace',
          data: {
            local: localName,
            source: src,
            braceOpen: '{',
            braceClose: '}',
          },
          fix:
            canAutofix && usedMembers.size > 0
              ? (fixer) => {
                  const fixes = []
                  // Replace the import statement with a named-imports form.
                  // Preserve whatever default specifier may have appeared
                  // before the namespace specifier (rare but legal).
                  const sortedMembers = [...usedMembers].sort()
                  const others = node.specifiers.filter(
                    (s) => s.type !== AST_NODE_TYPES.ImportNamespaceSpecifier,
                  )
                  const otherText = others
                    .map((s) => {
                      if (s.type === AST_NODE_TYPES.ImportDefaultSpecifier) {
                        return s.local.name
                      }
                      if (s.type === AST_NODE_TYPES.ImportSpecifier) {
                        const imported =
                          s.imported.type === AST_NODE_TYPES.Identifier
                            ? s.imported.name
                            : s.imported.value
                        return imported === s.local.name
                          ? s.local.name
                          : `${imported} as ${s.local.name}`
                      }
                      return ''
                    })
                    .filter(Boolean)
                  const namedList = sortedMembers.join(', ')
                  const head = otherText.length > 0 ? `${otherText.join(', ')}, ` : ''
                  fixes.push(
                    fixer.replaceText(node, `import ${head}{ ${namedList} } from '${src}'`),
                  )
                  // Rewrite each `local.member` to bare `member`.
                  if (variable) {
                    for (const ref of variable.references) {
                      if (ref.identifier === nsSpec.local) continue
                      const id = ref.identifier
                      const parent = id.parent
                      if (
                        parent &&
                        parent.type === AST_NODE_TYPES.MemberExpression &&
                        parent.object === id &&
                        !parent.computed &&
                        parent.property.type === AST_NODE_TYPES.Identifier
                      ) {
                        fixes.push(fixer.replaceText(parent, parent.property.name))
                      }
                    }
                  }
                  return fixes
                }
              : null,
        })
      },
    }
  },
})

export default namespaceImportRule
