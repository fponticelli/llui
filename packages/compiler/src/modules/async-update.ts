// `async-update` — errors on `async update` or `await` inside a
// component's update function. Update must be synchronous and pure;
// async work belongs in effects. Migrated from
// `@llui/eslint-plugin/src/rules/async-update.ts`.

import ts from 'typescript'
import { rangeFromOffsets } from '../diagnostic.js'
import type { CompilerModule } from '../module.js'
import { findComponentCalls } from './_shared.js'

function findUpdateProperty(call: ts.CallExpression): ts.PropertyAssignment | undefined {
  const arg = call.arguments[0]
  if (!arg || !ts.isObjectLiteralExpression(arg)) return undefined
  for (const prop of arg.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === 'update'
    ) {
      return prop
    }
  }
  return undefined
}

export function asyncUpdateModule(): CompilerModule {
  return {
    name: 'async-update',
    compilerVersion: '^0.3.0',
    diagnostics: [
      {
        id: 'llui/async-update',
        description: 'update() must be synchronous and pure. Move async operations to effects.',
      },
    ],
    visitors: {
      [ts.SyntaxKind.SourceFile]: (ctx, node) => {
        const visited = node as ts.SourceFile
        const sf = ts.createSourceFile(visited.fileName, visited.text, ts.ScriptTarget.Latest, true)
        for (const call of findComponentCalls(sf)) {
          const updateProp = findUpdateProperty(call)
          if (!updateProp) continue
          const fn = updateProp.initializer
          if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) continue

          const asyncMod = fn.modifiers?.find((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
          if (asyncMod) {
            ctx.reportDiagnostic({
              id: 'llui/async-update',
              severity: 'error',
              category: 'reactivity',
              message:
                'update() is declared `async`. update() must be synchronous and pure — return effects instead, and run async work in the effect handler.',
              location: {
                file: sf.fileName,
                range: rangeFromOffsets(sf.text, fn.getStart(sf), fn.getEnd()),
              },
            })
          }

          // Walk the function body top-down. An `await` outside a nested
          // function boundary is inside update() itself; an `await` inside
          // a nested arrow/function is fine (those are deferred callbacks).
          const walk = (n: ts.Node): void => {
            if (
              ts.isArrowFunction(n) ||
              ts.isFunctionExpression(n) ||
              ts.isFunctionDeclaration(n)
            ) {
              if (n !== fn) return // boundary — don't descend
            }
            if (ts.isAwaitExpression(n)) {
              ctx.reportDiagnostic({
                id: 'llui/async-update',
                severity: 'error',
                category: 'reactivity',
                message:
                  '`await` inside update(). update() must be synchronous — move the async operation to an effect (return `[newState, [myEffect]]`).',
                location: {
                  file: sf.fileName,
                  range: rangeFromOffsets(sf.text, n.getStart(sf), n.getEnd()),
                },
              })
            }
            ts.forEachChild(n, walk)
          }
          if (fn.body) walk(fn.body)
        }
      },
    },
  }
}
