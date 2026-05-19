// `controlled-input` — errors when `<input>` or `<textarea>` has a
// reactive `value` binding (arrow function) but no commit-back handler
// (`onInput`, `onChange`, or `onBlur`). Without a handler the binding
// overwrites user input on every state update — the bidirectional flow
// is broken. Migrated from
// `@llui/eslint-plugin/src/rules/controlled-input.ts`.

import ts from 'typescript'
import { rangeFromOffsets } from '../diagnostic.js'
import type { CompilerModule } from '../module.js'

const COMMIT_HANDLERS = ['onInput', 'onChange', 'onBlur'] as const

function getProps(obj: ts.ObjectLiteralExpression): Map<string, ts.Node> {
  const out = new Map<string, ts.Node>()
  for (const p of obj.properties) {
    if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) continue
    out.set(p.name.text, p.initializer)
  }
  return out
}

export function controlledInputModule(): CompilerModule {
  return {
    name: 'controlled-input',
    compilerVersion: '^0.3.0',
    diagnostics: [
      {
        id: 'llui/controlled-input',
        description:
          'Reactive `value` binding on <input>/<textarea> without a commit-back handler.',
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
            (n.expression.text === 'input' || n.expression.text === 'textarea')
          ) {
            const tag = n.expression.text
            const propsArg = n.arguments[0]
            if (propsArg && ts.isObjectLiteralExpression(propsArg)) {
              const props = getProps(propsArg)
              const value = props.get('value')
              if (value && (ts.isArrowFunction(value) || ts.isFunctionExpression(value))) {
                if (!COMMIT_HANDLERS.some((h) => props.has(h))) {
                  ctx.reportDiagnostic({
                    id: 'llui/controlled-input',
                    severity: 'error',
                    category: 'composition',
                    message:
                      `Controlled <${tag}>: reactive \`value\` binding without a commit-back ` +
                      `handler. Add one of \`onInput\`, \`onChange\`, or \`onBlur\` to dispatch ` +
                      `the new value into state — otherwise the binding overwrites user input on ` +
                      `every state update.`,
                    location: {
                      file: sf.fileName,
                      range: rangeFromOffsets(sf.text, n.getStart(sf), n.getEnd()),
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
