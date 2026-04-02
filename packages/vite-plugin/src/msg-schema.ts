import ts from 'typescript'

export interface MsgSchema {
  discriminant: string
  variants: Record<string, Record<string, string | { enum: string[] }>>
}

export function extractMsgSchema(source: string): MsgSchema | null {
  const sf = ts.createSourceFile('input.ts', source, ts.ScriptTarget.Latest, true)

  for (const stmt of sf.statements) {
    if (!ts.isTypeAliasDeclaration(stmt)) continue
    if (stmt.name.text !== 'Msg') continue

    const variants: MsgSchema['variants'] = {}
    collectVariants(stmt.type, variants)

    if (Object.keys(variants).length === 0) return null

    return { discriminant: 'type', variants }
  }

  return null
}

function collectVariants(
  type: ts.TypeNode,
  variants: MsgSchema['variants'],
): void {
  if (ts.isUnionTypeNode(type)) {
    for (const member of type.types) {
      collectVariants(member, variants)
    }
    return
  }

  if (ts.isTypeLiteralNode(type)) {
    let discriminantValue: string | null = null
    const fields: Record<string, string | { enum: string[] }> = {}

    for (const member of type.members) {
      if (!ts.isPropertySignature(member) || !member.name || !ts.isIdentifier(member.name))
        continue

      const name = member.name.text
      const memberType = member.type

      if (name === 'type' && memberType) {
        // Extract the discriminant value
        if (ts.isLiteralTypeNode(memberType) && ts.isStringLiteral(memberType.literal)) {
          discriminantValue = memberType.literal.text
        }
        continue
      }

      if (!memberType) {
        fields[name] = 'unknown'
        continue
      }

      fields[name] = resolveFieldType(memberType)
    }

    if (discriminantValue) {
      variants[discriminantValue] = fields
    }
  }
}

function resolveFieldType(type: ts.TypeNode): string | { enum: string[] } {
  // Primitive keywords
  if (type.kind === ts.SyntaxKind.StringKeyword) return 'string'
  if (type.kind === ts.SyntaxKind.NumberKeyword) return 'number'
  if (type.kind === ts.SyntaxKind.BooleanKeyword) return 'boolean'

  // String literal union: 'a' | 'b' | 'c'
  if (ts.isUnionTypeNode(type)) {
    const literals: string[] = []
    let allLiterals = true
    for (const member of type.types) {
      if (ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal)) {
        literals.push(member.literal.text)
      } else {
        allLiterals = false
        break
      }
    }
    if (allLiterals && literals.length > 0) {
      return { enum: literals }
    }
  }

  return 'unknown'
}
