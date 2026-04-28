import { AST_NODE_TYPES } from '@typescript-eslint/utils'
import { createRule } from '../createRule.js'

/**
 * Flags calls to library `*.connect(get, send, ...)` where the second
 * argument is the component's raw `send` rather than a translator.
 *
 * The library's internal Msg variants flow through `send` directly when
 * no translator wraps the call. The compiler's `tagSend` mechanism
 * surfaces those internal names in the agent's binding registry — so
 * dragging on a sortable component leaks `move`, `drop`, `cancel`,
 * `start`, `toggleGrab`, `moveBy` into the agent's `list_actions`. The
 * agent has no use for those names; they're library plumbing the user's
 * `update.ts` doesn't accept under those identifiers anyway.
 *
 * The fix is to wrap with a translator that converts library Msgs to
 * the user's domain Msgs:
 *
 *   ✗ sortable.connect((s) => s.sort, send)
 *
 *   ✓ sortable.connect(
 *       (s) => s.sort,
 *       (libMsg) => send({ type: 'Sort/Update', msg: libMsg }),
 *     )
 *
 * The rule fires when the 2nd argument to a `*.connect(...)` call is
 * the bare identifier `send`. False positives are rare: someone naming
 * a translator literally `send` is unconventional. The lint suggests
 * the wrap explicitly so the fix is one paste away.
 */

const SEND_NAMES = new Set(['send'])

export const agentTagsendTranslatorMissingRule = createRule({
  name: 'agent-tagsend-translator-missing',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Flag `*.connect(get, send, ...)` calls that pass the raw component `send` — library-internal Msgs leak into the agent affordance list. Wrap in a translator that maps lib Msgs to user-domain Msgs.',
    },
    schema: [],
    messages: {
      missing:
        "`{{callee}}.connect(...)` receives the raw component `send` as its 2nd argument. Library-internal Msgs (`move`, `drop`, etc.) will leak into the agent's `list_actions` via `tagSend`. Wrap with a translator: `(libMsg) => send({ type: '<YourMsg>', msg: libMsg })`.",
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type !== AST_NODE_TYPES.MemberExpression) return
        if (node.callee.property.type !== AST_NODE_TYPES.Identifier) return
        if (node.callee.property.name !== 'connect') return
        if (node.arguments.length < 2) return

        const sendArg = node.arguments[1]
        if (!sendArg || sendArg.type !== AST_NODE_TYPES.Identifier) return
        if (!SEND_NAMES.has(sendArg.name)) return

        const calleeName =
          node.callee.object.type === AST_NODE_TYPES.Identifier ? node.callee.object.name : '<lib>'

        context.report({
          node,
          messageId: 'missing',
          data: { callee: calleeName },
        })
      },
    }
  },
})
