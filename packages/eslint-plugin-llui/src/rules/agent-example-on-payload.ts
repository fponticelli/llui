import { AST_NODE_TYPES, TSESTree } from '@typescript-eslint/utils'
import { createRule } from '../createRule.js'
import {
  buildMsgUnionDetectionContext,
  isLikelyMsgUnion,
  TYPED_LINT_HINT,
  type MsgUnionDetectionContext,
} from '../util/msg-union-detection.js'

/**
 * Warns when a Msg variant has fields beyond the `type` discriminator
 * but lacks any `@example("…")` JSDoc tags. The discriminator alone is
 * cheap to dispatch — the LLM just picks the variant name and has the
 * payload skeleton from `payloadHint`. But variants with nontrivial
 * fields benefit from at least one example showing typical usage:
 * "what does a real payload look like in context?"
 *
 * Bare `@intent` answers "what does this do"; `@example` answers
 * "when do I use it / how is it shaped in practice." Both are
 * complementary; required only on payload-bearing variants because
 * field-free variants (a `Reset`, `Open`, `Close` etc.) are obvious
 * from the intent.
 *
 * Variants annotated `@humanOnly` are skipped — the LLM never sees
 * them, so examples for them have no audience.
 */
export const agentExampleOnPayloadRule = createRule({
  name: 'agent-example-on-payload',
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Warns when a Msg variant has payload fields but no @example("…") tag — the LLM benefits from a worked example for non-trivial dispatches.',
    },
    schema: [],
    messages: {
      missing:
        'Msg variant "{{variant}}" has payload fields but no @example("…"). Add at least one worked example showing typical usage.{{typedLintHint}}',
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

    /**
     * Return true if the variant has at least one property beyond
     * `type`. Variants with only `type` are fine without examples —
     * they're nullary intents whose name fully describes them.
     */
    function hasPayload(node: TSESTree.TSTypeLiteral): boolean {
      let count = 0
      for (const member of node.members) {
        if (member.type !== AST_NODE_TYPES.TSPropertySignature) continue
        if (!member.key || member.key.type !== AST_NODE_TYPES.Identifier) continue
        if (member.key.name === 'type') continue
        count++
        if (count > 0) return true
      }
      return false
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
          if (!hasPayload(member)) continue

          const prev = types[i - 1]
          const scanPos = prev ? prev.range[1] : node.range[0]
          const commentText = context.sourceCode.text.slice(scanPos, member.range[0])

          // Skip variants the LLM never sees.
          if (/@humanOnly\b/.test(commentText)) continue
          // Skip variants without @intent — they get the missing-intent
          // warning from a separate rule, no need to also nag about
          // examples until that's resolved.
          if (!/@intent\s*\(/.test(commentText)) continue
          if (/@example\s*\(/.test(commentText)) continue

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
