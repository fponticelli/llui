// `nested-send-in-update` — errors when a `send()` call appears
// directly inside a component's update function. Calling `send` from
// update causes recursive dispatch (update → send → update → …);
// the correct pattern is to return `[newState, [effect]]` so the
// runtime drives the next message via the effect handler. Migrated
// from `@llui/eslint-plugin/src/rules/nested-send-in-update.ts`.

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

export function nestedSendInUpdateModule(): CompilerModule {
  return {
    name: 'nested-send-in-update',
    compilerVersion: '^0.3.0',
    diagnostics: [
      {
        id: 'llui/nested-send-in-update',
        description: 'send() called inside update() — return effects instead.',
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

          // Walk the update body. `send()` calls directly inside update
          // are violations; calls inside a nested function are deferred
          // callbacks and fine.
          const walk = (n: ts.Node): void => {
            if (
              ts.isArrowFunction(n) ||
              ts.isFunctionExpression(n) ||
              ts.isFunctionDeclaration(n)
            ) {
              if (n !== fn) return // boundary — don't descend into nested fns
            }
            if (
              ts.isCallExpression(n) &&
              ts.isIdentifier(n.expression) &&
              n.expression.text === 'send'
            ) {
              ctx.reportDiagnostic({
                id: 'llui/nested-send-in-update',
                severity: 'error',
                category: 'reactivity',
                message:
                  '`send()` called directly inside update() — causes recursive dispatch. Return an effect instead: `return [newState, [myEffect]]`, and the effect handler can send follow-up messages.',
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
