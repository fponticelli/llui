// `no-list-render-in-sample` — errors when `sample()` wraps a `.map()`
// over state-derived items. `sample` is a one-shot imperative read; the
// rendered cells go stale on in-place row updates. Use `each + ItemAccessor`.
// Migrated from
// `@llui/eslint-plugin/src/rules/no-list-render-in-sample.ts`.

import ts from 'typescript'
import { rangeFromOffsets } from '../diagnostic.js'
import type { CompilerModule } from '../module.js'

const STATE_PARAM_NAMES = new Set(['s', 'state', 'props'])

function isStateRootedMemberMap(n: ts.Node): boolean {
  if (!ts.isCallExpression(n)) return false
  if (!ts.isPropertyAccessExpression(n.expression)) return false
  if (!ts.isIdentifier(n.expression.name) || n.expression.name.text !== 'map') return false
  let cursor: ts.Expression = n.expression.expression
  while (ts.isPropertyAccessExpression(cursor)) cursor = cursor.expression
  if (!ts.isIdentifier(cursor)) return false
  return STATE_PARAM_NAMES.has(cursor.text)
}

function bodyContainsStateMap(body: ts.Node): boolean {
  let found = false
  const walk = (n: ts.Node): void => {
    if (found) return
    if (isStateRootedMemberMap(n)) {
      found = true
      return
    }
    ts.forEachChild(n, walk)
  }
  walk(body)
  return found
}

export function noListRenderInSampleModule(): CompilerModule {
  return {
    name: 'no-list-render-in-sample',
    compilerVersion: '^0.3.0',
    diagnostics: [
      {
        id: 'llui/no-list-render-in-sample',
        description: '`sample()` wrapping `.map()` over state-derived items — cells go stale.',
      },
    ],
    visitors: {
      [ts.SyntaxKind.SourceFile]: (ctx, node) => {
        const visited = node as ts.SourceFile
        const sf = ts.createSourceFile(visited.fileName, visited.text, ts.ScriptTarget.Latest, true)
        const walk = (n: ts.Node): void => {
          if (ts.isCallExpression(n)) {
            let isSample = false
            if (ts.isIdentifier(n.expression) && n.expression.text === 'sample') isSample = true
            else if (
              ts.isPropertyAccessExpression(n.expression) &&
              ts.isIdentifier(n.expression.name) &&
              n.expression.name.text === 'sample'
            )
              isSample = true
            if (isSample) {
              const arg = n.arguments[0]
              if (arg && (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) && arg.body) {
                if (bodyContainsStateMap(arg.body)) {
                  ctx.reportDiagnostic({
                    id: 'llui/no-list-render-in-sample',
                    severity: 'error',
                    category: 'reactivity',
                    message:
                      `\`sample()\` is a one-shot read — \`.map()\` over state-derived items inside ` +
                      `it captures the rows at view-construction and the cells go stale when row ` +
                      `data updates in place. Use \`each({ items: (s) => s.<list>, key, render })\` ` +
                      `and bind cells reactively via \`text(item.field)\` / ` +
                      `\`show({ when: () => item.flag() })\`. See cookbook recipe "List of editable rows."`,
                    location: {
                      file: sf.fileName,
                      range: rangeFromOffsets(sf.text, n.getStart(sf), n.getEnd()),
                    },
                  })
                }
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
