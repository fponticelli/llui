import ts from 'typescript'
import { isNullLiteral, peelNullUnion, peelOptionalUnion } from './union-peel.js'
import type { ParsedModule } from './parse.js'

/**
 * Build a TypeScript expression representing the given StateType as a
 * runtime-readable literal. The emission shape mirrors the StateType
 * tagged union — `string`/`number`/`boolean`/`null`/`unknown` become string
 * literals; the structural kinds become object literals with a `kind`
 * field plus the appropriate payload (`of`/`fields`/`values`).
 *
 * Used by the transform for state-schema emission. The shape
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

/**
 * Descriptor for one state field's type, as consumed by agents/devtools.
 *
 * `'null'` describes a field whose declared type includes `null`. It is a
 * VALUE, not an absence: `null` survives JSON (state must be
 * JSON-serializable) and TypeScript keeps `field: T | null` required, so a
 * nullable field is emitted as `{kind: 'union', of: [T, 'null']}` and NEVER
 * as `{kind: 'optional'}`. When `T` is itself a union its members are spliced
 * into that list rather than nested, so the member list stays flat:
 * `string | number | null` is `{kind: 'union', of: ['string', 'number',
 * 'null']}`. `T | undefined` is the opposite case — it means
 * the field may be absent, and is emitted as `{kind: 'optional', of: T}`
 * exactly like `field?: T`. A field declared `T | null | undefined` is both:
 * `{kind: 'optional', of: {kind: 'union', of: [T, 'null']}}`.
 */
export type StateType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'unknown'
  | { kind: 'enum'; values: string[] }
  | { kind: 'array'; of: StateType }
  | { kind: 'object'; fields: Record<string, StateType> }
  | { kind: 'optional'; of: StateType }
  | { kind: 'union'; of: StateType[] }

export interface StateSchema {
  fields: Record<string, StateType>
}

/** Local type declarations available for reference resolution: `type X = …`
 * aliases and `interface X { … }` member lists. */
interface TypeScope {
  aliases: Map<string, ts.TypeNode>
  interfaces: Map<string, ts.NodeArray<ts.TypeElement>>
}

/** Budget for following NAMED type references (aliases/interfaces). A recursive
 * `State` (`type State = { children: State[] }`) or mutually-recursive types would
 * otherwise recurse forever; when the budget is spent the reference resolves to
 * `'unknown'`. Mirrors msg-schema's MAX_FIELD_DEPTH. Inline structural moves
 * (arrays, unions, inline object literals) do NOT consume the budget. */
const MAX_TYPE_DEPTH = 6

/**
 * Walk `type State = { … }` (or a type matching a user-provided name) and emit
 * a JSON-serializable shape descriptor. Supports primitives, string-literal
 * unions, arrays, nested objects, `T | undefined` optional fields and
 * `T | null` nullable ones (optionality and nullability are distinct — see
 * {@link StateType}).
 *
 * Returns null if the named type isn't found or isn't a type literal.
 *
 * Takes a {@link ParsedModule}, not a source string: the tree is shared with
 * lint, the transform and the cross-file resolver (one parse per pass, #93), and
 * the module carries the real filename — this used to parse every source as
 * `input.ts`, i.e. a `.tsx` component's State was read out of a TSX file parsed
 * as TS. TypeScript's error recovery masked that for most JSX; it did NOT where
 * recovery consumes the statement that follows. A `.tsx` module with
 * `const list = <ul>{xs.map(x => <li key={x}>{x}</li>)}</ul>` above
 * `export type State` returned `null` here, so an `agent: true` build shipped no
 * `$ss` — with no error anywhere.
 */
export function extractStateSchema(mod: ParsedModule, typeName = 'State'): StateSchema | null {
  const sf = mod.sourceFile()

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

  return { fields: buildFields(members, scope, MAX_TYPE_DEPTH) }
}

/** Build a field map from object-type members — shared by the top-level State,
 * nested object literals, and interfaces. `depth` is the remaining budget for
 * following named type references (see {@link MAX_TYPE_DEPTH}). */
function buildFields(
  members: readonly ts.TypeElement[],
  scope: TypeScope,
  depth: number,
): Record<string, StateType> {
  const fields: Record<string, StateType> = {}
  for (const member of members) {
    if (!ts.isPropertySignature(member) || !member.name || !ts.isIdentifier(member.name)) continue
    if (!member.type) {
      fields[member.name.text] = 'unknown'
      continue
    }
    let t = resolve(member.type, scope, depth)
    // `mode?: T | undefined` says "optional" twice; one wrapper is enough.
    if (member.questionToken && !isOptional(t)) t = { kind: 'optional', of: t }
    fields[member.name.text] = t
  }
  return fields
}

/** True when `t` is already wrapped in an `optional` descriptor. */
function isOptional(t: StateType): boolean {
  return typeof t === 'object' && t.kind === 'optional'
}

function resolve(type: ts.TypeNode, scope: TypeScope, depth: number): StateType {
  if (type.kind === ts.SyntaxKind.StringKeyword) return 'string'
  if (type.kind === ts.SyntaxKind.NumberKeyword) return 'number'
  if (type.kind === ts.SyntaxKind.BooleanKeyword) return 'boolean'

  // `null` — a real, JSON-serializable value (see StateType's doc comment).
  if (isNullLiteral(type)) return 'null'

  // A lone string literal is a one-value enum. Reached both directly
  // (`mode: 'a'`) and as the remainder of `'a' | undefined` once the
  // optional branch is peeled, which is why a single-member optional
  // carries its value like any wider literal union does.
  if (ts.isLiteralTypeNode(type) && ts.isStringLiteral(type.literal)) {
    return { kind: 'enum', values: [type.literal.text] }
  }

  // T[] — inline structural move, budget unchanged.
  if (ts.isArrayTypeNode(type)) {
    return { kind: 'array', of: resolve(type.elementType, scope, depth) }
  }
  // Array<T>
  if (
    ts.isTypeReferenceNode(type) &&
    ts.isIdentifier(type.typeName) &&
    type.typeName.text === 'Array'
  ) {
    const arg = type.typeArguments?.[0]
    return { kind: 'array', of: arg ? resolve(arg, scope, depth) : 'unknown' }
  }

  // Object literal: { foo: bar } — inline, budget unchanged.
  if (ts.isTypeLiteralNode(type)) {
    return { kind: 'object', fields: buildFields(type.members, scope, depth) }
  }

  // Union: enum-of-strings, or general union, or T | undefined / T | null
  if (ts.isUnionTypeNode(type)) {
    // `T | undefined` → optional. The peel runs BEFORE the classification
    // below and BEFORE the null peel, and both orderings are load-bearing:
    //  - before classification, because the literal-union scan rejects a
    //    union the moment it meets a non-literal member, so `'a' | 'b' |
    //    undefined` would fall through to the general-union arm and come out
    //    as a union of `unknown` — losing the enum values AND the
    //    optionality that `| undefined` exists to express (#88);
    //  - before the null peel, so optionality stays the OUTERMOST wrapper:
    //    `'a' | 'b' | null | undefined` is an optional field whose value may
    //    be null, not a union one of whose members is optional.
    // The remainder is classified by recursing, so the enum and the null
    // branch below are both still reached.
    const optional = peelOptionalUnion(type)
    if (optional.isImplicitOptional) {
      return { kind: 'optional', of: resolve(optional.type, scope, depth) }
    }

    // `T | null` → a union with a `'null'` member, NOT an optional: null is a
    // value the field can hold, not an absence (see StateType's doc comment).
    // Peeled for the same reason as `undefined` — so the remainder can still
    // be recognised as an enum — then re-attached. A remainder that is ITSELF
    // a union is spliced rather than nested: `string | number | null` is
    // `['string','number','null']`, not `[['string','number'],'null']`. The
    // nested form is well-formed but `$ss`'s only audience is an LLM reading
    // it, and one flat member list is easier to reason about than two.
    const nullable = peelNullUnion(type)
    if (nullable.isNullable) {
      const rest = resolve(nullable.type, scope, depth)
      const members = typeof rest === 'object' && rest.kind === 'union' ? rest.of : [rest]
      return { kind: 'union', of: [...members, 'null'] }
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
    return { kind: 'union', of: type.types.map((t) => resolve(t, scope, depth)) }
  }

  // Type reference: resolve via the alias map OR an interface declaration. This
  // is the ONLY step that consumes the depth budget — a self- or mutually-
  // recursive reference bottoms out at 'unknown' once the budget is spent.
  if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) {
    if (depth <= 0) return 'unknown'
    const aliased = scope.aliases.get(type.typeName.text)
    if (aliased) return resolve(aliased, scope, depth - 1)
    const iface = scope.interfaces.get(type.typeName.text)
    if (iface) return { kind: 'object', fields: buildFields(iface, scope, depth - 1) }
  }

  return 'unknown'
}
