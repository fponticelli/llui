// `spread-in-children` — errors when an element-helper's children array
// contains a spread of a dynamic source (`div([...someList()])`).
// Disables the compiler's template-clone optimization. Locally-bounded
// spreads (`const xs = [a, b]; div([...xs])`) are exempt. Migrated from
// `@llui/eslint-plugin/src/rules/spread-in-children.ts`.

import ts from 'typescript'
import { rangeFromOffsets } from '../diagnostic.js'
import type { CompilerModule } from '../module.js'
import { ELEMENT_HELPERS } from './_element-helpers.js'

const ARRAY_ITERATION_METHODS = new Set([
  'map',
  'filter',
  'flatMap',
  'slice',
  'concat',
  'reverse',
  'sort',
])

/** Walk top-level statements and resolve `const NAME = init` to the init expression. */
function resolveTopLevelConstInit(sf: ts.SourceFile, name: string): ts.Expression | null {
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue
    if (!(stmt.declarationList.flags & ts.NodeFlags.Const)) continue
    for (const d of stmt.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.name.text === name) return d.initializer ?? null
    }
  }
  return null
}

function isBoundedArrayReceiver(sf: ts.SourceFile, recv: ts.Expression): boolean {
  if (!ts.isIdentifier(recv)) return false
  const init = resolveTopLevelConstInit(sf, recv.text)
  if (!init) return false
  if (ts.isArrayLiteralExpression(init)) return true
  if (ts.isAsExpression(init)) {
    return ts.isArrayLiteralExpression(init.expression)
  }
  return false
}

function isBoundedInitializer(sf: ts.SourceFile, init: ts.Expression): boolean {
  if (ts.isArrayLiteralExpression(init)) return true
  if (ts.isAsExpression(init)) return isBoundedInitializer(sf, init.expression)
  if (ts.isCallExpression(init)) {
    if (ts.isIdentifier(init.expression)) return true
    if (ts.isPropertyAccessExpression(init.expression) && ts.isIdentifier(init.expression.name)) {
      const method = init.expression.name.text
      if (!ARRAY_ITERATION_METHODS.has(method)) return true
      return isBoundedArrayReceiver(sf, init.expression.expression)
    }
  }
  return false
}

function isBoundedSpreadSource(sf: ts.SourceFile, expr: ts.Expression): boolean {
  if (ts.isIdentifier(expr)) {
    const init = resolveTopLevelConstInit(sf, expr.text)
    if (!init) return false
    return isBoundedInitializer(sf, init)
  }
  if (ts.isCallExpression(expr)) {
    if (ts.isPropertyAccessExpression(expr.expression) && ts.isIdentifier(expr.expression.name)) {
      const method = expr.expression.name.text
      if (!ARRAY_ITERATION_METHODS.has(method)) return true
      return isBoundedArrayReceiver(sf, expr.expression.expression)
    }
    return true
  }
  return false
}

export function spreadInChildrenModule(): CompilerModule {
  return {
    name: 'spread-in-children',
    compilerVersion: '^0.3.0',
    diagnostics: [
      {
        id: 'llui/spread-in-children',
        description:
          'Spread of a dynamic array into element children — disables template-clone optimization.',
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
            ELEMENT_HELPERS.has(n.expression.text)
          ) {
            for (const arg of n.arguments) {
              if (!ts.isArrayLiteralExpression(arg)) continue
              for (const el of arg.elements) {
                if (!ts.isSpreadElement(el)) continue
                if (isBoundedSpreadSource(sf, el.expression)) continue
                ctx.reportDiagnostic({
                  id: 'llui/spread-in-children',
                  severity: 'error',
                  category: 'perf',
                  message:
                    `Spread of a dynamic array in children of \`${n.expression.text}()\` disables ` +
                    `the compiler's template-clone optimization (the child count is no longer ` +
                    `statically known). For dynamic child counts, use \`each({ items, key, render })\` ` +
                    `instead — it gets per-row scope, key-based reconciliation, and reactive bindings.`,
                  location: {
                    file: sf.fileName,
                    range: rangeFromOffsets(sf.text, el.getStart(sf), el.getEnd()),
                  },
                })
                break
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
