import { AST_NODE_TYPES, TSESTree } from '@typescript-eslint/utils'
import { createRule } from '../createRule.js'
import {
  buildMsgUnionDetectionContext,
  isLikelyMsgUnion,
  TYPED_LINT_HINT,
  type MsgUnionDetectionContext,
} from '../util/msg-union-detection.js'

/**
 * Warns when a Msg variant is annotated `@requiresConfirm` but lacks
 * `@warning("…")`. The pair travels together by intent: confirm gates
 * a destructive or surprising action behind a user click, and warning
 * tells the agent (and any LLM-readable docs) why the action is gated.
 *
 * Without `@warning`, the LLM sees "this needs confirmation" but no
 * reason — so it'll either dispatch (and the user has to read the
 * confirm dialog cold), or refuse (because the action looks risky
 * without context). A short consequence-shaped warning makes the
 * shared dispatch / confirm flow honest.
 */
export const agentWarningOnConfirmRule = createRule({
  name: 'agent-warning-on-confirm',
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Warns when @requiresConfirm is set without @warning — the LLM should see why the action is gated.',
    },
    schema: [],
    messages: {
      missing:
        'Msg variant "{{variant}}" has @requiresConfirm but no @warning("…"). Add a short consequence-shaped warning so the LLM sees why this action is gated.{{typedLintHint}}',
    },
  },
  defaultOptions: [],
  create(context) {
    function readDiscriminantLiteral(node: TSESTree.TSTypeLiteral): string | null {
      for (const member of node.members) {
        if (member.type !== AST_NODE_TYPES.TSPropertySignature) continue
        if (!member.key || member.key.type !== AST_NODE_TYPES.Identifier) continue
        if (member.key.name !== 'type') continue
        if (
          member.typeAnnotation &&
          member.typeAnnotation.typeAnnotation.type === AST_NODE_TYPES.TSLiteralType &&
          member.typeAnnotation.typeAnnotation.literal.type === AST_NODE_TYPES.Literal &&
          typeof member.typeAnnotation.typeAnnotation.literal.value === 'string'
        ) {
          return member.typeAnnotation.typeAnnotation.literal.value
        }
      }
      return null
    }

    let detection: MsgUnionDetectionContext | null = null
    return {
      Program(node) {
        detection = buildMsgUnionDetectionContext(context, node)
      },
      TSTypeAliasDeclaration(node) {
        if (!detection || !isLikelyMsgUnion(node, detection)) return
        if (node.typeAnnotation.type !== AST_NODE_TYPES.TSUnionType) return
        const typedLintHint = detection.services ? '' : TYPED_LINT_HINT

        const types = node.typeAnnotation.types
        for (let i = 0; i < types.length; i++) {
          const member = types[i]
          if (!member || member.type !== AST_NODE_TYPES.TSTypeLiteral) continue

          const variant = readDiscriminantLiteral(member)
          if (!variant) continue

          const prev = types[i - 1]
          const scanPos = prev ? prev.range[1] : node.range[0]
          const commentText = context.sourceCode.text.slice(scanPos, member.range[0])

          // Only fire when @requiresConfirm is present. Otherwise this
          // variant doesn't need a warning at all.
          if (!/@requiresConfirm\b/.test(commentText)) continue
          if (/@warning\s*\(/.test(commentText)) continue

          context.report({
            node: member,
            messageId: 'missing',
            data: { variant, typedLintHint },
          })
        }
      },
    }
  },
})
