// `agent-nonextractable-handler` — errors when a `send(...)` call inside
// view() has a first argument that is NOT an object literal with a
// string-literal `type` field. Statically-extractable handlers are how
// the agent's `list_actions` advertises affordances; dynamic shapes
// like `send(makeMsg())` or `send({ type: variant })` are invisible to
// the static walker. Migrated from
// `@llui/eslint-plugin/src/rules/agent-nonextractable-handler.ts`.
//
// Note: the ESLint rule gated on whether `@llui/agent` is installed in
// the consumer's nearest package.json. The compiler doesn't have a
// natural way to walk up to package.json from inside a transform —
// and the consumer's intent is captured by the build pipeline already
// (if you don't ship agent metadata, the diagnostic is information-
// only). Erroring unconditionally is consistent with the
// LLM-first stance: agent-extractable handlers are always preferable.

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

function readTypeLiteral(obj: ts.ObjectLiteralExpression): string | null {
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue
    const isTypeKey =
      (ts.isIdentifier(prop.name) && prop.name.text === 'type') ||
      (ts.isStringLiteral(prop.name) && prop.name.text === 'type')
    if (!isTypeKey) continue
    if (ts.isStringLiteral(prop.initializer)) return prop.initializer.text
    if (ts.isNoSubstitutionTemplateLiteral(prop.initializer)) {
      return prop.initializer.text
    }
    return null
  }
  return null
}

export function agentNonextractableHandlerModule(): CompilerModule {
  return {
    name: 'agent-nonextractable-handler',
    compilerVersion: '^0.3.0',
    diagnostics: [
      {
        id: 'llui/agent-nonextractable-handler',
        description:
          "send() in view with non-literal-typed argument — Claude's list_actions won't advertise this action.",
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
          if (!fn.body) continue
          const walk = (n: ts.Node): void => {
            if (
              ts.isCallExpression(n) &&
              ts.isIdentifier(n.expression) &&
              n.expression.text === 'send'
            ) {
              const first = n.arguments[0]
              let nonextractable = false
              if (!first || !ts.isObjectLiteralExpression(first)) {
                nonextractable = true
              } else if (readTypeLiteral(first) === null) {
                nonextractable = true
              }
              if (nonextractable) {
                ctx.reportDiagnostic({
                  id: 'llui/agent-nonextractable-handler',
                  severity: 'error',
                  category: 'agent',
                  message:
                    `\`send()\` call in view isn't statically extractable; the agent's ` +
                    `\`list_actions\` won't advertise this action. Prefer \`send({ type: 'literal' })\` ` +
                    `with a string-literal \`type\`; avoid computed dispatch (\`send(makeMsg())\`, ` +
                    `\`send({ type: variant })\`).`,
                  location: {
                    file: sf.fileName,
                    range: rangeFromOffsets(sf.text, n.getStart(sf), n.getEnd()),
                  },
                })
              }
            }
            ts.forEachChild(n, walk)
          }
          walk(fn.body)
        }
      },
    },
  }
}
