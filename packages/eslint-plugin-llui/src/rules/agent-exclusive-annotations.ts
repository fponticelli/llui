import { AST_NODE_TYPES, TSESTree } from '@typescript-eslint/utils'
import { createRule } from '../createRule.js'

export const agentExclusiveAnnotationsRule = createRule({
  name: 'agent-exclusive-annotations',
  meta: {
    type: 'suggestion',
    docs: {
      description: '@humanOnly is mutually exclusive with @requiresConfirm and @alwaysAffordable.',
    },
    schema: [],
    messages: {
      redundant:
        'Msg variant "{{variant}}" has @humanOnly combined with {{conflictList}}; @humanOnly dominates and makes the other redundant.',
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

    return {
      TSTypeAliasDeclaration(node) {
        if (node.id.type !== AST_NODE_TYPES.Identifier || node.id.name !== 'Msg') return
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

          if (!/@humanOnly\b/.test(commentText)) continue

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
