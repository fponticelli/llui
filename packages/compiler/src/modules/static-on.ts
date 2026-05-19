// `static-on` — errors when `scope({ on })` or `branch({ on })` receives
// a discriminant accessor that doesn't read any state. The key never
// changes, so the subtree mounts once and stagnates. Migrated from
// `@llui/eslint-plugin/src/rules/static-on.ts`.

import ts from 'typescript'
import { rangeFromOffsets } from '../diagnostic.js'
import type { CompilerModule } from '../module.js'

function bodyMayRead(body: ts.Node): boolean {
  let found = false
  const walk = (n: ts.Node): void => {
    if (found) return
    if (
      ts.isCallExpression(n) ||
      ts.isPropertyAccessExpression(n) ||
      ts.isElementAccessExpression(n)
    ) {
      found = true
      return
    }
    ts.forEachChild(n, walk)
  }
  walk(body)
  return found
}

function readsParam(body: ts.Node, paramName: string): boolean {
  let found = false
  const walk = (n: ts.Node): void => {
    if (found) return
    if (ts.isIdentifier(n) && n.text === paramName) {
      const parent = n.parent
      if (parent && ts.isParameter(parent) && parent.name === n) return
      found = true
      return
    }
    ts.forEachChild(n, walk)
  }
  walk(body)
  return found
}

export function staticOnModule(): CompilerModule {
  return {
    name: 'static-on',
    compilerVersion: '^0.3.0',
    diagnostics: [
      {
        id: 'llui/static-on',
        description: '`scope`/`branch` `on` accessor reads no state — key never changes.',
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
            (n.expression.text === 'scope' || n.expression.text === 'branch')
          ) {
            const name = n.expression.text
            const opts = n.arguments[0]
            if (opts && ts.isObjectLiteralExpression(opts)) {
              const onProp = opts.properties.find(
                (p): p is ts.PropertyAssignment =>
                  ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'on',
              )
              if (onProp) {
                const v = onProp.initializer
                if (ts.isArrowFunction(v) || ts.isFunctionExpression(v)) {
                  let isStatic = false
                  if (v.parameters.length === 0) {
                    isStatic = v.body ? !bodyMayRead(v.body) : true
                  } else if (v.parameters.length === 1) {
                    const param = v.parameters[0]!
                    if (ts.isIdentifier(param.name)) {
                      isStatic = v.body ? !readsParam(v.body, param.name.text) : true
                    }
                  }
                  if (isStatic) {
                    ctx.reportDiagnostic({
                      id: 'llui/static-on',
                      severity: 'error',
                      category: 'reactivity',
                      message:
                        `\`${name}()\`'s \`on\` accessor reads no state — the key never changes, ` +
                        `so the subtree mounts once and never rebuilds. Reference the state field(s) ` +
                        `that drive the discriminant, e.g. \`on: (s) => s.activeTab\`.`,
                      location: {
                        file: sf.fileName,
                        range: rangeFromOffsets(sf.text, n.getStart(sf), n.getEnd()),
                      },
                    })
                  }
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
