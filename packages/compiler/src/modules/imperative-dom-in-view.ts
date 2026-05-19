// `imperative-dom-in-view` — errors on `document.querySelector` and
// friends inside view() unless wrapped in `onMount()` or a deferred
// callback (event handler, setTimeout, addEventListener, promise
// chain). Imperative DOM reads in view() execute eagerly at
// view-build time and miss every subsequent reactive update — they
// silently break the framework's reactive model. Migrated from
// `@llui/eslint-plugin/src/rules/imperative-dom-in-view.ts`.

import ts from 'typescript'
import { rangeFromOffsets } from '../diagnostic.js'
import type { CompilerModule } from '../module.js'
import { findComponentCalls } from './_shared.js'

const IMPERATIVE_DOM_METHODS = new Set([
  'querySelector',
  'querySelectorAll',
  'getElementById',
  'getElementsByClassName',
  'getElementsByTagName',
])

const DEFERRED_TIMER_CALLEES = new Set([
  'setTimeout',
  'setInterval',
  'queueMicrotask',
  'requestAnimationFrame',
  'requestIdleCallback',
])

const DEFERRED_METHOD_CALLEES = new Set(['addEventListener', 'then', 'catch', 'finally'])

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
 * True when `fn`'s immediate parent context is a deferred boundary —
 * an event handler, a timer callback, an `addEventListener` / promise
 * `.then` argument. Inside any of those, imperative DOM is fine
 * (it runs after the view has mounted).
 */
function isDeferredCallback(fn: ts.ArrowFunction | ts.FunctionExpression): boolean {
  const parent = fn.parent
  if (!parent) return false
  if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) {
    if (/^on[A-Z]/.test(parent.name.text)) return true
  }
  if (ts.isCallExpression(parent)) {
    if (ts.isIdentifier(parent.expression) && DEFERRED_TIMER_CALLEES.has(parent.expression.text)) {
      return true
    }
    if (
      ts.isPropertyAccessExpression(parent.expression) &&
      ts.isIdentifier(parent.expression.name) &&
      DEFERRED_METHOD_CALLEES.has(parent.expression.name.text)
    ) {
      return true
    }
  }
  return false
}

export function imperativeDomInViewModule(): CompilerModule {
  return {
    name: 'imperative-dom-in-view',
    compilerVersion: '^0.3.0',
    diagnostics: [
      {
        id: 'llui/imperative-dom-in-view',
        description:
          'Imperative DOM access (document.querySelector, getElementById, etc.) in view() — use LLui primitives or onMount.',
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

          const walk = (n: ts.Node, inOnMount: boolean, inDeferred: boolean): void => {
            let nextOnMount = inOnMount
            let nextDeferred = inDeferred
            if (
              ts.isCallExpression(n) &&
              ts.isIdentifier(n.expression) &&
              n.expression.text === 'onMount'
            ) {
              nextOnMount = true
            }
            if (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) {
              if (isDeferredCallback(n)) nextDeferred = true
            }
            if (
              ts.isPropertyAccessExpression(n) &&
              ts.isIdentifier(n.expression) &&
              n.expression.text === 'document' &&
              ts.isIdentifier(n.name) &&
              IMPERATIVE_DOM_METHODS.has(n.name.text) &&
              !nextOnMount &&
              !nextDeferred
            ) {
              ctx.reportDiagnostic({
                id: 'llui/imperative-dom-in-view',
                severity: 'error',
                category: 'reactivity',
                message: `Imperative DOM access (\`document.${n.name.text}\`) in view() runs once at view-build time and misses every subsequent update — the result is not reactive. Use LLui primitives (\`text\`, \`show\`, \`branch\`, \`each\`) for reactive rendering, or wrap in \`onMount(() => { … })\` if you genuinely need imperative DOM on mount.`,
                location: {
                  file: sf.fileName,
                  range: rangeFromOffsets(sf.text, n.getStart(sf), n.getEnd()),
                },
              })
            }
            ts.forEachChild(n, (c) => walk(c, nextOnMount, nextDeferred))
          }
          if (fn.body) walk(fn.body, false, false)
        }
      },
    },
  }
}
