// `pure-update-function` — errors on side-effecting calls inside a
// component's update function. update() must be a pure reducer;
// non-determinism (Math.random, Date.now), I/O (fetch, document,
// localStorage), and scheduling (setTimeout) break replay,
// time-travel debugging, and reproducibility. Return an Effect
// instead. Migrated from
// `@llui/eslint-plugin/src/rules/pure-update-function.ts`.

import ts from 'typescript'
import { rangeFromOffsets } from '../diagnostic.js'
import type { CompilerModule } from '../module.js'
import { findComponentCalls } from './_shared.js'

const BANNED_GLOBAL_CALLS = new Set([
  'fetch',
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'requestAnimationFrame',
  'cancelAnimationFrame',
])

const IMPURE_ROOT_OBJECTS = new Set(['document', 'window', 'localStorage', 'sessionStorage'])

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

export function pureUpdateFunctionModule(): CompilerModule {
  return {
    name: 'pure-update-function',
    compilerVersion: '^0.3.0',
    diagnostics: [
      {
        id: 'llui/pure-update-function',
        description: 'Side effect inside update() — return an Effect instead, keep update() pure.',
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
          if (!fn.body) continue

          const report = (n: ts.Node, name: string): void => {
            ctx.reportDiagnostic({
              id: 'llui/pure-update-function',
              severity: 'error',
              category: 'reactivity',
              message:
                `update() must be a pure reducer; \`${name}\` is a side effect. ` +
                `Return an Effect from update() (e.g. \`return [state, [{ type: 'fetch', ... }]]\`) ` +
                `and run the side effect in the corresponding effect handler.`,
              location: {
                file: sf.fileName,
                range: rangeFromOffsets(sf.text, n.getStart(sf), n.getEnd()),
              },
            })
          }

          const walk = (n: ts.Node): void => {
            // Boundary check — do walk into nested arrows here. The
            // ESLint rule used parent-chain "is inside update" without
            // a nested-fn cutoff; deferred callbacks would still trigger
            // (e.g. nested arrow that does `setTimeout` inside update).
            // We preserve that semantics: the rule flags any sync
            // *or* deferred side-effect declared in the update body,
            // because the reducer should not even orchestrate them.

            // Direct calls: fetch(), setTimeout(), …
            if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
              if (BANNED_GLOBAL_CALLS.has(n.expression.text)) {
                report(n, n.expression.text)
              }
            }
            // Member calls: window.fetch, Math.random, Date.now, document.*, localStorage.*, sessionStorage.*
            if (
              ts.isCallExpression(n) &&
              ts.isPropertyAccessExpression(n.expression) &&
              ts.isIdentifier(n.expression.name)
            ) {
              const propName = n.expression.name.text
              const root = n.expression.expression
              const objName = ts.isIdentifier(root) ? root.text : ''
              const isBanned =
                (objName === 'window' && BANNED_GLOBAL_CALLS.has(propName)) ||
                (objName === 'Math' && propName === 'random') ||
                (objName === 'Date' && propName === 'now') ||
                objName === 'document' ||
                objName === 'localStorage' ||
                objName === 'sessionStorage'
              if (isBanned) report(n, `${objName}.${propName}`)
            }
            // Bare property reads on impure root objects (not as a call).
            if (
              ts.isPropertyAccessExpression(n) &&
              ts.isIdentifier(n.expression) &&
              IMPURE_ROOT_OBJECTS.has(n.expression.text)
            ) {
              // Skip if this access is the callee of an enclosing CallExpression
              // (handled by the call branch above).
              const parent = n.parent
              const isCallee = parent && ts.isCallExpression(parent) && parent.expression === n
              if (!isCallee) {
                report(n, n.expression.text)
              }
            }
            // `new Date()` — non-deterministic time read.
            if (
              ts.isNewExpression(n) &&
              ts.isIdentifier(n.expression) &&
              n.expression.text === 'Date'
            ) {
              report(n, 'new Date()')
            }
            ts.forEachChild(n, walk)
          }
          walk(fn.body)
        }
      },
    },
  }
}
