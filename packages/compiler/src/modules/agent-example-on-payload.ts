// `agent-example-on-payload` — errors when a payload-bearing Msg
// variant (fields beyond `type`) has `@intent` but no `@example("…")`.
// Bare intent says "what does this do"; example says "when do I use it
// / how is it shaped in practice." Required only on payload-bearing
// variants — nullary variants (Reset, Open, Close) are obvious.
// Migrated from `@llui/eslint-plugin/src/rules/agent-example-on-payload.ts`.

import ts from 'typescript'
import { rangeFromOffsets } from '../diagnostic.js'
import type { CompilerModule } from '../module.js'
import { forEachMsgVariant, variantHasPayload } from './_msg-variants.js'

export function agentExampleOnPayloadModule(): CompilerModule {
  return {
    name: 'agent-example-on-payload',
    compilerVersion: '^0.3.0',
    diagnostics: [
      {
        id: 'llui/agent-example-on-payload',
        description:
          'Msg variant with payload fields has @intent but no @example — LLM benefits from worked usage.',
      },
    ],
    visitors: {
      [ts.SyntaxKind.SourceFile]: (ctx, node) => {
        const visited = node as ts.SourceFile
        const sf = ts.createSourceFile(visited.fileName, visited.text, ts.ScriptTarget.Latest, true)
        forEachMsgVariant(sf, ({ variant, node: typeLit, leadingCommentText }) => {
          if (!variantHasPayload(typeLit)) return
          if (/@humanOnly\b/.test(leadingCommentText)) return
          // Skip variants without @intent — agent-missing-intent will
          // already fire there. No point double-nagging.
          if (!/@intent\s*\(/.test(leadingCommentText)) return
          if (/@example\s*\(/.test(leadingCommentText)) return
          ctx.reportDiagnostic({
            id: 'llui/agent-example-on-payload',
            severity: 'error',
            category: 'agent',
            message:
              `Msg variant "${variant}" has payload fields but no \`@example("…")\`. ` +
              `Add at least one worked example showing typical usage: ` +
              `\`@example("Add a todo with text 'buy milk'")\` — the LLM uses this to ` +
              `disambiguate when/how to dispatch.`,
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
