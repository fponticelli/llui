// `form-boilerplate` — errors when a file's `type Msg = ...` union has
// 3+ variants with identical shape (a `value:` field of the same type,
// plus a `set*`/`update*`/`change*` discriminant prefix). Suggests a
// generic field-update pattern instead. Migrated from
// `@llui/eslint-plugin/src/rules/form-boilerplate.ts`.

import ts from 'typescript'
import { rangeFromOffsets } from '../diagnostic.js'
import type { CompilerModule } from '../module.js'

interface VariantShape {
  typeName: string
  shape: string
}

function collectMsgVariantShapes(typeNode: ts.TypeNode, sf: ts.SourceFile): VariantShape[] {
  const out: VariantShape[] = []
  if (ts.isUnionTypeNode(typeNode)) {
    for (const m of typeNode.types) out.push(...collectMsgVariantShapes(m, sf))
    return out
  }
  if (!ts.isTypeLiteralNode(typeNode)) return out
  let typeName = ''
  const fields: string[] = []
  for (const m of typeNode.members) {
    if (!ts.isPropertySignature(m) || !m.name || !ts.isIdentifier(m.name)) continue
    const fieldName = m.name.text
    const fieldType = m.type ? m.type.getText(sf) : 'unknown'
    if (fieldName === 'type') {
      if (m.type && ts.isLiteralTypeNode(m.type)) {
        const lit = m.type.literal
        if (ts.isStringLiteral(lit)) typeName = lit.text
      }
    } else {
      fields.push(`${fieldName}:${fieldType}`)
    }
  }
  if (typeName && fields.length > 0) {
    fields.sort()
    out.push({ typeName, shape: fields.join(',') })
  }
  return out
}

export function formBoilerplateModule(): CompilerModule {
  return {
    name: 'form-boilerplate',
    compilerVersion: '^0.3.0',
    diagnostics: [
      {
        id: 'llui/form-boilerplate',
        description:
          'Msg union has 3+ set*/update*/change* variants with identical shape — use a generic field-update message.',
      },
    ],
    visitors: {
      [ts.SyntaxKind.SourceFile]: (ctx, node) => {
        const visited = node as ts.SourceFile
        const sf = ts.createSourceFile(visited.fileName, visited.text, ts.ScriptTarget.Latest, true)
        for (const stmt of sf.statements) {
          if (!ts.isTypeAliasDeclaration(stmt)) continue
          if (stmt.name.text !== 'Msg') continue
          const variants = collectMsgVariantShapes(stmt.type, sf)
          if (variants.length < 3) continue
          const shapeGroups = new Map<string, string[]>()
          for (const v of variants) {
            const g = shapeGroups.get(v.shape) ?? []
            g.push(v.typeName)
            shapeGroups.set(v.shape, g)
          }
          for (const [shape, group] of shapeGroups) {
            if (group.length < 3) continue
            const hasValueField = shape.split(',').some((f) => f.startsWith('value:'))
            if (!hasValueField) continue
            const prefixPattern = /^(set|update|change)[A-Z]/
            if (!group.every((name) => prefixPattern.test(name))) continue
            const groupStr =
              group
                .slice(0, 3)
                .map((g) => `'${g}'`)
                .join(', ') + (group.length > 3 ? ', ...' : '')
            ctx.reportDiagnostic({
              id: 'llui/form-boilerplate',
              severity: 'error',
              category: 'style',
              message:
                `Msg union has ${group.length} variants with identical shapes (${groupStr}). ` +
                `Consider a generic field-update pattern: a single \`{ type: 'fieldChanged', ` +
                `field: 'fieldName', value: T }\` variant, with the discriminant on \`field\`. ` +
                `Reduces switch-case boilerplate and makes the update() function shorter.`,
              location: {
                file: sf.fileName,
                range: rangeFromOffsets(sf.text, stmt.getStart(sf), stmt.getEnd()),
              },
            })
          }
        }
      },
    },
  }
}
