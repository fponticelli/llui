// `agent-warning-on-confirm` — errors when a Msg variant tagged
// `@requiresConfirm` lacks a `@warning("…")`. Without the warning,
// the LLM sees "this needs confirmation" with no reason — so it
// either dispatches blindly or refuses. The warning is what makes
// the confirm gate honest. Migrated from
// `@llui/eslint-plugin/src/rules/agent-warning-on-confirm.ts`.

import ts from 'typescript'
import { rangeFromOffsets } from '../diagnostic.js'
import type { CompilerModule } from '../module.js'
import { forEachMsgVariant } from './_msg-variants.js'

export function agentWarningOnConfirmModule(): CompilerModule {
  return {
    name: 'agent-warning-on-confirm',
    compilerVersion: '^0.3.0',
    diagnostics: [
      {
        id: 'llui/agent-warning-on-confirm',
        description: '@requiresConfirm without @warning — LLM should see why the action is gated.',
      },
    ],
    visitors: {
      [ts.SyntaxKind.SourceFile]: (ctx, node) => {
        const visited = node as ts.SourceFile
        const sf = ts.createSourceFile(visited.fileName, visited.text, ts.ScriptTarget.Latest, true)
        forEachMsgVariant(sf, ({ variant, node: typeLit, leadingCommentText }) => {
          if (!/@requiresConfirm\b/.test(leadingCommentText)) return
          if (/@warning\s*\(/.test(leadingCommentText)) return
          ctx.reportDiagnostic({
            id: 'llui/agent-warning-on-confirm',
            severity: 'error',
            category: 'agent',
            message:
              `Msg variant "${variant}" has \`@requiresConfirm\` but no \`@warning("…")\`. ` +
              `Add a short consequence-shaped warning so the LLM sees why this action is gated: ` +
              `\`/** @requiresConfirm @warning("Deletes all unsaved drafts.") */\`.`,
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
