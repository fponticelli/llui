import { AST_NODE_TYPES } from '@typescript-eslint/utils'
import { createRule } from '../createRule.js'

/**
 * Enforces a non-empty `reason: string` on every `subApp({...})` call.
 *
 * `subApp` is the unified-composition-model's state-isolation escape
 * hatch (see `docs/proposals/unified-composition-model.md`): for true
 * app-in-app boundaries — foreign-DOM integration, isolated 60fps drag
 * layers, deferred-loaded chunks with sealed state. The required
 * `reason` field is a sticky comment naming WHY this boundary is
 * necessary rather than a view function — meant to be auditable the
 * way an `eslint-disable` comment is.
 *
 * Runtime throws on empty/whitespace-only reason, but lint catches it
 * sooner and at the call site. This rule also catches non-literal
 * reasons (computed strings) and asks the author to write the reason
 * as a string literal so reviewers can grep for it without running
 * the program.
 *
 * Examples of good reasons (literal, descriptive):
 *   - "Monaco editor owns its own DOM + selection lifecycle"
 *   - "60fps drag layer — host reducer too slow for this"
 *   - "Lazy admin tools chunk; state sealed from main app"
 *
 * Bad reasons (rejected with a message pointing back at this rule):
 *   - ""                                  ← runtime would throw too
 *   - "code organization"                 ← write a view function instead
 *   - "  "                                ← runtime would throw too
 *   - `getReason()`                       ← use a literal so reviewers can grep
 */
export const subappRequiresReasonRule = createRule({
  name: 'subapp-requires-reason',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require a non-empty string literal `reason` on every subApp() call. Reason is a sticky comment naming why the boundary is necessary rather than a view function.',
    },
    schema: [],
    messages: {
      missing:
        'subApp() requires a \'reason\' property. Add a string literal naming WHY a state-isolation boundary is needed here rather than a view function (e.g. "Monaco owns its own DOM lifecycle").',
      empty:
        "subApp()'s 'reason' must be a non-empty string. Decomposing for code organization is not a valid reason — write a view function instead.",
      notLiteral:
        "subApp()'s 'reason' must be a string literal so reviewers can grep for it. A computed string defeats the audit-trail purpose.",
      organizationOnly:
        "subApp() 'reason' looks like a code-organization excuse ('{{value}}'). Real reasons name foreign lifecycle, isolated frame budget, or sealed state. For decomposition, write a view function — see docs/proposals/unified-composition-model.md.",
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      CallExpression(node) {
        // Match subApp(...) — caller is a bare Identifier or a member like Foo.subApp
        let calleeName: string | null = null
        if (node.callee.type === AST_NODE_TYPES.Identifier) {
          calleeName = node.callee.name
        } else if (
          node.callee.type === AST_NODE_TYPES.MemberExpression &&
          node.callee.property.type === AST_NODE_TYPES.Identifier
        ) {
          calleeName = node.callee.property.name
        }
        if (calleeName !== 'subApp') return

        const arg0 = node.arguments[0]
        if (!arg0 || arg0.type !== AST_NODE_TYPES.ObjectExpression) return

        // Find the `reason` property in the options object
        const reasonProp = arg0.properties.find(
          (p) =>
            p.type === AST_NODE_TYPES.Property &&
            !p.computed &&
            ((p.key.type === AST_NODE_TYPES.Identifier && p.key.name === 'reason') ||
              (p.key.type === AST_NODE_TYPES.Literal && p.key.value === 'reason')),
        )

        if (!reasonProp) {
          context.report({ node: arg0, messageId: 'missing' })
          return
        }
        if (reasonProp.type !== AST_NODE_TYPES.Property) return // narrowing

        const value = reasonProp.value
        // Allow template literals only if they have no expressions (still a literal)
        if (value.type === AST_NODE_TYPES.Literal) {
          if (typeof value.value !== 'string') {
            context.report({ node: value, messageId: 'notLiteral' })
            return
          }
          checkText(value.value, value)
          return
        }
        if (value.type === AST_NODE_TYPES.TemplateLiteral) {
          if (value.expressions.length === 0) {
            const text = value.quasis.map((q) => q.value.cooked ?? '').join('')
            checkText(text, value)
            return
          }
          // template literal with interpolation — computed
          context.report({ node: value, messageId: 'notLiteral' })
          return
        }

        // Identifier (a `const REASON = ...` referenced by name) — narrow
        // exemption: a const declared in the same file resolved to a
        // non-empty string literal is fine and common as a shared
        // constant for multiple subApp() calls. Report otherwise.
        if (value.type === AST_NODE_TYPES.Identifier) {
          if (isLocalStringConstant(context, node, value.name)) return
          context.report({ node: value, messageId: 'notLiteral' })
          return
        }

        // Anything else (call, ternary, etc.) — computed string
        context.report({ node: value, messageId: 'notLiteral' })

        function checkText(text: string, reportAt: typeof value): void {
          const trimmed = text.trim()
          if (trimmed === '') {
            context.report({ node: reportAt, messageId: 'empty' })
            return
          }
          // Soft check for code-organization excuses. These are not
          // exhaustive; the goal is to flag the most common bad reasons.
          const orgExcuses = [
            /\bcode\s+organi[zs]ation\b/i,
            /\b(break|breaking|split|splitting)\s+(this|up)\b/i,
            /\b(felt|just)\s+like\b/i,
            /\bsubcomponent\b/i,
          ]
          if (orgExcuses.some((re) => re.test(trimmed))) {
            context.report({
              node: reportAt,
              messageId: 'organizationOnly',
              data: { value: trimmed },
            })
          }
        }
      },
    }
  },
})

// Walk up the scope chain from the call site looking for a `const NAME = '…'`
// declaration resolving to a string literal. Conservative: only handles the
// simplest case (`const REASON = 'text'`); anything more dynamic is treated as
// computed and rejected by the caller.
function isLocalStringConstant(
  context: Parameters<typeof subappRequiresReasonRule.create>[0],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  callNode: any,
  name: string,
): boolean {
  // Use the scope at the call site — flat config uses module scope here,
  // and `getScope(ast)` returns the program scope which doesn't see
  // top-level `const` bindings under module sourceType.
  const scope = context.sourceCode.getScope(callNode)
  const found = findVariable(scope, name)
  if (!found || found.defs.length !== 1) return false
  const def = found.defs[0]!
  if (def.type !== 'Variable') return false
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const init = (def.node as any).init
  if (!init) return false
  if (init.type === AST_NODE_TYPES.Literal && typeof init.value === 'string') {
    return init.value.trim() !== ''
  }
  if (init.type === AST_NODE_TYPES.TemplateLiteral && init.expressions.length === 0) {
    const txt = init.quasis
      .map((q: { value: { cooked: string | null } }) => q.value.cooked ?? '')
      .join('')
    return txt.trim() !== ''
  }
  return false
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findVariable(scope: any, name: string): any {
  let cur = scope
  while (cur) {
    const v = cur.variables.find((x: { name: string }) => x.name === name)
    if (v) return v
    cur = cur.upper
  }
  return null
}
