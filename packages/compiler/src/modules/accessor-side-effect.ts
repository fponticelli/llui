// `accessor-side-effect` — errors on `console.{log,warn,error}`,
// `fetch`, and `alert` calls inside reactive accessor functions
// (the arrow passed to `text(...)` or to a non-handler property like
// `class:`). Accessors re-execute on every relevant state change;
// side effects there fire repeatedly with no flush guarantee.
// Migrated from `@llui/eslint-plugin/src/rules/accessor-side-effect.ts`.

import ts from 'typescript'
import { rangeFromOffsets } from '../diagnostic.js'
import type { CompilerModule } from '../module.js'
import { findComponentCalls } from './_shared.js'

const SIDE_EFFECT_CALLEES = new Set(['fetch', 'alert'])
const CONSOLE_METHODS = new Set(['log', 'warn', 'error'])

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

/**
 * True when `fn` sits in an accessor position: the first argument of a
 * `text(...)` call, or the value of a non-`on*` property assignment
 * (so `class: s => …` qualifies, `onClick: s => …` does not).
 */
function isAccessorArrow(fn: ts.ArrowFunction): boolean {
  const parent = fn.parent
  if (!parent) return false
  if (
    ts.isCallExpression(parent) &&
    ts.isIdentifier(parent.expression) &&
    parent.expression.text === 'text' &&
    parent.arguments[0] === fn
  ) {
    return true
  }
  if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) {
    return !/^on[A-Z]/.test(parent.name.text)
  }
  return false
}

export function accessorSideEffectModule(): CompilerModule {
  return {
    name: 'accessor-side-effect',
    compilerVersion: '^0.3.0',
    diagnostics: [
      {
        id: 'llui/accessor-side-effect',
        description:
          'Side effect (console, fetch, alert) inside a reactive accessor — accessors re-run on every state change.',
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

          const walk = (n: ts.Node, inAccessor: boolean): void => {
            let nextAccessor = inAccessor
            if (ts.isArrowFunction(n)) {
              // An accessor boundary either turns the flag on (entering
              // a text() arg / property accessor) or doesn't change it.
              if (isAccessorArrow(n)) nextAccessor = true
            }
            if (inAccessor && ts.isCallExpression(n)) {
              // console.{log,warn,error}(…)
              if (
                ts.isPropertyAccessExpression(n.expression) &&
                ts.isIdentifier(n.expression.expression) &&
                n.expression.expression.text === 'console' &&
                ts.isIdentifier(n.expression.name) &&
                CONSOLE_METHODS.has(n.expression.name.text)
              ) {
                ctx.reportDiagnostic({
                  id: 'llui/accessor-side-effect',
                  severity: 'error',
                  category: 'reactivity',
                  message: `\`console.${n.expression.name.text}\` inside a reactive accessor — fires on every state change with no flush guarantee. Move logging to update() or an effect handler.`,
                  location: {
                    file: sf.fileName,
                    range: rangeFromOffsets(sf.text, n.getStart(sf), n.getEnd()),
                  },
                })
              }
              // fetch(…), alert(…)
              if (ts.isIdentifier(n.expression) && SIDE_EFFECT_CALLEES.has(n.expression.text)) {
                ctx.reportDiagnostic({
                  id: 'llui/accessor-side-effect',
                  severity: 'error',
                  category: 'reactivity',
                  message: `\`${n.expression.text}()\` inside a reactive accessor — fires on every state change. Move the call to update() (return an effect) or to an effect handler.`,
                  location: {
                    file: sf.fileName,
                    range: rangeFromOffsets(sf.text, n.getStart(sf), n.getEnd()),
                  },
                })
              }
            }
            ts.forEachChild(n, (c) => walk(c, nextAccessor))
          }
          if (fn.body) walk(fn.body, false)
        }
      },
    },
  }
}
