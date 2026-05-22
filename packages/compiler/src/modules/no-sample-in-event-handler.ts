// `no-sample-in-event-handler` — errors when `sample()` / `h.sample()`
// appears inside an event-handler property (`onClick`, `onInput`,
// `onSubmit`, …). Event handlers run AFTER mount, with no active
// render context, so the runtime `sample()` throws `[LLui] sample()
// can only be called inside a component's view() function`.
//
// Catching at compile time turns "open the dev console, click the
// button, see the error" into a build failure on the offending file.
// Aligned with the framework's "compile-time errors not lint warnings"
// philosophy.
//
// The right pattern is to capture at render time:
//   const id = h.sample((s) => s.id)
//   button({ onClick: () => send({ type: 'select', id }) })
// or to use the mount handle: `handle.getState()` inside the handler.

import ts from 'typescript'
import { rangeFromOffsets } from '../diagnostic.js'
import type { CompilerModule } from '../module.js'

const EVENT_HANDLER_KEY_RE = /^on[A-Z]/

function isSampleCall(n: ts.Node): boolean {
  if (!ts.isCallExpression(n)) return false
  if (ts.isIdentifier(n.expression) && n.expression.text === 'sample') return true
  if (
    ts.isPropertyAccessExpression(n.expression) &&
    ts.isIdentifier(n.expression.name) &&
    n.expression.name.text === 'sample'
  ) {
    return true
  }
  return false
}

function findFirstSampleInside(body: ts.Node): ts.CallExpression | undefined {
  let found: ts.CallExpression | undefined
  const walk = (n: ts.Node): void => {
    if (found) return
    if (isSampleCall(n)) {
      found = n as ts.CallExpression
      return
    }
    // DON'T descend into nested functions — sample() inside an inner
    // function (e.g. a setTimeout body or another arrow that captures
    // the event handler's closure) runs at a different time and has
    // its own context check at runtime. Only the directly-synchronous
    // sample call in the handler body is the trap this rule targets.
    if (
      (ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n)) &&
      n !== body
    ) {
      return
    }
    ts.forEachChild(n, walk)
  }
  walk(body)
  return found
}

export function noSampleInEventHandlerModule(): CompilerModule {
  return {
    name: 'no-sample-in-event-handler',
    compilerVersion: '^0.3.0',
    diagnostics: [
      {
        id: 'llui/no-sample-in-event-handler',
        description:
          '`sample()` inside an event handler — handlers run with no render context; throws at runtime. Capture at render time instead.',
      },
    ],
    visitors: {
      [ts.SyntaxKind.SourceFile]: (ctx, node) => {
        const visited = node as ts.SourceFile
        const sf = ts.createSourceFile(visited.fileName, visited.text, ts.ScriptTarget.Latest, true)
        const walk = (n: ts.Node): void => {
          if (ts.isPropertyAssignment(n)) {
            const key = n.name
            if (ts.isIdentifier(key) && EVENT_HANDLER_KEY_RE.test(key.text)) {
              const value = n.initializer
              if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) {
                const offender = findFirstSampleInside(value.body)
                if (offender) {
                  ctx.reportDiagnostic({
                    id: 'llui/no-sample-in-event-handler',
                    severity: 'error',
                    category: 'reactivity',
                    message:
                      `\`sample()\` is being called inside the \`${key.text}\` handler. Handlers run AFTER mount with no active render context, so this throws at runtime ` +
                      `(\`[LLui] sample() can only be called inside a component's view() function\`). Capture the value at render time instead: ` +
                      `\`const id = h.sample(s => s.id); button({ ${key.text}: () => send({ ..., id }) })\`. ` +
                      `If you need the LATEST state at click time (rare), use the mount handle: ` +
                      `\`handle.getState()\` inside the handler.`,
                    location: {
                      file: sf.fileName,
                      range: rangeFromOffsets(sf.text, offender.getStart(sf), offender.getEnd()),
                    },
                  })
                }
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
