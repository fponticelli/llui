import { AST_NODE_TYPES, TSESTree } from '@typescript-eslint/utils'
import { createRule } from '../createRule.js'
import {
  buildMsgUnionDetectionContext,
  isLikelyMsgUnion,
  type MsgUnionDetectionContext,
} from '../util/msg-union-detection.js'

export const agentExclusiveAnnotationsRule = createRule({
  name: 'agent-exclusive-annotations',
  meta: {
    type: 'problem',
    docs: {
      description:
        '@humanOnly and @agentOnly are mutually exclusive with each other; @humanOnly is also mutually exclusive with @requiresConfirm and @alwaysAffordable.',
    },
    schema: [],
    messages: {
      redundant:
        'Msg variant "{{variant}}" has @humanOnly combined with {{conflictList}}; @humanOnly dominates and makes the other redundant.',
      modeConflict:
        'Msg variant "{{variant}}" has both @humanOnly and @agentOnly. Pick one — they describe opposite dispatch audiences.',
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

    // Detection context — same shape as agent-missing-intent. Typed
    // lint is the definitive cross-file signal; the same-file
    // component-arg name set is the untyped-fallback path.
    let detection: MsgUnionDetectionContext | null = null
    return {
      Program(node) {
        detection = buildMsgUnionDetectionContext(context, node)
      },
      TSTypeAliasDeclaration(node) {
        if (!detection || !isLikelyMsgUnion(node, detection)) return
        if (node.typeAnnotation.type !== AST_NODE_TYPES.TSUnionType) return

        const types = node.typeAnnotation.types
        for (let i = 0; i < types.length; i++) {
          const member = types[i]
          if (!member || member.type !== AST_NODE_TYPES.TSTypeLiteral) continue

          const variant = readDiscriminantLiteral(member)
          if (!variant) continue

          const prev = types[i - 1]
          const scanPos = prev ? prev.range[1] : node.range[0]
          const commentText = context.sourceCode.text.slice(scanPos, member.range[0])

          const hasHumanOnly = /@humanOnly\b/.test(commentText)
          const hasAgentOnly = /@agentOnly\b/.test(commentText)

          // Both dispatch-mode tags present is incoherent — they describe
          // opposite audiences. Report and skip the redundancy check
          // (which only makes sense once one of them is the "winner").
          if (hasHumanOnly && hasAgentOnly) {
            context.report({
              node: member,
              messageId: 'modeConflict',
              data: { variant },
            })
            continue
          }

          if (!hasHumanOnly) continue

          const hasRequiresConfirm = /@requiresConfirm\b/.test(commentText)
          const hasAlwaysAffordable = /@alwaysAffordable\b/.test(commentText)

          const conflicts: string[] = []
          if (hasRequiresConfirm) conflicts.push('@requiresConfirm')
          if (hasAlwaysAffordable) conflicts.push('@alwaysAffordable')

          if (conflicts.length === 0) continue

          const conflictList = conflicts.join(' and ')
          context.report({
            node: member,
            messageId: 'redundant',
            data: { variant, conflictList },
          })
        }
      },
    }
  },
})
