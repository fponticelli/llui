import { AST_NODE_TYPES, TSESTree } from '@typescript-eslint/utils'
import { createRule } from '../createRule.js'
import {
  buildMsgUnionDetectionContext,
  isLikelyMsgUnion,
  type MsgUnionDetectionContext,
} from '../util/msg-union-detection.js'

/**
 * Warns when a Msg variant has an optional field (TS `?:`) with no
 * JSDoc above it.
 *
 * Why: optional fields are the most ambiguous part of a payload from
 * an LLM's perspective. The schema says "this field may be present"
 * — but does the agent benefit from filling it in? Should it leave
 * it absent? Without per-field guidance, the LLM either over-fills
 * (noisy payloads) or under-fills (misses meaningful provenance,
 * source URLs, descriptive metadata).
 *
 * The cheap fix is one of:
 *   - `@should("hint")` — the LLM ought to fill this in unless it
 *     has a specific reason not to. Borrows RFC 2119 vocabulary;
 *     surfaces the hint in `payloadHint`.
 *   - Any other JSDoc — if the field is intentionally undocumented
 *     for the agent (internal-only, transient state, etc.), a plain
 *     comment satisfies the rule and makes the choice explicit.
 *
 * Scope: only Msg variants the LLM actually sees. `@humanOnly`
 * variants are skipped — their fields never reach the agent surface,
 * so per-field hints have no audience.
 *
 * Severity: `warn` in `recommended`. The rule encourages thoroughness
 * but missing JSDoc isn't a LAP-correctness bug — it just means the
 * LLM operates with less guidance. Apps that want to gate full
 * LLM-readability can promote to `error`.
 */
export const agentOptionalFieldUndocumentedRule = createRule({
  name: 'agent-optional-field-undocumented',
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Warns when a Msg variant has an optional field with no JSDoc — add @should("hint") if the LLM should fill it in, or any comment to mark it intentionally undocumented.',
    },
    schema: [],
    messages: {
      missing:
        'Msg variant "{{variant}}" has optional field "{{field}}" with no JSDoc. Add @should("hint") if the LLM should fill it in, or any JSDoc to mark it intentionally undocumented.',
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
     * Read the slice of source text that would contain a JSDoc block
     * immediately preceding `member`. Member-level JSDoc is one of the
     * harder surfaces to read from the AST directly because TS's
     * parser doesn't attach it as a child node — re-scanning the
     * inter-member range and looking for `/** … *\/` is the practical
     * approach. Returns true iff a JSDoc block is present in that
     * range.
     */
    function hasLeadingJSDoc(
      member: TSESTree.Node,
      prevEnd: number,
      context: ReturnType<typeof createRule>['create'] extends (c: infer C) => unknown ? C : never,
    ): boolean {
      // The text between `prevEnd` and `member.range[0]` includes any
      // leading whitespace, line terminators, and JSDoc blocks that
      // belong to this member. We look for the canonical block
      // opening; trailing-line // comments don't satisfy the rule.
      const text = (context as { sourceCode: { text: string } }).sourceCode.text.slice(
        prevEnd,
        member.range[0],
      )
      return /\/\*\*[\s\S]*?\*\//.test(text)
    }

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

          // Skip @humanOnly variants — fields the LLM never sees
          // don't need per-field hints.
          const prev = types[i - 1]
          const variantScanStart = prev ? prev.range[1] : node.range[0]
          const variantComment = context.sourceCode.text.slice(variantScanStart, member.range[0])
          if (/@humanOnly\b/.test(variantComment)) continue

          // Walk each member of the variant, looking for optional
          // property signatures without leading JSDoc.
          let prevMemberEnd = member.range[0] + 1 // skip the opening brace
          for (const sig of member.members) {
            if (
              sig.type !== AST_NODE_TYPES.TSPropertySignature ||
              !sig.key ||
              sig.key.type !== AST_NODE_TYPES.Identifier
            ) {
              prevMemberEnd = sig.range[1]
              continue
            }
            const fieldName = sig.key.name
            // Skip the discriminator and required fields.
            if (fieldName === 'type') {
              prevMemberEnd = sig.range[1]
              continue
            }
            if (!sig.optional) {
              prevMemberEnd = sig.range[1]
              continue
            }
            if (!hasLeadingJSDoc(sig, prevMemberEnd, context)) {
              context.report({
                node: sig,
                messageId: 'missing',
                data: { variant, field: fieldName },
              })
            }
            prevMemberEnd = sig.range[1]
          }
        }
      },
    }
  },
})
