// `direct-state-in-view` — errors on `state.X` reads inside an
// event handler in view(). Event handlers fire asynchronously; the
// `state` reference captured at view-build time is stale by the time
// the handler runs. The correct pattern is an accessor (`s => s.field`)
// for reactive reads, or `item.field()` for imperative reads inside
// each(). Migrated from
// `@llui/eslint-plugin/src/rules/direct-state-in-view.ts`.

import ts from 'typescript'
import { rangeFromOffsets } from '../diagnostic.js'
import type { CompilerModule } from '../module.js'
import { findComponentCalls } from './_shared.js'

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

export function directStateInViewModule(): CompilerModule {
  return {
    name: 'direct-state-in-view',
    compilerVersion: '^0.3.0',
    diagnostics: [
      {
        id: 'llui/direct-state-in-view',
        description:
          'Direct `state.X` read in an event handler — captures a stale snapshot. Use an accessor.',
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

          // Walk view body threading `inHandler` / `inAccessor` flags.
          // A `state.X` MemberExpression triggers when inside a handler
          // and not inside an accessor (an accessor in a non-handler
          // property is the legitimate reactive read).
          const walk = (n: ts.Node, inHandler: boolean, inAccessor: boolean): void => {
            // Detect entering an arrow/function as part of a Property.
            // The property key tells us whether this is an `on*` handler,
            // a non-handler accessor, or `view` (top-level).
            let nextHandler = inHandler
            let nextAccessor = inAccessor
            if (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) {
              const parent = n.parent
              if (parent && ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) {
                const key = parent.name.text
                if (key === 'view') {
                  // Top of view function — neither
                } else if (/^on[A-Z]/.test(key)) {
                  nextHandler = true
                  nextAccessor = false
                } else {
                  nextHandler = false
                  nextAccessor = true
                }
              } else if (
                parent &&
                ts.isCallExpression(parent) &&
                ts.isIdentifier(parent.expression) &&
                parent.expression.text === 'text' &&
                parent.arguments[0] === n
              ) {
                nextAccessor = true
                nextHandler = false
              }
            }
            if (
              ts.isPropertyAccessExpression(n) &&
              ts.isIdentifier(n.expression) &&
              n.expression.text === 'state' &&
              inHandler &&
              !inAccessor
            ) {
              ctx.reportDiagnostic({
                id: 'llui/direct-state-in-view',
                severity: 'error',
                category: 'reactivity',
                message:
                  'Direct `state.*` read in an event handler captures a stale snapshot — the value is frozen at view-build time, not the value when the handler fires. Use an accessor (`onClick: () => send({ type: "X", value: someAccessor })`) or read inside update(state, …).',
                location: {
                  file: sf.fileName,
                  range: rangeFromOffsets(sf.text, n.getStart(sf), n.getEnd()),
                },
              })
            }
            ts.forEachChild(n, (c) => walk(c, nextHandler, nextAccessor))
          }
          if (fn.body) walk(fn.body, false, false)
        }
      },
    },
  }
}
