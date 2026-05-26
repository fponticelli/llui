// `no-repeated-item-current` — warns when an `each.render` callback's
// accessor body calls `item.current()` and chains a property/index
// access onto the result (e.g. `item.current().facts[K]`), regardless
// of how many times.
//
// Two reasons the chained pattern is dangerous:
//
//   1. **Bitmask trap (fires on a single call).** `item.current().X`
//      hides the read from the compiler's static analyzer — the
//      accessor falls back to FULL_MASK and fires on every state
//      change instead of only when `X` changes. This applies the
//      first time as much as the tenth.
//   2. **Reconcile-race undefined (fires on 2+ calls).** Repeated
//      `.current()` calls across a single accessor body can observe
//      intermediate state during a structural transition. The chained
//      property access then throws `Cannot read properties of
//      undefined (reading 'X')`. The dungeonlogs 2026-05-20 report
//      named exactly this class of bug.
//
// The fix is one of:
//   - destructure once: `const e = item.current(); use e.X, e.Y`
//   - project to a row type in `items` so each cell becomes a simple
//     field read (`item.X` shorthand)
//
// Severity: warn. A bare `item.current()` call (no chained access,
// e.g. `text(() => item.current())` for primitive T or a value
// returned directly to a helper) does NOT trigger the warning — the
// chain is what opaques the analyzer.

import ts from 'typescript'
import { rangeFromOffsets } from '../diagnostic.js'
import type { CompilerModule } from '../module.js'

/** True when `node` is `item.current()` — bare `item` identifier root. */
function isItemCurrentCall(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false
  if (node.arguments.length !== 0) return false
  if (!ts.isPropertyAccessExpression(node.expression)) return false
  const obj = node.expression.expression
  if (!ts.isIdentifier(obj) || obj.text !== 'item') return false
  const name = node.expression.name
  return ts.isIdentifier(name) && name.text === 'current'
}

/**
 * Find direct-children `item.current()` calls of `body` that are
 * followed by a property access (e.g. `item.current().X`). Skip nested
 * function bodies — a `.current()` inside an inner arrow runs in a
 * different scope.
 */
function findChainedItemCurrents(body: ts.Node): ts.CallExpression[] {
  const out: ts.CallExpression[] = []
  const walk = (n: ts.Node): void => {
    if (isItemCurrentCall(n)) {
      // We only flag chained access — `item.current()` alone is fine
      // (used as a return value, passed to a helper, etc.).
      const parent = n.parent
      if (parent && ts.isPropertyAccessExpression(parent) && parent.expression === n) {
        out.push(n)
      } else if (parent && ts.isElementAccessExpression(parent) && parent.expression === n) {
        out.push(n)
      }
      return
    }
    if (
      (ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n)) &&
      n !== body
    ) {
      return
    }
    ts.forEachChild(n, walk)
  }
  walk(body)
  return out
}

/**
 * Walk a function body and report when any inner accessor (arrow arg
 * to `text` / `unsafeHtml` / `h.show({ when })` / similar) calls
 * `item.current().X` more than once.
 */
function checkRenderBody(
  body: ts.Node,
  sf: ts.SourceFile,
  report: (offender: ts.CallExpression) => void,
): void {
  const visit = (n: ts.Node): void => {
    if (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) {
      const calls = findChainedItemCurrents(n.body)
      // Any chained `item.current().X` opaques the bitmask analyzer;
      // 2+ also opens the reconcile-race undefined window. Report the
      // first chained call either way — the fix is the same and the
      // user wants the earliest location flagged.
      if (calls.length >= 1) {
        report(calls[0]!)
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(body)
  void sf
}

/**
 * Detect an `each(...)` or `h.each(...)` call. Returns the render
 * function's body if present.
 */
function eachRenderBody(call: ts.CallExpression): ts.Node | undefined {
  let isEach = false
  if (ts.isIdentifier(call.expression) && call.expression.text === 'each') isEach = true
  else if (
    ts.isPropertyAccessExpression(call.expression) &&
    ts.isIdentifier(call.expression.name) &&
    call.expression.name.text === 'each'
  ) {
    isEach = true
  }
  if (!isEach) return undefined
  const arg = call.arguments[0]
  if (!arg || !ts.isObjectLiteralExpression(arg)) return undefined
  for (const prop of arg.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === 'render' &&
      (ts.isArrowFunction(prop.initializer) || ts.isFunctionExpression(prop.initializer))
    ) {
      return prop.initializer.body
    }
  }
  return undefined
}

export function noRepeatedItemCurrentModule(): CompilerModule {
  return {
    name: 'no-repeated-item-current',
    compilerVersion: '^0.3.0',
    diagnostics: [
      {
        id: 'llui/no-repeated-item-current',
        description:
          'Chained `item.current().X` in an each.render accessor — opaques the bitmask analyzer (FULL_MASK fallback fires on every state change), and 2+ calls also expose a reconcile-race undefined window. Destructure once or project to a row type.',
      },
    ],
    visitors: {
      [ts.SyntaxKind.SourceFile]: (ctx, node) => {
        const visited = node as ts.SourceFile
        const sf = ts.createSourceFile(visited.fileName, visited.text, ts.ScriptTarget.Latest, true)
        const walk = (n: ts.Node): void => {
          if (ts.isCallExpression(n)) {
            const body = eachRenderBody(n)
            if (body) {
              checkRenderBody(body, sf, (offender) => {
                ctx.reportDiagnostic({
                  id: 'llui/no-repeated-item-current',
                  severity: 'warning',
                  category: 'reactivity',
                  message:
                    `Chained \`item.current().X\` inside an each.render accessor. The compiler can't trace through ` +
                    `\`.current()\` so the binding falls back to FULL_MASK (fires on every state change instead of only ` +
                    `when X changes). Two or more chained calls in the same accessor additionally expose a reconcile-race ` +
                    `window where the property access throws \`Cannot read properties of undefined\`. ` +
                    `Either destructure once at the top — \`const e = item.current(); /* use e.X, e.Y */\` — or project ` +
                    `to a row type in \`items\` so each cell becomes a simple field read (\`item.X\` shorthand).`,
                  location: {
                    file: sf.fileName,
                    range: rangeFromOffsets(sf.text, offender.getStart(sf), offender.getEnd()),
                  },
                })
              })
            }
          }
          ts.forEachChild(n, walk)
        }
        walk(sf)
      },
    },
  }
}
