// `empty-props` — errors when an element-helper call passes an empty
// object literal as the props argument: `div({}, [...])`. The helper
// signature accepts either `(props, children)` or `(children)`, so the
// empty bag is redundant. Migrated from
// `@llui/eslint-plugin/src/rules/empty-props.ts`.

import ts from 'typescript'
import { rangeFromOffsets } from '../diagnostic.js'
import type { CompilerModule } from '../module.js'
import { ELEMENT_HELPERS } from './_element-helpers.js'

export function emptyPropsModule(): CompilerModule {
  return {
    name: 'empty-props',
    compilerVersion: '^0.3.0',
    diagnostics: [
      {
        id: 'llui/empty-props',
        description: 'Empty {} props passed to an element helper — drop it.',
      },
    ],
    visitors: {
      [ts.SyntaxKind.SourceFile]: (ctx, node) => {
        const visited = node as ts.SourceFile
        const sf = ts.createSourceFile(visited.fileName, visited.text, ts.ScriptTarget.Latest, true)
        const walk = (n: ts.Node): void => {
          if (
            ts.isCallExpression(n) &&
            ts.isIdentifier(n.expression) &&
            ELEMENT_HELPERS.has(n.expression.text)
          ) {
            const first = n.arguments[0]
            if (first && ts.isObjectLiteralExpression(first) && first.properties.length === 0) {
              const name = n.expression.text
              ctx.reportDiagnostic({
                id: 'llui/empty-props',
                severity: 'error',
                category: 'style',
                message:
                  `Empty props object passed to \`${name}()\`. The attrs argument is optional — ` +
                  `omit it: \`${name}([...])\` instead of \`${name}({}, [...])\`.`,
                location: {
                  file: sf.fileName,
                  range: rangeFromOffsets(sf.text, first.getStart(sf), first.getEnd()),
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
