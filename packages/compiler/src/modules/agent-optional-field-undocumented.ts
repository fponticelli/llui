// `agent-optional-field-undocumented` — errors when a Msg variant's
// optional field (TS `?:`) lacks any leading JSDoc. Optional fields
// are the most ambiguous part of a payload from an LLM's perspective —
// some hint is required (`@should("…")` is the LLui idiom, but any
// JSDoc satisfies the rule). Variants annotated `@humanOnly` are
// skipped — the LLM never sees them. Migrated from
// `@llui/eslint-plugin/src/rules/agent-optional-field-undocumented.ts`.

import ts from 'typescript'
import { rangeFromOffsets } from '../diagnostic.js'
import type { CompilerModule } from '../module.js'
import { forEachMsgVariant } from './_msg-variants.js'

const JSDOC_BLOCK_RE = /\/\*\*[\s\S]*?\*\//

export function agentOptionalFieldUndocumentedModule(): CompilerModule {
  return {
    name: 'agent-optional-field-undocumented',
    compilerVersion: '^0.3.0',
    diagnostics: [
      {
        id: 'llui/agent-optional-field-undocumented',
        description: 'Optional Msg-variant field has no JSDoc — add @should("hint") or any JSDoc.',
      },
    ],
    visitors: {
      [ts.SyntaxKind.SourceFile]: (ctx, node) => {
        const visited = node as ts.SourceFile
        const sf = ts.createSourceFile(visited.fileName, visited.text, ts.ScriptTarget.Latest, true)
        forEachMsgVariant(sf, ({ variant, node: typeLit, leadingCommentText }) => {
          if (/@humanOnly\b/.test(leadingCommentText)) return
          let prevEnd = typeLit.getStart(sf) + 1 // skip the opening brace
          for (const sig of typeLit.members) {
            if (!ts.isPropertySignature(sig) || !sig.name || !ts.isIdentifier(sig.name)) {
              prevEnd = sig.getEnd()
              continue
            }
            const fieldName = sig.name.text
            if (fieldName === 'type') {
              prevEnd = sig.getEnd()
              continue
            }
            if (!sig.questionToken) {
              prevEnd = sig.getEnd()
              continue
            }
            const text = sf.text.slice(prevEnd, sig.getStart(sf))
            if (!JSDOC_BLOCK_RE.test(text)) {
              ctx.reportDiagnostic({
                id: 'llui/agent-optional-field-undocumented',
                severity: 'error',
                category: 'agent',
                message:
                  `Msg variant "${variant}" has optional field "${fieldName}" with no JSDoc. ` +
                  `Add \`@should("hint")\` if the LLM should fill it in unless it has a specific ` +
                  `reason not to, or any JSDoc block to mark it intentionally undocumented for the agent. ` +
                  `Example: \`/** @should("the user's display name") */ name?: string\`.`,
                location: {
                  file: sf.fileName,
                  range: rangeFromOffsets(sf.text, sig.getStart(sf), sig.getEnd()),
                },
              })
            }
            prevEnd = sig.getEnd()
          }
        })
      },
    },
  }
}
