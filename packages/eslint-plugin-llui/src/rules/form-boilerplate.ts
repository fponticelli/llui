import { AST_NODE_TYPES, TSESTree } from '@typescript-eslint/utils'
import { createRule } from '../createRule.js'

export const formBoilerplateRule = createRule({
  name: 'form-boilerplate',
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Warn on boilerplate form-field update variants. Suggest using a generic field-update message pattern.',
    },
    schema: [],
    messages: {
      boilerplate:
        'Msg type has {{count}} variants with identical shapes ({{variants}}). Consider using a generic field-update message pattern.',
    },
  },
  defaultOptions: [],
  create(context) {
    interface MsgVariantShape {
      typeName: string
      shape: string
    }

    function collectMsgVariantShapes(typeNode: TSESTree.TypeNode): MsgVariantShape[] {
      const variants: MsgVariantShape[] = []

      if (typeNode.type === AST_NODE_TYPES.TSUnionType) {
        for (const member of typeNode.types) {
          variants.push(...collectMsgVariantShapes(member))
        }
        return variants
      }

      if (typeNode.type === AST_NODE_TYPES.TSTypeLiteral) {
        let typeName = ''
        const fields: string[] = []

        for (const member of typeNode.members) {
          if (member.type !== AST_NODE_TYPES.TSPropertySignature) continue
          if (!member.key || member.key.type !== AST_NODE_TYPES.Identifier) continue

          const fieldName = member.key.name
          const fieldType = member.typeAnnotation
            ? context.sourceCode.getText(member.typeAnnotation)
            : 'unknown'

          if (fieldName === 'type') {
            if (
              member.typeAnnotation &&
              member.typeAnnotation.typeAnnotation.type === AST_NODE_TYPES.TSLiteralType &&
              member.typeAnnotation.typeAnnotation.literal.type === AST_NODE_TYPES.Literal &&
              typeof member.typeAnnotation.typeAnnotation.literal.value === 'string'
            ) {
              typeName = member.typeAnnotation.typeAnnotation.literal.value
            }
          } else {
            fields.push(`${fieldName}:${fieldType}`)
          }
        }

        if (typeName && fields.length > 0) {
          fields.sort()
          variants.push({ typeName, shape: fields.join(',') })
        }
      }

      return variants
    }

    return {
      TSTypeAliasDeclaration(node) {
        if (node.id.type !== AST_NODE_TYPES.Identifier || node.id.name !== 'Msg') return

        const variants = collectMsgVariantShapes(node.typeAnnotation)
        if (variants.length < 3) return

        const shapeGroups = new Map<string, string[]>()

        for (const variant of variants) {
          const shape = variant.shape
          const group = shapeGroups.get(shape) ?? []
          group.push(variant.typeName)
          shapeGroups.set(shape, group)
        }

        for (const [shape, group] of shapeGroups) {
          if (group.length < 3) continue

          const hasValueField = shape.split(',').some((f) => f.startsWith('value:'))
          if (!hasValueField) continue

          const prefixPattern = /^(set|update|change)[A-Z]/
          const allMatchPrefix = group.every((name) => prefixPattern.test(name))
          if (!allMatchPrefix) continue

          const groupStr =
            group
              .slice(0, 3)
              .map((g) => "'" + g + "'")
              .join(', ') + (group.length > 3 ? ', ...' : '')
          context.report({
            node,
            messageId: 'boilerplate',
            data: { count: group.length, variants: groupStr },
          })
        }
      },
    }
  },
})
