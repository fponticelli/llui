import ts from 'typescript'

/**
 * Build a TypeScript expression representing the given StateType as a
 * runtime-readable literal. The emission shape mirrors the StateType
 * tagged union — `string`/`number`/`boolean`/`unknown` become string
 * literals; the structural kinds become object literals with a `kind`
 * field plus the appropriate payload (`of`/`fields`/`values`).
 *
 * Used by `stateSchemaModule` for `__stateSchema` emission. The shape
 * is the runtime/agent contract; downstream tools (MCP introspection,
 * agent's "what type is this field?") consume it.
 */
export function stateTypeToLiteral(t: StateType, f: ts.NodeFactory): ts.Expression {
  if (typeof t === 'string') return f.createStringLiteral(t)
  if (t.kind === 'enum') {
    return f.createObjectLiteralExpression([
      f.createPropertyAssignment('kind', f.createStringLiteral('enum')),
      f.createPropertyAssignment(
        'values',
        f.createArrayLiteralExpression(t.values.map((v) => f.createStringLiteral(v))),
      ),
    ])
  }
  if (t.kind === 'array') {
    return f.createObjectLiteralExpression([
      f.createPropertyAssignment('kind', f.createStringLiteral('array')),
      f.createPropertyAssignment('of', stateTypeToLiteral(t.of, f)),
    ])
  }
  if (t.kind === 'optional') {
    return f.createObjectLiteralExpression([
      f.createPropertyAssignment('kind', f.createStringLiteral('optional')),
      f.createPropertyAssignment('of', stateTypeToLiteral(t.of, f)),
    ])
  }
  if (t.kind === 'union') {
    return f.createObjectLiteralExpression([
      f.createPropertyAssignment('kind', f.createStringLiteral('union')),
      f.createPropertyAssignment(
        'of',
        f.createArrayLiteralExpression(t.of.map((m) => stateTypeToLiteral(m, f))),
      ),
    ])
  }
  // object
  const fieldProps: ts.PropertyAssignment[] = []
  for (const [k, v] of Object.entries(t.fields)) {
    fieldProps.push(f.createPropertyAssignment(f.createStringLiteral(k), stateTypeToLiteral(v, f)))
  }
  return f.createObjectLiteralExpression([
    f.createPropertyAssignment('kind', f.createStringLiteral('object')),
    f.createPropertyAssignment('fields', f.createObjectLiteralExpression(fieldProps, true)),
  ])
}

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
/** Local type declarations available for reference resolution: `type X = …`
 * aliases and `interface X { … }` member lists. */
interface TypeScope {
  aliases: Map<string, ts.TypeNode>
  interfaces: Map<string, ts.NodeArray<ts.TypeElement>>
}

export function extractStateSchema(source: string, typeName = 'State'): StateSchema | null {
  const sf = ts.createSourceFile('input.ts', source, ts.ScriptTarget.Latest, true)

  // Collect local type aliases AND interfaces so references like `Todo[]` /
  // `user: User` resolve to their inline shape, whether declared as a `type` or
  // an `interface`.
  const scope: TypeScope = { aliases: new Map(), interfaces: new Map() }
  for (const stmt of sf.statements) {
    if (ts.isTypeAliasDeclaration(stmt)) scope.aliases.set(stmt.name.text, stmt.type)
    else if (ts.isInterfaceDeclaration(stmt)) scope.interfaces.set(stmt.name.text, stmt.members)
  }

  // State may be a `type State = { … }` alias OR an `interface State { … }`.
  const aliasType = scope.aliases.get(typeName)
  const members =
    aliasType && ts.isTypeLiteralNode(aliasType)
      ? aliasType.members
      : (scope.interfaces.get(typeName) ?? null)
  if (!members) return null

  return { fields: buildFields(members, scope) }
}

/** Build a field map from object-type members — shared by the top-level State,
 * nested object literals, and interfaces. */
function buildFields(
  members: readonly ts.TypeElement[],
  scope: TypeScope,
): Record<string, StateType> {
  const fields: Record<string, StateType> = {}
  for (const member of members) {
    if (!ts.isPropertySignature(member) || !member.name || !ts.isIdentifier(member.name)) continue
    if (!member.type) {
      fields[member.name.text] = 'unknown'
      continue
    }
    let t = resolve(member.type, scope)
    if (member.questionToken) t = { kind: 'optional', of: t }
    fields[member.name.text] = t
  }
  return fields
}

function resolve(type: ts.TypeNode, scope: TypeScope): StateType {
  if (type.kind === ts.SyntaxKind.StringKeyword) return 'string'
  if (type.kind === ts.SyntaxKind.NumberKeyword) return 'number'
  if (type.kind === ts.SyntaxKind.BooleanKeyword) return 'boolean'

  // T[]
  if (ts.isArrayTypeNode(type)) {
    return { kind: 'array', of: resolve(type.elementType, scope) }
  }
  // Array<T>
  if (
    ts.isTypeReferenceNode(type) &&
    ts.isIdentifier(type.typeName) &&
    type.typeName.text === 'Array'
  ) {
    const arg = type.typeArguments?.[0]
    return { kind: 'array', of: arg ? resolve(arg, scope) : 'unknown' }
  }

  // Object literal: { foo: bar }
  if (ts.isTypeLiteralNode(type)) {
    return { kind: 'object', fields: buildFields(type.members, scope) }
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
      return { kind: 'optional', of: resolve(nonUndefined[0]!, scope) }
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
    return { kind: 'union', of: type.types.map((t) => resolve(t, scope)) }
  }

  // Type reference: resolve via the alias map OR an interface declaration.
  if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) {
    const aliased = scope.aliases.get(type.typeName.text)
    if (aliased) return resolve(aliased, scope)
    const iface = scope.interfaces.get(type.typeName.text)
    if (iface) return { kind: 'object', fields: buildFields(iface, scope) }
  }

  return 'unknown'
}
