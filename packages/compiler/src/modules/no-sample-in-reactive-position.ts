// `no-sample-in-reactive-position` — errors when `sample(...)` results
// are passed directly to a reactive-accessor-taking position like
// `text(sample(...))` or `unsafeHtml(sample(...))`. The result is
// static; the rendered DOM never updates. Migrated from
// `@llui/eslint-plugin/src/rules/no-sample-in-reactive-position.ts`.

import ts from 'typescript'
import { rangeFromOffsets } from '../diagnostic.js'
import type { CompilerModule } from '../module.js'

const REACTIVE_TARGETS = new Set(['text', 'unsafeHtml'])

function isSampleCall(n: ts.Node): boolean {
  if (!ts.isCallExpression(n)) return false
  if (ts.isIdentifier(n.expression) && n.expression.text === 'sample') return true
  if (
    ts.isPropertyAccessExpression(n.expression) &&
    ts.isIdentifier(n.expression.name) &&
    n.expression.name.text === 'sample'
  )
    return true
  return false
}

export function noSampleInReactivePositionModule(): CompilerModule {
  return {
    name: 'no-sample-in-reactive-position',
    compilerVersion: '^0.3.0',
    diagnostics: [
      {
        id: 'llui/no-sample-in-reactive-position',
        description:
          '`text(sample(…))` / `unsafeHtml(sample(…))` reads once at view-construction — DOM never updates.',
      },
    ],
    visitors: {
      [ts.SyntaxKind.SourceFile]: (ctx, node) => {
        const visited = node as ts.SourceFile
        const sf = ts.createSourceFile(visited.fileName, visited.text, ts.ScriptTarget.Latest, true)
        const walk = (n: ts.Node): void => {
          if (ts.isCallExpression(n)) {
            let calleeName: string | null = null
            if (ts.isIdentifier(n.expression) && REACTIVE_TARGETS.has(n.expression.text)) {
              calleeName = n.expression.text
            } else if (
              ts.isPropertyAccessExpression(n.expression) &&
              ts.isIdentifier(n.expression.name) &&
              REACTIVE_TARGETS.has(n.expression.name.text)
            ) {
              calleeName = n.expression.name.text
            }
            if (calleeName) {
              const arg = n.arguments[0]
              if (arg && isSampleCall(arg)) {
                ctx.reportDiagnostic({
                  id: 'llui/no-sample-in-reactive-position',
                  severity: 'error',
                  category: 'reactivity',
                  message:
                    `\`${calleeName}(sample(…))\` reads the value once at view-construction and ` +
                    `the resulting node never updates. \`sample\` is an opt-out of reactivity — ` +
                    `drop the wrapper to make \`${calleeName}\` reactive: \`${calleeName}((s) => …)\` ` +
                    `reads on every commit, or \`${calleeName}(item.field)\` reads from an \`each\` ` +
                    `ItemAccessor.`,
                  location: {
                    file: sf.fileName,
                    range: rangeFromOffsets(sf.text, arg.getStart(sf), arg.getEnd()),
                  },
                })
              }
            }
          }
          ts.forEachChild(n, walk)
        }
        walk(sf)
      },
    },
  }
}
