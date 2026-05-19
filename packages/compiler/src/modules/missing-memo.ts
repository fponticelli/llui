// `missing-memo` — errors when a duplicate accessor arrow appears at
// 2+ reactive binding sites inside a component's view, without any of
// them wrapped in `memo()`. The duplicates re-compute on every commit;
// wrapping in `memo()` shares the computation. Migrated from
// `@llui/eslint-plugin/src/rules/missing-memo.ts`.

import ts from 'typescript'
import { rangeFromOffsets } from '../diagnostic.js'
import type { CompilerModule } from '../module.js'
import { findComponentCalls } from './_shared.js'
import { ELEMENT_HELPERS } from './_element-helpers.js'

function findViewProperty(call: ts.CallExpression): ts.PropertyAssignment | undefined {
  const arg = call.arguments[0]
  if (!arg || !ts.isObjectLiteralExpression(arg)) return undefined
  for (const prop of arg.properties) {
    if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === 'view') {
      return prop
    }
  }
  return undefined
}

function isReactiveBinding(arrow: ts.ArrowFunction): boolean {
  const parent = arrow.parent
  if (!parent) return false
  // Case 1: first arg to text()
  if (
    ts.isCallExpression(parent) &&
    ts.isIdentifier(parent.expression) &&
    parent.expression.text === 'text' &&
    parent.arguments[0] === arrow
  ) {
    return true
  }
  // Case 2: property value of an object literal passed to an element helper
  if (ts.isPropertyAssignment(parent)) {
    const objLit = parent.parent
    if (!objLit || !ts.isObjectLiteralExpression(objLit)) return false
    const call = objLit.parent
    if (!call || !ts.isCallExpression(call)) return false
    if (!ts.isIdentifier(call.expression)) return false
    return ELEMENT_HELPERS.has(call.expression.text)
  }
  return false
}

function isInMemoCall(arrow: ts.ArrowFunction): boolean {
  const parent = arrow.parent
  return (
    !!parent &&
    ts.isCallExpression(parent) &&
    ts.isIdentifier(parent.expression) &&
    parent.expression.text === 'memo'
  )
}

export function missingMemoModule(): CompilerModule {
  return {
    name: 'missing-memo',
    compilerVersion: '^0.3.0',
    diagnostics: [
      {
        id: 'llui/missing-memo',
        description:
          'Duplicate accessor arrow used at multiple reactive binding sites without memo().',
      },
    ],
    visitors: {
      [ts.SyntaxKind.SourceFile]: (ctx, node) => {
        const visited = node as ts.SourceFile
        const sf = ts.createSourceFile(visited.fileName, visited.text, ts.ScriptTarget.Latest, true)
        for (const call of findComponentCalls(sf)) {
          const viewProp = findViewProperty(call)
          if (!viewProp) continue
          const fn = viewProp.initializer
          if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) continue
          if (!fn.body) continue

          const arrowsByText = new Map<string, { node: ts.ArrowFunction; inMemo: boolean }[]>()
          const walk = (n: ts.Node): void => {
            if (ts.isArrowFunction(n) && n.parameters.length > 0 && isReactiveBinding(n)) {
              const text = n.getText(sf).replace(/\s+/g, ' ').trim()
              const entries = arrowsByText.get(text) ?? []
              entries.push({ node: n, inMemo: isInMemoCall(n) })
              arrowsByText.set(text, entries)
            }
            ts.forEachChild(n, walk)
          }
          walk(fn.body)

          for (const [, entries] of arrowsByText) {
            if (entries.length < 2) continue
            const unmemoized = entries.filter((e) => !e.inMemo)
            if (unmemoized.length < 2) continue
            for (let i = 1; i < unmemoized.length; i++) {
              const entry = unmemoized[i]!
              ctx.reportDiagnostic({
                id: 'llui/missing-memo',
                severity: 'error',
                category: 'perf',
                message:
                  `Duplicate accessor arrow used at multiple reactive binding sites without ` +
                  `\`memo()\`. Wrap in \`memo()\` to share the computation: ` +
                  `\`const myAccessor = memo((s) => …)\`, then reference it at each site.`,
                location: {
                  file: sf.fileName,
                  range: rangeFromOffsets(sf.text, entry.node.getStart(sf), entry.node.getEnd()),
                },
              })
            }
          }
        }
      },
    },
  }
}
