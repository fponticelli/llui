// `static-items` — errors when `each({ items })` receives a factory that
// doesn't read state. Without state reads, the items list is computed
// once at mount and `each` never reconciles — adds/removes/updates are
// invisible. Migrated from
// `@llui/eslint-plugin/src/rules/static-items.ts`.

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
      // Don't count the parameter declaration itself.
      if (parent && ts.isParameter(parent) && parent.name === n) {
        return
      }
      found = true
      return
    }
    ts.forEachChild(n, walk)
  }
  walk(body)
  return found
}

export function staticItemsModule(): CompilerModule {
  return {
    name: 'static-items',
    compilerVersion: '^0.3.0',
    diagnostics: [
      {
        id: 'llui/static-items',
        description: '`each({ items })` factory reads no state — list never reconciles.',
      },
    ],
    visitors: {
      [ts.SyntaxKind.SourceFile]: (ctx, node) => {
        const visited = node as ts.SourceFile
        const sf = ts.createSourceFile(visited.fileName, visited.text, ts.ScriptTarget.Latest, true)
        const walk = (n: ts.Node): void => {
          if (ts.isCallExpression(n)) {
            let isEach = false
            if (ts.isIdentifier(n.expression) && n.expression.text === 'each') isEach = true
            else if (
              ts.isPropertyAccessExpression(n.expression) &&
              ts.isIdentifier(n.expression.name) &&
              n.expression.name.text === 'each'
            )
              isEach = true
            if (isEach) {
              const opts = n.arguments[0]
              if (opts && ts.isObjectLiteralExpression(opts)) {
                const itemsProp = opts.properties.find(
                  (p): p is ts.PropertyAssignment =>
                    ts.isPropertyAssignment(p) &&
                    ts.isIdentifier(p.name) &&
                    p.name.text === 'items',
                )
                if (itemsProp) {
                  const v = itemsProp.initializer
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
                        id: 'llui/static-items',
                        severity: 'error',
                        category: 'reactivity',
                        message:
                          `\`each()\`'s \`items\` factory reads no state — the list is computed ` +
                          `once at mount and \`each\` never reconciles. Adds, removes, and updates ` +
                          `to items will never appear in the DOM. Reference the state field that ` +
                          `holds the list, e.g. \`items: (s) => s.list.items\`.`,
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
          }
          ts.forEachChild(n, walk)
        }
        walk(sf)
      },
    },
  }
}
