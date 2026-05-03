import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils'
import { createRule } from '../createRule.js'
import { ELEMENT_HELPERS } from '../util/element-helpers.js'

/**
 * Flags `let foo = (s) => …` (or `var`) when `foo` is referenced at a
 * reactive-accessor position. The `@llui/vite-plugin` resolver
 * deliberately refuses to follow `let`/`var` bindings — they could be
 * reassigned, which would invalidate any compile-time mask analysis. So
 * the binding silently falls back to FULL_MASK at runtime: correct, but
 * the binding fires on every state change instead of only when its
 * accessed paths flip.
 *
 * ```ts
 * let isGated = (s: State) => s.gated     // ✗ no precise mask
 * const isGated = (s: State) => s.gated   // ✓ precise mask
 * button({ disabled: isGated })
 * ```
 *
 * Autofixes `let` → `const` when the binding is never reassigned.
 * Reports without a fix when there's at least one write — the user has
 * to either rename / split the binding or accept the FULL_MASK fallback.
 *
 * Sister rule of the compiler-side `resolveLocalConstInitializer` /
 * `resolveAccessorBody` change in `@llui/vite-plugin`. The compiler
 * silently degrades; this rule surfaces the degradation at edit time.
 */

const REACTIVE_API_NAMES = new Set<string>([
  ...ELEMENT_HELPERS,
  'each',
  'branch',
  'scope',
  'show',
  'memo',
  'portal',
  'foreign',
  'child',
  'errorBoundary',
])

const FIRST_ARG_BINDING_HELPERS = new Set(['text', 'unsafeHtml', 'memo'])

/**
 * Mirrors `isReactiveAccessor` from `state-paths.ts` and the
 * compiler's `collect-deps.ts`, generalized to any node — the check is
 * identity-based on `parent.arguments[0]` / `parent.value`, so the same
 * logic works whether the node is an inline arrow or a bare identifier
 * referencing one.
 */
function isAtReactivePosition(node: TSESTree.Node): boolean {
  const parent = node.parent
  if (!parent) return false

  // First-arg-of-call: text(<here>), unsafeHtml(<here>), memo(<here>)
  // — bare and `h.text(...)` / `h.memo(...)` member-call forms.
  if (parent.type === AST_NODE_TYPES.CallExpression && parent.arguments[0] === node) {
    const callee = parent.callee
    if (callee.type === AST_NODE_TYPES.Identifier) {
      if (callee.name === 'item' || callee.name === 'sample') return false
      return FIRST_ARG_BINDING_HELPERS.has(callee.name) || REACTIVE_API_NAMES.has(callee.name)
    }
    if (
      callee.type === AST_NODE_TYPES.MemberExpression &&
      callee.property.type === AST_NODE_TYPES.Identifier
    ) {
      return FIRST_ARG_BINDING_HELPERS.has(callee.property.name)
    }
    return false
  }

  // Property-value-of-reactive-API: div({ class: <here>, … }),
  // each({ items: <here>, … }), show({ when: <here>, … }), etc.
  if (parent.type === AST_NODE_TYPES.Property && parent.value === node) {
    const key = parent.key
    if (key.type !== AST_NODE_TYPES.Identifier) return false
    if (/^on[A-Z]/.test(key.name)) return false
    if (key.name === 'key' || key.name === 'name') return false
    let ancestor: TSESTree.Node | undefined = parent.parent
    while (ancestor && ancestor.type !== AST_NODE_TYPES.CallExpression) {
      ancestor = ancestor.parent
    }
    if (!ancestor) return false
    const callExpr = ancestor as TSESTree.CallExpression
    if (callExpr.callee.type !== AST_NODE_TYPES.Identifier) return false
    return REACTIVE_API_NAMES.has(callExpr.callee.name)
  }

  return false
}

/**
 * Recognise the legitimate accessor shapes the compiler can resolve when
 * its initializer is a `const`. We flag the same shapes in a `let` /
 * `var`. Anything else (a non-callable initializer) is unrelated to
 * reactive bindings — `let label = 'hi'` shouldn't trip the rule.
 */
function isCallableInitializer(init: TSESTree.Expression | null | undefined): boolean {
  if (!init) return false
  if (init.type === AST_NODE_TYPES.ArrowFunctionExpression) return true
  if (init.type === AST_NODE_TYPES.FunctionExpression) return true
  // memo(arrow) — same shape the compiler recognises
  if (
    init.type === AST_NODE_TYPES.CallExpression &&
    init.callee.type === AST_NODE_TYPES.Identifier &&
    init.callee.name === 'memo' &&
    init.arguments.length >= 1
  ) {
    const inner = init.arguments[0]!
    return (
      inner.type === AST_NODE_TYPES.ArrowFunctionExpression ||
      inner.type === AST_NODE_TYPES.FunctionExpression
    )
  }
  return false
}

export const noLetReactiveAccessorRule = createRule({
  name: 'no-let-reactive-accessor',
  meta: {
    type: 'problem',
    docs: {
      description:
        '`let` / `var` bindings used as reactive accessors lose the compile-time mask optimization. The `@llui/vite-plugin` resolver only follows `const` declarations (reassignment would invalidate the resolved body), so the binding silently falls back to FULL_MASK. Use `const`.',
    },
    fixable: 'code',
    schema: [],
    messages: {
      letAccessorReassigned:
        "`{{name}}` is a `{{kind}}`-bound accessor used at a reactive position ({{context}}), but it's reassigned later in the file — the compiler can't follow `{{kind}}` bindings, so this loses the precise-mask optimization and the binding falls back to FULL_MASK at runtime. Either avoid reassignment (use `const` and a different binding for the new value) or accept the FULL_MASK fallback.",
      letAccessor:
        '`{{name}}` is a `{{kind}}`-bound accessor used at a reactive position ({{context}}). The compiler only follows `const` bindings — `{{kind}}` falls back to FULL_MASK at runtime. Change to `const` (autofixable).',
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      VariableDeclaration(node) {
        if (node.kind !== 'let' && node.kind !== 'var') return
        // Only single-declarator statements can be safely flipped to `const`.
        // Multi-declarator `let a = …, b = …` skips the rule — the user can
        // split it themselves. Matches the compiler's resolver, which also
        // only handles single-declarator statements.
        if (node.declarations.length !== 1) return

        const decl = node.declarations[0]!
        if (decl.id.type !== AST_NODE_TYPES.Identifier) return
        if (!isCallableInitializer(decl.init)) return

        const declId = decl.id
        const declName = declId.name
        const scope = context.sourceCode.getScope(node)
        const variable =
          scope.set.get(declName) ??
          // Fallback: walk upward in case this declaration is nested in a
          // block whose scope.set doesn't see it (rare for top-level let).
          scope.variables.find((v) => v.name === declName)
        if (!variable) return

        // Find the first reactive-position reference and detect any
        // reassignment. Both signals matter: a reassignment means we
        // can't autofix (the user wrote `let` for a reason); a reactive
        // reference means there's an actual perf cost to flag.
        //
        // ESLint scope refs are typed as `Identifier | JSXIdentifier`;
        // JSXIdentifier never reaches us here (we don't lint JSX), but
        // narrow explicitly so the typecheck doesn't widen `firstReactiveRef`.
        let hasReactiveUse = false
        let firstReactiveContext: string | null = null
        let hasReassignment = false

        for (const ref of variable.references) {
          if (ref.identifier === declId) continue
          if (ref.isWrite()) hasReassignment = true
          if (ref.identifier.type !== AST_NODE_TYPES.Identifier) continue
          if (!hasReactiveUse && isAtReactivePosition(ref.identifier)) {
            hasReactiveUse = true
            firstReactiveContext = describeReactiveContext(ref.identifier)
          }
        }

        if (!hasReactiveUse) return

        const reportData = {
          name: declName,
          kind: node.kind,
          context: firstReactiveContext ?? 'reactive position',
        }

        if (hasReassignment) {
          context.report({
            node,
            messageId: 'letAccessorReassigned',
            data: reportData,
          })
          return
        }

        context.report({
          node,
          messageId: 'letAccessor',
          data: reportData,
          fix(fixer) {
            // Replace the leading `let`/`var` keyword token with `const`.
            // Using `replaceTextRange` on just the keyword preserves any
            // type annotations, comments, and whitespace untouched.
            const firstToken = context.sourceCode.getFirstToken(node)
            if (!firstToken) return null
            if (firstToken.value !== 'let' && firstToken.value !== 'var') return null
            return fixer.replaceText(firstToken, 'const')
          },
        })
      },
    }
  },
})

/**
 * Build a human-readable description of where the identifier was used,
 * for the diagnostic message. Best-effort; falls back to "reactive
 * position" when we can't summarise the call concisely.
 */
function describeReactiveContext(id: TSESTree.Identifier): string {
  const parent = id.parent
  if (!parent) return 'reactive position'
  if (parent.type === AST_NODE_TYPES.CallExpression && parent.arguments[0] === id) {
    if (parent.callee.type === AST_NODE_TYPES.Identifier) return `${parent.callee.name}(…)`
    if (
      parent.callee.type === AST_NODE_TYPES.MemberExpression &&
      parent.callee.property.type === AST_NODE_TYPES.Identifier
    ) {
      return `…${parent.callee.property.name}(…)`
    }
  }
  if (parent.type === AST_NODE_TYPES.Property && parent.value === id) {
    if (parent.key.type === AST_NODE_TYPES.Identifier) {
      let ancestor: TSESTree.Node | undefined = parent.parent
      while (ancestor && ancestor.type !== AST_NODE_TYPES.CallExpression) {
        ancestor = ancestor.parent
      }
      const calleeName =
        ancestor?.type === AST_NODE_TYPES.CallExpression &&
        ancestor.callee.type === AST_NODE_TYPES.Identifier
          ? ancestor.callee.name
          : null
      return calleeName ? `${calleeName}({ ${parent.key.name}: … })` : `{ ${parent.key.name}: … }`
    }
  }
  return 'reactive position'
}
