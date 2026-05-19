// `agent-tagsend-translator-missing` — errors when `*.connect(get, send,
// …)` is called with the raw component `send` as its 2nd argument. The
// library's internal Msgs flow through `send` directly and surface in
// the agent's `list_actions` via `tagSend`, leaking library plumbing
// (`move`, `drop`, `cancel`, etc.) into the agent affordance list.
// The fix is to wrap with a translator: `(libMsg) => send({ type: '…',
// msg: libMsg })`. Migrated from
// `@llui/eslint-plugin/src/rules/agent-tagsend-translator-missing.ts`.

import ts from 'typescript'
import { rangeFromOffsets } from '../diagnostic.js'
import type { CompilerModule } from '../module.js'

export function agentTagsendTranslatorMissingModule(): CompilerModule {
  return {
    name: 'agent-tagsend-translator-missing',
    compilerVersion: '^0.3.0',
    diagnostics: [
      {
        id: 'llui/agent-tagsend-translator-missing',
        description:
          '`*.connect(get, send, ...)` passes raw `send` — library Msgs leak into agent affordances.',
      },
    ],
    visitors: {
      [ts.SyntaxKind.SourceFile]: (ctx, node) => {
        const visited = node as ts.SourceFile
        const sf = ts.createSourceFile(visited.fileName, visited.text, ts.ScriptTarget.Latest, true)
        const walk = (n: ts.Node): void => {
          if (
            ts.isCallExpression(n) &&
            ts.isPropertyAccessExpression(n.expression) &&
            ts.isIdentifier(n.expression.name) &&
            n.expression.name.text === 'connect' &&
            n.arguments.length >= 2
          ) {
            const sendArg = n.arguments[1]!
            if (ts.isIdentifier(sendArg) && sendArg.text === 'send') {
              const calleeName = ts.isIdentifier(n.expression.expression)
                ? n.expression.expression.text
                : '<lib>'
              ctx.reportDiagnostic({
                id: 'llui/agent-tagsend-translator-missing',
                severity: 'error',
                category: 'agent',
                message:
                  `\`${calleeName}.connect(...)\` receives the raw component \`send\` as its 2nd ` +
                  `argument. Library-internal Msgs will leak into the agent's \`list_actions\` via ` +
                  `\`tagSend\`. Wrap with a translator that maps library Msgs to your domain Msgs: ` +
                  `\`(libMsg) => send({ type: '<YourMsg>', msg: libMsg })\`.`,
                location: {
                  file: sf.fileName,
                  range: rangeFromOffsets(sf.text, n.getStart(sf), n.getEnd()),
                },
              })
            }
          }
          ts.forEachChild(n, walk)
        }
        walk(sf)
      },
    },
  }
}
