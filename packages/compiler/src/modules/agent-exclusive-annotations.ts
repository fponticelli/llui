// `agent-exclusive-annotations` — errors on Msg variant annotation
// combinations that are mutually exclusive:
//   - @humanOnly + @agentOnly: incoherent (opposite audiences).
//   - @humanOnly + @requiresConfirm: redundant (humanOnly dominates).
//   - @humanOnly + @alwaysAffordable: redundant.
// Migrated from `@llui/eslint-plugin/src/rules/agent-exclusive-annotations.ts`.

import ts from 'typescript'
import { rangeFromOffsets } from '../diagnostic.js'
import type { CompilerModule } from '../module.js'
import { forEachMsgVariant } from './_msg-variants.js'

export function agentExclusiveAnnotationsModule(): CompilerModule {
  return {
    name: 'agent-exclusive-annotations',
    compilerVersion: '^0.3.0',
    diagnostics: [
      {
        id: 'llui/agent-exclusive-annotations',
        description:
          '@humanOnly and @agentOnly are mutually exclusive; @humanOnly also conflicts with @requiresConfirm / @alwaysAffordable.',
      },
    ],
    visitors: {
      [ts.SyntaxKind.SourceFile]: (ctx, node) => {
        const visited = node as ts.SourceFile
        const sf = ts.createSourceFile(visited.fileName, visited.text, ts.ScriptTarget.Latest, true)
        forEachMsgVariant(sf, ({ variant, node: typeLit, leadingCommentText }) => {
          const hasHumanOnly = /@humanOnly\b/.test(leadingCommentText)
          const hasAgentOnly = /@agentOnly\b/.test(leadingCommentText)
          if (hasHumanOnly && hasAgentOnly) {
            ctx.reportDiagnostic({
              id: 'llui/agent-exclusive-annotations',
              severity: 'error',
              category: 'agent',
              message:
                `Msg variant "${variant}" has both @humanOnly and @agentOnly. ` +
                `Pick one — they describe opposite dispatch audiences. ` +
                `Use @humanOnly if the LLM should never see this variant; @agentOnly if only the LLM should.`,
              location: {
                file: sf.fileName,
                range: rangeFromOffsets(sf.text, typeLit.getStart(sf), typeLit.getEnd()),
              },
            })
            return
          }
          if (!hasHumanOnly) return
          const conflicts: string[] = []
          if (/@requiresConfirm\b/.test(leadingCommentText)) conflicts.push('@requiresConfirm')
          if (/@alwaysAffordable\b/.test(leadingCommentText)) conflicts.push('@alwaysAffordable')
          if (conflicts.length === 0) return
          ctx.reportDiagnostic({
            id: 'llui/agent-exclusive-annotations',
            severity: 'error',
            category: 'agent',
            message:
              `Msg variant "${variant}" has @humanOnly combined with ${conflicts.join(' and ')}; ` +
              `@humanOnly dominates and makes the other redundant — the LLM never sees this variant, ` +
              `so confirmation / affordance hints have no audience. Remove the ${conflicts.join(' / ')} tag${conflicts.length > 1 ? 's' : ''}.`,
            location: {
              file: sf.fileName,
              range: rangeFromOffsets(sf.text, typeLit.getStart(sf), typeLit.getEnd()),
            },
          })
        })
      },
    },
  }
}
