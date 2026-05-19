// `forgotten-spread` — errors when a structural helper (show, branch,
// each) appears inside an array literal without spread. These helpers
// return Node[]; without `...` the array is nested and won't render
// correctly. Migrated from
// `@llui/eslint-plugin/src/rules/forgotten-spread.ts`.

import ts from 'typescript'
import { rangeFromOffsets } from '../diagnostic.js'
import type { CompilerModule } from '../module.js'

const STRUCTURAL_NAMES = new Set(['show', 'branch', 'each'])

export function forgottenSpreadModule(): CompilerModule {
  return {
    name: 'forgotten-spread',
    compilerVersion: '^0.3.0',
    diagnostics: [
      {
        id: 'llui/forgotten-spread',
        description: 'show/branch/each in an array literal without spread — array is nested.',
      },
    ],
    visitors: {
      [ts.SyntaxKind.SourceFile]: (ctx, node) => {
        const visited = node as ts.SourceFile
        const sf = ts.createSourceFile(visited.fileName, visited.text, ts.ScriptTarget.Latest, true)
        const walk = (n: ts.Node): void => {
          if (ts.isArrayLiteralExpression(n)) {
            for (const el of n.elements) {
              if (
                ts.isCallExpression(el) &&
                ts.isIdentifier(el.expression) &&
                STRUCTURAL_NAMES.has(el.expression.text)
              ) {
                const name = el.expression.text
                ctx.reportDiagnostic({
                  id: 'llui/forgotten-spread',
                  severity: 'error',
                  category: 'composition',
                  message:
                    `\`${name}()\` returns Node[] — spread it: \`[...${name}({...})]\`. ` +
                    `Without spread, the array is nested and won't render correctly.`,
                  location: {
                    file: sf.fileName,
                    range: rangeFromOffsets(sf.text, el.getStart(sf), el.getEnd()),
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
