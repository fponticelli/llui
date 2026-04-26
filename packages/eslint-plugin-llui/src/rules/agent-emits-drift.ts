import { AST_NODE_TYPES, TSESTree } from '@typescript-eslint/utils'
import { createRule } from '../createRule.js'
import {
  buildMsgUnionDetectionContext,
  isLikelyMsgUnion,
  type MsgUnionDetectionContext,
} from '../util/msg-union-detection.js'

/**
 * Verify that `@emits("k1", "k2")` declarations on Msg variants match
 * the effect kinds actually emitted by the corresponding case in
 * update().
 *
 * Two failure modes the rule catches:
 *
 * 1. **Emitted but not declared** — an effect literal `{kind: 'X'}`
 *    appears in a case's return, but `'X'` isn't in the variant's
 *    `@emits`. Always warn: we have proof the effect fires.
 * 2. **Declared but not emitted** — a kind in `@emits` doesn't appear
 *    in any literal effect of the case. Only warn when the case has
 *    no opaque helper calls — otherwise the helper might emit that
 *    kind and we just can't see it without typed lint.
 *
 * Same-file scope only: Msg union and `update` function must be in
 * the same source file. Cross-file resolution requires typed lint
 * (the `agent-msg-resolvable` rule already gates this on typed-lint
 * configuration; wiring effect-emission tracking through cross-file
 * is follow-up work). For apps with split files, the rule simply
 * doesn't fire — false negative, not false positive.
 *
 * Helper calls are "opaque": when a case's effects array contains
 * `track('foo')` or any call expression, we can't statically resolve
 * the resulting kind without typed lint. The rule treats those cases
 * as "might emit anything" — declared kinds that don't appear in
 * literals are silently accepted, not flagged.
 */
export const agentEmitsDriftRule = createRule({
  name: 'agent-emits-drift',
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Verify @emits declarations on Msg variants match the effect kinds emitted by the corresponding update() case.',
    },
    schema: [],
    messages: {
      undeclared:
        'Msg variant "{{variant}}" emits effect "{{kind}}" in update() but does not declare it in @emits. Add "{{kind}}" to the @emits list, or remove the literal effect emission.',
      orphaned:
        'Msg variant "{{variant}}" declares @emits "{{kind}}" but no case in update() emits it. Remove from @emits, or add the emission to update().',
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
     * Parse `@emits("k1", "k2")` from a JSDoc block — returns the
     * declared kinds in source order. Empty when the tag is absent.
     */
    function readEmits(comment: string): string[] {
      const outer = comment.match(/@emits\s*\(([^)]*)\)/)
      if (!outer || outer[1] === undefined) return []
      const inner = outer[1]
      const seen = new Set<string>()
      const out: string[] = []
      const re = /["“]([^"”]*)["”]/g
      let m: RegExpExecArray | null
      while ((m = re.exec(inner)) !== null) {
        if (m[1] !== undefined && !seen.has(m[1])) {
          seen.add(m[1])
          out.push(m[1])
        }
      }
      return out
    }

    /**
     * Index of `case 'X':` cases inside `switch (msg.type)` blocks
     * across the whole file. Each entry: which variant the case
     * matches, the literal effect kinds it emits, and whether the
     * case body contains opaque helper calls (in which case the
     * orphaned-emit check skips it).
     */
    type CaseInfo = {
      literalKinds: Set<string>
      hasOpaqueHelpers: boolean
    }
    const caseInfoByVariant = new Map<string, CaseInfo>()

    /**
     * Walk a node tree and accumulate effect data. Looks for return
     * statements whose value is a 2-tuple where the second element
     * is an array literal — the canonical TEA reducer shape
     * `[state, effects]`. Skips `parent` and `loc` keys to avoid the
     * AST's parent-pointer cycles.
     */
    function walkCaseBody(body: TSESTree.Node, info: CaseInfo): void {
      const visited = new Set<TSESTree.Node>()
      const visit = (n: TSESTree.Node): void => {
        if (visited.has(n)) return
        visited.add(n)
        if (n.type === AST_NODE_TYPES.ReturnStatement && n.argument) {
          const arg = n.argument
          if (arg.type === AST_NODE_TYPES.ArrayExpression && arg.elements.length === 2) {
            const effects = arg.elements[1]
            if (effects && effects.type === AST_NODE_TYPES.ArrayExpression) {
              for (const el of effects.elements) {
                if (!el) continue
                if (el.type === AST_NODE_TYPES.ObjectExpression) {
                  // Literal {kind: 'X', ...} — extract the kind.
                  for (const prop of el.properties) {
                    if (prop.type !== AST_NODE_TYPES.Property) continue
                    if (
                      prop.key.type === AST_NODE_TYPES.Identifier &&
                      prop.key.name === 'kind' &&
                      prop.value.type === AST_NODE_TYPES.Literal &&
                      typeof prop.value.value === 'string'
                    ) {
                      info.literalKinds.add(prop.value.value)
                    }
                  }
                } else if (
                  el.type === AST_NODE_TYPES.CallExpression ||
                  el.type === AST_NODE_TYPES.SpreadElement
                ) {
                  // Helper call (`track('foo')`) or spread (`...other`).
                  // Treat as opaque — we can't statically resolve the
                  // emitted kinds without typed lint.
                  info.hasOpaqueHelpers = true
                }
              }
            }
          }
        }
        // Recurse — case bodies can have nested if/else, switch, etc.
        // Skip `parent` and `loc` to avoid AST cycles.
        for (const key of Object.keys(n)) {
          if (key === 'parent' || key === 'loc' || key === 'range') continue
          const child = (n as unknown as Record<string, unknown>)[key]
          if (Array.isArray(child)) {
            for (const c of child) {
              if (c && typeof c === 'object' && 'type' in c) visit(c as TSESTree.Node)
            }
          } else if (child && typeof child === 'object' && 'type' in child) {
            visit(child as TSESTree.Node)
          }
        }
      }
      visit(body)
    }

    /**
     * Walk a SwitchStatement looking for `case 'X':` cases. The
     * discriminant must be `msg.type` (or any property access
     * ending in `.type` — TEA convention).
     */
    function indexSwitchCases(sw: TSESTree.SwitchStatement): void {
      // Heuristic: the discriminant ends with `.type` member access.
      const disc = sw.discriminant
      const looksLikeMsgType =
        disc.type === AST_NODE_TYPES.MemberExpression &&
        disc.property.type === AST_NODE_TYPES.Identifier &&
        disc.property.name === 'type'
      if (!looksLikeMsgType) return

      for (const sc of sw.cases) {
        if (!sc.test || sc.test.type !== AST_NODE_TYPES.Literal) continue
        if (typeof sc.test.value !== 'string') continue
        const variant = sc.test.value
        const info: CaseInfo = caseInfoByVariant.get(variant) ?? {
          literalKinds: new Set(),
          hasOpaqueHelpers: false,
        }
        for (const stmt of sc.consequent) walkCaseBody(stmt, info)
        caseInfoByVariant.set(variant, info)
      }
    }

    let detection: MsgUnionDetectionContext | null = null
    // Msg-union nodes seen before the switch cases finished indexing
    // — we defer their drift check to `Program:exit` so the case
    // index is complete regardless of declaration order.
    const pendingMsgAliases: TSESTree.TSTypeAliasDeclaration[] = []

    function checkAlias(node: TSESTree.TSTypeAliasDeclaration): void {
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
        const declared = readEmits(commentText)

        const caseInfo = caseInfoByVariant.get(variant)
        if (!caseInfo) {
          // No case found — variant is either unhandled (separate
          // bug, not our concern) or update() lives in a different
          // file. Skip.
          continue
        }

        // Drift check 1: literal emissions that aren't declared.
        // Always warn — we have proof the effect fires.
        for (const kind of caseInfo.literalKinds) {
          if (!declared.includes(kind)) {
            context.report({
              node: member,
              messageId: 'undeclared',
              data: { variant, kind },
            })
          }
        }

        // Drift check 2: declared but not emitted in literals.
        // Only warn when we have full visibility (no opaque helpers
        // in the case). Otherwise the helper might emit the kind
        // and we'd flag spuriously.
        if (!caseInfo.hasOpaqueHelpers) {
          for (const kind of declared) {
            if (!caseInfo.literalKinds.has(kind)) {
              context.report({
                node: member,
                messageId: 'orphaned',
                data: { variant, kind },
              })
            }
          }
        }
      }
    }

    return {
      Program(node) {
        detection = buildMsgUnionDetectionContext(context, node)
      },
      // ESLint walks the AST in document order using its built-in
      // visitor; registering SwitchStatement directly is the right
      // mechanism (no manual recursion, no parent-pointer cycles).
      // Cases populate the index as the walker visits each switch.
      SwitchStatement(node) {
        indexSwitchCases(node)
      },
      TSTypeAliasDeclaration(node) {
        // Defer to Program:exit — the Msg union might be declared
        // before the switch, in which case the case index isn't
        // ready yet. Collecting and processing at exit guarantees
        // both halves are complete.
        pendingMsgAliases.push(node)
      },
      'Program:exit'() {
        for (const alias of pendingMsgAliases) checkAlias(alias)
      },
    }
  },
})
