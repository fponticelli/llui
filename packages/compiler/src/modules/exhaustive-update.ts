// `exhaustive-update` — errors when update()'s top-level switch on
// `msg.type` fails to handle every variant of the file-local `Msg`
// union. Catches the stale-reducer bug: author adds a Msg variant
// + a view branch dispatching it, forgets the corresponding `case`,
// and the new message silently no-ops in update().
//
// Limitations:
//   - Only the file-local `type Msg = ...` declaration is inspected
//     (matches the original Vite-plugin diagnostic's scope). Imported
//     or composed Msg unions are out of scope here; the file-local
//     case is the common one and the most stable to detect.
//   - A `default:` clause silences the rule on the assumption the
//     author has explicit fall-through handling.
//
// Migrated from `@llui/eslint-plugin/src/rules/exhaustive-update.ts`.

import ts from 'typescript'
import { rangeFromOffsets } from '../diagnostic.js'
import type { CompilerModule } from '../module.js'
import { findComponentCalls } from './_shared.js'

/**
 * Walk a top-level statement looking for `type Msg = ...` declarations
 * (or `export type Msg = ...`) and collect every string literal
 * `type:` discriminant in the union members.
 */
function collectMsgVariants(sf: ts.SourceFile): Set<string> {
  const out = new Set<string>()
  const visitTypeNode = (t: ts.TypeNode): void => {
    if (ts.isUnionTypeNode(t)) {
      for (const m of t.types) visitTypeNode(m)
      return
    }
    if (!ts.isTypeLiteralNode(t)) return
    for (const m of t.members) {
      if (!ts.isPropertySignature(m)) continue
      if (!m.name || !ts.isIdentifier(m.name) || m.name.text !== 'type') continue
      const ann = m.type
      if (!ann || !ts.isLiteralTypeNode(ann)) continue
      const lit = ann.literal
      if (ts.isStringLiteral(lit)) out.add(lit.text)
    }
  }
  for (const stmt of sf.statements) {
    if (ts.isTypeAliasDeclaration(stmt) && stmt.name.text === 'Msg') {
      visitTypeNode(stmt.type)
    }
  }
  return out
}

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

function findFirstSwitch(body: ts.Node): ts.SwitchStatement | undefined {
  let found: ts.SwitchStatement | undefined
  const walk = (n: ts.Node): void => {
    if (found) return
    if (ts.isSwitchStatement(n)) {
      found = n
      return
    }
    ts.forEachChild(n, walk)
  }
  walk(body)
  return found
}

export function exhaustiveUpdateModule(): CompilerModule {
  return {
    name: 'exhaustive-update',
    compilerVersion: '^0.3.0',
    diagnostics: [
      {
        id: 'llui/exhaustive-update',
        description: 'update() switch does not handle every variant of the file-local Msg union.',
      },
    ],
    visitors: {
      [ts.SyntaxKind.SourceFile]: (ctx, node) => {
        const visited = node as ts.SourceFile
        const sf = ts.createSourceFile(visited.fileName, visited.text, ts.ScriptTarget.Latest, true)
        const variants = collectMsgVariants(sf)
        if (variants.size === 0) return
        for (const call of findComponentCalls(sf)) {
          const updateProp = findUpdateProperty(call)
          if (!updateProp) continue
          const fn = updateProp.initializer
          if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) continue
          if (!fn.body) continue
          const sw = findFirstSwitch(fn.body)
          if (!sw) continue
          let hasDefault = false
          const handled = new Set<string>()
          for (const c of sw.caseBlock.clauses) {
            if (ts.isDefaultClause(c)) {
              hasDefault = true
              continue
            }
            const test = c.expression
            if (test && ts.isStringLiteral(test)) handled.add(test.text)
          }
          if (hasDefault) continue
          const missing = [...variants].filter((v) => !handled.has(v))
          if (missing.length === 0) continue
          const plural = missing.length > 1 ? 's' : ''
          const names = missing.map((m) => `'${m}'`).join(', ')
          const casesNeeded = missing.map((m) => `      case '${m}': return [state, []]`).join('\n')
          ctx.reportDiagnostic({
            id: 'llui/exhaustive-update',
            severity: 'error',
            category: 'reactivity',
            message:
              `update() does not handle Msg variant${plural} ${names}. ` +
              `Either add a case for each, e.g.:\n${casesNeeded}\n` +
              `or add a \`default:\` clause if silent fall-through is intentional.`,
            location: {
              file: sf.fileName,
              range: rangeFromOffsets(sf.text, updateProp.getStart(sf), updateProp.getEnd()),
            },
          })
        }
      },
    },
  }
}
