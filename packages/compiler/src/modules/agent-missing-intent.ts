// `agent-missing-intent` — errors when a Msg union variant has no
// `@intent("...")` JSDoc tag. The intent label is what Claude sees;
// without one, the agent surface synthesizes from the variant name
// alone (often unclear). Variants annotated `@humanOnly` are skipped.
// Migrated from `@llui/eslint-plugin/src/rules/agent-missing-intent.ts`.

import ts from 'typescript'
import { rangeFromOffsets } from '../diagnostic.js'
import type { CompilerModule } from '../module.js'
import { forEachMsgVariant } from './_msg-variants.js'

export function agentMissingIntentModule(): CompilerModule {
  return {
    name: 'agent-missing-intent',
    compilerVersion: '^0.3.0',
    diagnostics: [
      {
        id: 'llui/agent-missing-intent',
        description: 'Msg variant is missing @intent("...") — Claude will see a synthesized label.',
      },
    ],
    visitors: {
      [ts.SyntaxKind.SourceFile]: (ctx, node) => {
        const visited = node as ts.SourceFile
        const sf = ts.createSourceFile(visited.fileName, visited.text, ts.ScriptTarget.Latest, true)
        forEachMsgVariant(sf, ({ variant, node: typeLit, leadingCommentText }) => {
          if (/@humanOnly\b/.test(leadingCommentText)) return
          if (/@intent\s*\(\s*["“]([^"”]*)["”]\s*\)/.test(leadingCommentText)) return
          ctx.reportDiagnostic({
            id: 'llui/agent-missing-intent',
            severity: 'error',
            category: 'agent',
            message:
              `Msg variant "${variant}" is missing \`@intent("...")\` — without an explicit ` +
              `intent label, the agent surface synthesizes from the variant name and Claude ` +
              `gets a noisier hint. Add a JSDoc block above this variant: ` +
              `\`/** @intent("Verb-phrase describing what this does") */\` ` +
              `(or \`@humanOnly\` if this variant is not LLM-dispatchable).`,
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
