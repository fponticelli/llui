// `exhaustive-effect-handling` — errors when a `.else(fn)` call in an
// effect-handler chain receives a function with an empty block body.
// Silent drop of unhandled effects defeats the purpose of the
// fallback; the chain should either handle the case or at least
// `console.warn` so unrecognized effect types surface during dev.
// Migrated from
// `@llui/eslint-plugin/src/rules/exhaustive-effect-handling.ts`.

import ts from 'typescript'
import { rangeFromOffsets } from '../diagnostic.js'
import type { CompilerModule } from '../module.js'

function isEmptyBlockBody(fn: ts.ArrowFunction | ts.FunctionExpression): boolean {
  if (!fn.body) return false
  if (!ts.isBlock(fn.body)) {
    // expression body (e.g. () => undefined) is intentionally non-empty.
    return false
  }
  return fn.body.statements.length === 0
}

export function exhaustiveEffectHandlingModule(): CompilerModule {
  return {
    name: 'exhaustive-effect-handling',
    compilerVersion: '^0.3.0',
    diagnostics: [
      {
        id: 'llui/exhaustive-effect-handling',
        description:
          'Empty .else() handler in effect-handler chain silently drops unhandled effects.',
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
            n.expression.name.text === 'else'
          ) {
            const arg = n.arguments[0]
            if (
              arg &&
              (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) &&
              isEmptyBlockBody(arg)
            ) {
              ctx.reportDiagnostic({
                id: 'llui/exhaustive-effect-handling',
                severity: 'error',
                category: 'composition',
                message:
                  'Empty `.else()` handler silently drops unhandled effects. Either handle the case explicitly, or at minimum `console.warn` so unrecognized effect types surface during development.',
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
