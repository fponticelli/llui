// `state-mutation` — errors on direct mutation of the state parameter
// inside a component's update function. State is immutable; the
// runtime compares old/new state by reference to compute the dirty
// mask. Direct mutation breaks that invariant and silently disables
// bitmask gating. Migrated from
// `@llui/eslint-plugin/src/rules/state-mutation.ts`.

import ts from 'typescript'
import { rangeFromOffsets } from '../diagnostic.js'
import type { CompilerModule } from '../module.js'
import { findComponentCalls } from './_shared.js'

const MUTATING_METHODS = new Set([
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse',
  'fill',
])

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

/** True when `expr` is a member access rooted at the state binding name. */
function isStateMemberAccess(expr: ts.Node, stateName: string): boolean {
  if (!ts.isPropertyAccessExpression(expr) && !ts.isElementAccessExpression(expr)) return false
  const root = expr.expression
  if (ts.isIdentifier(root) && root.text === stateName) return true
  return isStateMemberAccess(root, stateName)
}

export function stateMutationModule(): CompilerModule {
  return {
    name: 'state-mutation',
    compilerVersion: '^0.3.0',
    diagnostics: [
      {
        id: 'llui/state-mutation',
        description:
          'Direct mutation of state in update() — state is immutable, return `{ ...state, field: value }`.',
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
          const stateParam = fn.parameters[0]
          if (!stateParam || !ts.isIdentifier(stateParam.name)) continue
          const stateName = stateParam.name.text

          const report = (n: ts.Node, msg: string): void => {
            ctx.reportDiagnostic({
              id: 'llui/state-mutation',
              severity: 'error',
              category: 'reactivity',
              message: msg,
              location: {
                file: sf.fileName,
                range: rangeFromOffsets(sf.text, n.getStart(sf), n.getEnd()),
              },
            })
          }

          const walk = (n: ts.Node): void => {
            // Don't descend into nested function expressions — those are
            // deferred callbacks, not the synchronous update body.
            if (
              (ts.isArrowFunction(n) ||
                ts.isFunctionExpression(n) ||
                ts.isFunctionDeclaration(n)) &&
              n !== fn
            ) {
              return
            }
            // Assignment: state.x = ... / state.x += ...
            if (ts.isBinaryExpression(n)) {
              const op = n.operatorToken.kind
              const isAssign =
                op === ts.SyntaxKind.EqualsToken ||
                op === ts.SyntaxKind.PlusEqualsToken ||
                op === ts.SyntaxKind.MinusEqualsToken ||
                op === ts.SyntaxKind.AsteriskEqualsToken ||
                op === ts.SyntaxKind.SlashEqualsToken ||
                op === ts.SyntaxKind.PercentEqualsToken ||
                op === ts.SyntaxKind.AmpersandEqualsToken ||
                op === ts.SyntaxKind.BarEqualsToken ||
                op === ts.SyntaxKind.CaretEqualsToken ||
                op === ts.SyntaxKind.LessThanLessThanEqualsToken ||
                op === ts.SyntaxKind.GreaterThanGreaterThanEqualsToken ||
                op === ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken
              if (isAssign && isStateMemberAccess(n.left, stateName)) {
                if (op === ts.SyntaxKind.EqualsToken) {
                  report(
                    n,
                    `Direct mutation of \`${stateName}\` in update() — state is immutable. Return a new state object: \`{ ...${stateName}, field: newValue }\`.`,
                  )
                } else {
                  report(
                    n,
                    `Compound assignment on \`${stateName}\` in update() — state is immutable. Compute the new value and return it via spread.`,
                  )
                }
              }
            }
            // ++state.x / --state.x / state.x++
            if (ts.isPostfixUnaryExpression(n) || ts.isPrefixUnaryExpression(n)) {
              const op = n.operator
              if (op === ts.SyntaxKind.PlusPlusToken || op === ts.SyntaxKind.MinusMinusToken) {
                if (isStateMemberAccess(n.operand, stateName)) {
                  report(
                    n,
                    `Increment/decrement on \`${stateName}\` in update() — state is immutable. Compute the new value and return it via spread.`,
                  )
                }
              }
            }
            // state.arr.push(…) etc.
            if (
              ts.isCallExpression(n) &&
              ts.isPropertyAccessExpression(n.expression) &&
              ts.isIdentifier(n.expression.name) &&
              MUTATING_METHODS.has(n.expression.name.text) &&
              isStateMemberAccess(n.expression.expression, stateName)
            ) {
              report(
                n,
                `Mutating method \`.${n.expression.name.text}()\` on a state property in update() — use the immutable form (e.g. \`[...arr, x]\` instead of \`arr.push(x)\`).`,
              )
            }
            ts.forEachChild(n, walk)
          }
          if (fn.body) walk(fn.body)
        }
      },
    },
  }
}
