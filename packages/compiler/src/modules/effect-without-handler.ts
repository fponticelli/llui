// `effect-without-handler` — errors when a component's update returns
// effects (a non-empty second array in the `[state, effects]` tuple)
// but the component declares no `onEffect` handler. The runtime only
// handles `delay` and `log` automatically; any other effect is silently
// dropped. Migrated from
// `@llui/eslint-plugin/src/rules/effect-without-handler.ts`.

import ts from 'typescript'
import { rangeFromOffsets } from '../diagnostic.js'
import type { CompilerModule } from '../module.js'
import { findComponentCalls } from './_shared.js'

function getConfigArg(call: ts.CallExpression): ts.ObjectLiteralExpression | undefined {
  const arg = call.arguments[0]
  if (!arg || !ts.isObjectLiteralExpression(arg)) return undefined
  return arg
}

function findProp(
  obj: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | undefined {
  for (const prop of obj.properties) {
    if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === name) {
      return prop
    }
  }
  return undefined
}

/**
 * True when the function body contains an array literal of length 2
 * whose second element is a non-empty array — the `[state, [effect1, …]]`
 * pattern. We walk the whole body because the return may be inside
 * a switch branch; we don't try to scope to "actually reached" returns,
 * matching the ESLint rule's coarse-but-useful heuristic.
 */
function returnsNonEmptyEffects(body: ts.Node): boolean {
  let found = false
  const walk = (n: ts.Node): void => {
    if (found) return
    if (ts.isArrayLiteralExpression(n) && n.elements.length === 2) {
      const second = n.elements[1]
      if (second && ts.isArrayLiteralExpression(second) && second.elements.length > 0) {
        found = true
        return
      }
    }
    ts.forEachChild(n, walk)
  }
  walk(body)
  return found
}

export function effectWithoutHandlerModule(): CompilerModule {
  return {
    name: 'effect-without-handler',
    compilerVersion: '^0.3.0',
    diagnostics: [
      {
        id: 'llui/effect-without-handler',
        description:
          'update() returns effects but the component has no onEffect handler — effects will be silently dropped.',
      },
    ],
    visitors: {
      [ts.SyntaxKind.SourceFile]: (ctx, node) => {
        const visited = node as ts.SourceFile
        const sf = ts.createSourceFile(visited.fileName, visited.text, ts.ScriptTarget.Latest, true)
        for (const call of findComponentCalls(sf)) {
          const config = getConfigArg(call)
          if (!config) continue
          const updateProp = findProp(config, 'update')
          const onEffectProp = findProp(config, 'onEffect')
          if (!updateProp || onEffectProp) continue
          const fn = updateProp.initializer
          if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) continue
          if (!fn.body) continue
          if (!returnsNonEmptyEffects(fn.body)) continue

          ctx.reportDiagnostic({
            id: 'llui/effect-without-handler',
            severity: 'error',
            category: 'composition',
            message:
              'Component returns effects from update() but has no onEffect handler. Only `delay` and `log` are handled by the core runtime; any other effect is silently dropped. Add an `onEffect` handler — typically via `handleEffects<Effect>().on(...).else(...)` — or remove the effect.',
            location: {
              file: sf.fileName,
              range: rangeFromOffsets(
                sf.text,
                updateProp.name.getStart(sf),
                updateProp.name.getEnd(),
              ),
            },
          })
        }
      },
    },
  }
}
