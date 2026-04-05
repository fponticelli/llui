import ts from 'typescript'

export type StateType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'unknown'
  | { kind: 'enum'; values: string[] }
  | { kind: 'array'; of: StateType }
  | { kind: 'object'; fields: Record<string, StateType> }
  | { kind: 'optional'; of: StateType }
  | { kind: 'union'; of: StateType[] }

export interface StateSchema {
  fields: Record<string, StateType>
}

/**
 * Walk `type State = { … }` (or a type matching a user-provided name) and emit
 * a JSON-serializable shape descriptor. Supports primitives, string-literal
 * unions, arrays, nested objects, and `T | undefined` optional fields.
 *
 * Returns null if the named type isn't found or isn't a type literal.
 */
export function extractStateSchema(source: string, typeName = 'State'): StateSchema | null {
  const sf = ts.createSourceFile('input.ts', source, ts.ScriptTarget.Latest, true)

  // Build a map of local type aliases so references like `Todo[]` resolve to
  // the inline shape of `type Todo = { … }`.
  const aliases = new Map<string, ts.TypeNode>()
  for (const stmt of sf.statements) {
    if (ts.isTypeAliasDeclaration(stmt)) {
      aliases.set(stmt.name.text, stmt.type)
    }
  }

  const stateType = aliases.get(typeName)
  if (!stateType) return null
  if (!ts.isTypeLiteralNode(stateType)) return null

  const fields: Record<string, StateType> = {}
  for (const member of stateType.members) {
    if (!ts.isPropertySignature(member) || !member.name || !ts.isIdentifier(member.name)) continue
    if (!member.type) {
      fields[member.name.text] = 'unknown'
      continue
    }
    let t = resolve(member.type, aliases)
    if (member.questionToken) t = { kind: 'optional', of: t }
    fields[member.name.text] = t
  }

  return { fields }
}

function resolve(type: ts.TypeNode, aliases: Map<string, ts.TypeNode>): StateType {
  if (type.kind === ts.SyntaxKind.StringKeyword) return 'string'
  if (type.kind === ts.SyntaxKind.NumberKeyword) return 'number'
  if (type.kind === ts.SyntaxKind.BooleanKeyword) return 'boolean'

  // T[]
  if (ts.isArrayTypeNode(type)) {
    return { kind: 'array', of: resolve(type.elementType, aliases) }
  }
  // Array<T>
  if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName) && type.typeName.text === 'Array') {
    const arg = type.typeArguments?.[0]
    return { kind: 'array', of: arg ? resolve(arg, aliases) : 'unknown' }
  }

  // Object literal: { foo: bar }
  if (ts.isTypeLiteralNode(type)) {
    const fields: Record<string, StateType> = {}
    for (const m of type.members) {
      if (!ts.isPropertySignature(m) || !m.name || !ts.isIdentifier(m.name)) continue
      if (!m.type) {
        fields[m.name.text] = 'unknown'
        continue
      }
      let t = resolve(m.type, aliases)
      if (m.questionToken) t = { kind: 'optional', of: t }
      fields[m.name.text] = t
    }
    return { kind: 'object', fields }
  }

  // Union: enum-of-strings, or general union, or T | undefined
  if (ts.isUnionTypeNode(type)) {
    // T | undefined → optional
    const nonUndefined = type.types.filter(
      (t) =>
        !(
          t.kind === ts.SyntaxKind.UndefinedKeyword ||
          (ts.isLiteralTypeNode(t) && t.literal.kind === ts.SyntaxKind.UndefinedKeyword)
        ),
    )
    if (nonUndefined.length === type.types.length - 1 && nonUndefined.length === 1) {
      return { kind: 'optional', of: resolve(nonUndefined[0]!, aliases) }
    }

    // String-literal union
    const literals: string[] = []
    let allStringLiterals = true
    for (const m of type.types) {
      if (ts.isLiteralTypeNode(m) && ts.isStringLiteral(m.literal)) {
        literals.push(m.literal.text)
      } else {
        allStringLiterals = false
        break
      }
    }
    if (allStringLiterals && literals.length > 0) {
      return { kind: 'enum', values: literals }
    }

    // General union
    return { kind: 'union', of: type.types.map((t) => resolve(t, aliases)) }
  }

  // Type reference: resolve via alias map if possible
  if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) {
    const aliased = aliases.get(type.typeName.text)
    if (aliased) return resolve(aliased, aliases)
  }

  return 'unknown'
}
