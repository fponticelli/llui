import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils'
import { createRule } from '../createRule.js'

/**
 * Flags eager invocation of an ItemAccessor read at a position that
 * expects a function — the canonical silent-staleness bug.
 *
 * Inside an `each.render` callback, the conventional `item` parameter
 * is a Proxy whose property access returns a `() => V` accessor:
 *
 *   text(item.title)        // reactive — runtime detects 0-arg fn,
 *                           //   re-reads on every commit
 *   text(item.title())      // STATIC — value captured once at view
 *                           //   construction, cell never updates
 *
 * Both compile and both look reasonable to a reader. The eager form
 * passes typecheck (returns a string, which `text` accepts as static
 * content) and the bug only surfaces when row data updates in place —
 * exactly the case manual smoke testing tends to miss. Catching it at
 * lint time is much cheaper than catching it from the agent that
 * inevitably ships a row that doesn't update.
 *
 * Heuristic: detect `<callee>(item.<prop>())` where the callee is one
 * of the accessor-taking primitives (`text`, `unsafeHtml`) and the
 * argument is a CallExpression on a MemberExpression rooted at an
 * identifier named `item` (the ItemAccessor convention from each's
 * render bag). The conservative ingredient is the literal `item`
 * name — projects that rename the binding (uncommon) won't be
 * checked, but won't false-positive either.
 *
 * Inside `show.when`/`branch.on`/event handlers, calling `item.X()`
 * IS the expected form (the surrounding function is a () => V
 * accessor that reads the value imperatively). The rule fires only
 * for the accessor-taking primitives where the eager call is the
 * silent footgun.
 */

const EAGER_TARGETS = new Set(['text', 'unsafeHtml'])

function isItemMemberCall(node: TSESTree.Node): boolean {
  if (node.type !== AST_NODE_TYPES.CallExpression) return false
  if (node.callee.type !== AST_NODE_TYPES.MemberExpression) return false
  const obj = node.callee.object
  // Require the object to be a bare `item` identifier (the convention
  // for ItemAccessor). Computed property access (`item['title']()`)
  // also matches; chained accessors (`item.foo.bar()`) don't because
  // `item.foo.bar` is a MemberExpression whose object is another
  // MemberExpression, not the bare `item` identifier — the LLui
  // ItemAccessor doesn't expose nested fields, so chained calls
  // wouldn't be the eager-accessor antipattern anyway.
  return obj.type === AST_NODE_TYPES.Identifier && obj.name === 'item'
}

export const noEagerItemAccessorRule = createRule({
  name: 'no-eager-item-accessor',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Flag eager invocation of an ItemAccessor (`text(item.title())`) at positions that expect a reactive accessor. The eager call captures the value at view-construction time; the cell never updates when the row changes in place.',
    },
    schema: [],
    messages: {
      eager:
        '`{{callee}}({{accessor}}())` reads the item value once at view-construction and never updates. Drop the `()` to pass the accessor itself: `{{callee}}({{accessor}})`. The runtime detects the zero-arg form and re-reads on every commit.',
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type !== AST_NODE_TYPES.Identifier) {
          // Member-form like `h.text(...)` — check the .property name.
          if (
            node.callee.type === AST_NODE_TYPES.MemberExpression &&
            node.callee.property.type === AST_NODE_TYPES.Identifier &&
            EAGER_TARGETS.has(node.callee.property.name)
          ) {
            // fall through to argument check below
          } else {
            return
          }
        } else if (!EAGER_TARGETS.has(node.callee.name)) {
          return
        }

        const arg = node.arguments[0]
        if (!arg || !isItemMemberCall(arg)) return

        const calleeName =
          node.callee.type === AST_NODE_TYPES.Identifier
            ? node.callee.name
            : node.callee.type === AST_NODE_TYPES.MemberExpression &&
                node.callee.property.type === AST_NODE_TYPES.Identifier
              ? node.callee.property.name
              : '<callee>'

        // Reconstruct the accessor source (e.g. `item.title`) for the message.
        const callExpr = arg as TSESTree.CallExpression
        const member = callExpr.callee as TSESTree.MemberExpression
        const propText =
          member.property.type === AST_NODE_TYPES.Identifier
            ? `item.${member.property.name}`
            : 'item.<prop>'

        context.report({
          node: arg,
          messageId: 'eager',
          data: { callee: calleeName, accessor: propText },
        })
      },
    }
  },
})
