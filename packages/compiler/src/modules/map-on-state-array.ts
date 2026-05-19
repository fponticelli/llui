// `map-on-state-array` — errors when a state-derived array is iterated
// with `.map()` inside a view function. The reactive primitive is
// `each(...)`; `.map()` produces a static list with no per-row scope,
// no key-based reconciliation, and no precise mask gating. Migrated
// from `@llui/eslint-plugin/src/rules/map-on-state-array.ts`.

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

/**
 * True when `expr` resolves to a state-like reference. We recognize
 * the conventional names — `state`, `s`, `_state` — and chained
 * property accesses rooted at one of them (e.g. `s.items.filtered`).
 * Type-aware resolution would be more precise; the conventions are
 * stable enough across the codebase that name matching catches the
 * intended cases without a checker.
 */
function isStateReference(expr: ts.Expression): boolean {
  if (ts.isIdentifier(expr)) {
    return expr.text === 'state' || expr.text === 's' || expr.text === '_state'
  }
  if (ts.isPropertyAccessExpression(expr)) {
    return isStateReference(expr.expression)
  }
  return false
}

export function mapOnStateArrayModule(): CompilerModule {
  return {
    name: 'map-on-state-array',
    compilerVersion: '^0.3.0',
    diagnostics: [
      {
        id: 'llui/map-on-state-array',
        description:
          'Array .map() on a state-derived value in view(). Use each() for reactive lists.',
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

          const walk = (n: ts.Node): void => {
            if (
              ts.isCallExpression(n) &&
              ts.isPropertyAccessExpression(n.expression) &&
              ts.isIdentifier(n.expression.name) &&
              n.expression.name.text === 'map' &&
              isStateReference(n.expression.expression)
            ) {
              ctx.reportDiagnostic({
                id: 'llui/map-on-state-array',
                severity: 'error',
                category: 'reactivity',
                message:
                  'Array `.map()` on a state-derived value inside view(). `.map()` produces a static list — use `each({ items, key, render })` for reactive lists with per-row scope and key-based reconciliation.',
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
