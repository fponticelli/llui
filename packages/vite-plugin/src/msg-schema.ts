import ts from 'typescript'

/**
 * The "bare type" of a field. Covers five cases:
 *   - primitive keyword as a string: `'string'`, `'number'`, `'boolean'`, `'unknown'`
 *   - literal union: `{enum: ['a', 'b']}` for strings, `{enum: [1, 2, 3]}`
 *     for numbers, `{enum: [true]}` for booleans. Mixed-type literal
 *     unions stay `'unknown'`.
 *   - nested object shape: `{kind: 'object', shape: {...}}` — emitted when
 *     a field's type is a local interface/type alias the extractor could
 *     follow (depth-limited; cross-file references stay `'unknown'`).
 *   - array of element type: `{kind: 'array', element: <bare type>}`.
 *   - discriminated union of objects: `{kind: 'discriminated-union',
 *     discriminant: 'kind', variants: {a: {...}, b: {...}}}`. Emitted
 *     when every member of a union is an object literal sharing one
 *     literal-string property name with distinct values. Symmetric with
 *     how the top-level Msg union itself is encoded — same shape,
 *     recursed.
 *
 * The synthesizer in `@llui/agent`'s `list_actions` walks these to build
 * copy-paste-ready payload examples; the validator in `send_message`
 * walks them too (treating object/array as "any" since deep validation
 * is the reducer's job).
 */
export type MsgFieldType =
  | string
  | { enum: ReadonlyArray<string | number | boolean> }
  | { kind: 'object'; shape: Record<string, MsgField> }
  | { kind: 'array'; element: MsgFieldType }
  | {
      kind: 'discriminated-union'
      discriminant: string
      variants: Record<string, Record<string, MsgField>>
    }

/**
 * Rich per-field descriptor. Emitted only when there's something
 * beyond the bare type to communicate — optionality, an explicit
 * priority hint, or a freeform agent hint. When everything but `type`
 * is unset, the producer emits the bare `MsgFieldType` instead so
 * variants without annotations stay byte-cheap in the bundle.
 */
export interface MsgFieldRich {
  type: MsgFieldType
  /** Mirrors TypeScript's `?:` optional marker. Required fields omit this. */
  optional?: boolean
  /**
   * Strength signal for optional fields. Borrows RFC 2119's `SHOULD`:
   * the LLM ought to fill it in unless it has a specific reason not
   * to. Required fields don't carry a priority — TS already conveys
   * "must" via the type system. Currently the only level; future
   * extensions could add `'recommended'` or similar.
   */
  priority?: 'should'
  /** Freeform consequence-shaped explanation. Surfaced verbatim to
   *  the LLM at affordance time. */
  hint?: string
}

export type MsgField = MsgFieldType | MsgFieldRich

export interface MsgSchema {
  discriminant: string
  variants: Record<string, Record<string, MsgField>>
}

/** True when `f` is a rich descriptor (object with `type` key). */
export function isRichField(f: MsgField): f is MsgFieldRich {
  return typeof f === 'object' && f !== null && !Array.isArray(f) && 'type' in f
}

/** Extracts the bare type from either descriptor form. */
export function fieldType(f: MsgField): MsgFieldType {
  return isRichField(f) ? f.type : f
}

export function extractMsgSchema(source: string, typeName: string = 'Msg'): MsgSchema | null {
  return extractDiscriminatedUnionSchema(source, typeName)
}

export function extractEffectSchema(source: string, typeName: string = 'Effect'): MsgSchema | null {
  return extractDiscriminatedUnionSchema(source, typeName)
}

function extractDiscriminatedUnionSchema(source: string, typeName: string): MsgSchema | null {
  const sf = ts.createSourceFile('input.ts', source, ts.ScriptTarget.Latest, true)
  const typeIndex = buildTypeIndex(sf)

  for (const stmt of sf.statements) {
    if (!ts.isTypeAliasDeclaration(stmt)) continue
    if (stmt.name.text !== typeName) continue

    const variants: MsgSchema['variants'] = {}
    collectVariants(stmt.type, variants, source, typeIndex)

    if (Object.keys(variants).length === 0) return null

    return { discriminant: 'type', variants }
  }

  return null
}

/**
 * Index of type aliases and interfaces visible from a source file,
 * keyed by name. Lets the field-type resolver follow `Criterion[]` →
 * `interface Criterion { … }` and emit a nested object shape rather
 * than `'unknown'`.
 *
 * The cross-file resolver pipeline (`cross-file-resolver.ts`) builds
 * an enriched index that includes types imported from sibling files —
 * follow `GridSorting` → `'rank' | 'crit-X' | 'crit-Y'` → `{enum: […]}`
 * even when the alias lives in `./state.ts` not the Msg-defining file.
 */
export type TypeIndex = Map<string, ts.TypeNode | ts.InterfaceDeclaration>

function buildTypeIndex(sf: ts.SourceFile): TypeIndex {
  const index: TypeIndex = new Map()
  for (const stmt of sf.statements) {
    if (ts.isTypeAliasDeclaration(stmt)) {
      index.set(stmt.name.text, stmt.type)
    } else if (ts.isInterfaceDeclaration(stmt)) {
      index.set(stmt.name.text, stmt)
    }
  }
  return index
}

function collectVariants(
  type: ts.TypeNode,
  variants: MsgSchema['variants'],
  source: string,
  typeIndex: TypeIndex,
): void {
  if (ts.isUnionTypeNode(type)) {
    for (const member of type.types) {
      collectVariants(member, variants, source, typeIndex)
    }
    return
  }

  if (ts.isTypeLiteralNode(type)) {
    let discriminantValue: string | null = null
    const fields: Record<string, MsgField> = {}

    for (const member of type.members) {
      if (!ts.isPropertySignature(member) || !member.name || !ts.isIdentifier(member.name)) continue

      const name = member.name.text
      const memberType = member.type

      if (name === 'type' && memberType) {
        // Extract the discriminant value
        if (ts.isLiteralTypeNode(memberType) && ts.isStringLiteral(memberType.literal)) {
          discriminantValue = memberType.literal.text
        }
        continue
      }

      fields[name] = buildFieldDescriptor(member, source, typeIndex)
    }

    if (discriminantValue) {
      variants[discriminantValue] = fields
    }
  }
}

/**
 * Build a single field descriptor from a property signature: type,
 * optionality, and any `@should("…")` JSDoc hint. Emits the compact
 * bare form when there's nothing extra to communicate; otherwise the
 * rich `{type, optional?, priority?, hint?}` shape.
 *
 * Exported so the cross-file resolver (which walks the same property
 * signatures when the Msg type lives in a different file from the
 * `component()` call) can produce identical descriptors. Without
 * sharing this helper, JSDoc hints would silently disappear whenever
 * a Msg union got resolved across module boundaries.
 */
export function buildFieldDescriptor(
  member: ts.PropertySignature,
  source: string,
  typeIndex: TypeIndex = new Map(),
): MsgField {
  const baseType: MsgFieldType = member.type
    ? resolveFieldType(member.type, typeIndex, MAX_FIELD_DEPTH)
    : 'unknown'
  const optional = member.questionToken !== undefined
  const jsdoc = readMemberJSDoc(source, member)
  const hint = readShouldHint(jsdoc)

  if (!optional && hint === null) {
    return baseType
  }
  const rich: MsgFieldRich = { type: baseType }
  if (optional) rich.optional = true
  if (hint !== null) {
    rich.priority = 'should'
    rich.hint = hint
  }
  return rich
}

/**
 * Recursion bound for nested type resolution. Stops the extractor
 * before it spirals on self-referential or mutually-recursive types
 * (`type Tree = { children: Tree[] }`). At depth 0 every reference
 * collapses to `'unknown'`; the synthesizer emits `null` and the
 * agent falls back to free-form filling.
 *
 * 5 covers the realistic ceiling for production Msg payloads —
 * `Matrix/AddCriteria.criteria[].format.kind` lives at depth 4, and
 * adding one buffer level catches common app shapes. Higher depths
 * grow the bundle linearly; recursive cycles still terminate via the
 * decrement-and-bail rule on every recurse.
 */
const MAX_FIELD_DEPTH = 5

/**
 * Detect literal-only unions whose members all share one primitive
 * type — `'a' | 'b' | 'c'`, `1 | 2 | 3`, or `true | false`. Returns
 * the enum descriptor on success; null if any member isn't a literal
 * of the same type as the others.
 *
 * Mixed-type unions (`'a' | 1`) and unions that include non-literal
 * members fall through. The agent gets `'unknown'` for those rather
 * than an enum that loses the type information mid-list.
 */
function tryExtractLiteralUnion(
  union: ts.UnionTypeNode,
): { enum: Array<string | number | boolean> } | null {
  const values: Array<string | number | boolean> = []
  let kind: 'string' | 'number' | 'boolean' | null = null

  for (const member of union.types) {
    if (!ts.isLiteralTypeNode(member)) return null
    const lit = member.literal
    if (ts.isStringLiteral(lit)) {
      if (kind === null) kind = 'string'
      else if (kind !== 'string') return null
      values.push(lit.text)
    } else if (ts.isNumericLiteral(lit)) {
      if (kind === null) kind = 'number'
      else if (kind !== 'number') return null
      const n = Number(lit.text)
      if (!Number.isFinite(n)) return null
      values.push(n)
    } else if (lit.kind === ts.SyntaxKind.TrueKeyword) {
      if (kind === null) kind = 'boolean'
      else if (kind !== 'boolean') return null
      values.push(true)
    } else if (lit.kind === ts.SyntaxKind.FalseKeyword) {
      if (kind === null) kind = 'boolean'
      else if (kind !== 'boolean') return null
      values.push(false)
    } else {
      return null
    }
  }

  if (values.length === 0) return null
  return { enum: values }
}

/**
 * Detect a discriminated union of object types — every member is an
 * object literal (or named type alias resolving to one) and every
 * member declares the same property as a string-literal type with a
 * value distinct from every other member's. Examples:
 *
 *   {kind:'a'} | {kind:'b', x:number}        → discriminant 'kind'
 *   {tag:'x',v:1} | {tag:'y',v:'s'}          → discriminant 'tag'
 *
 * Returns the union descriptor on success; null on any failure
 * (different shape per branch, no shared discriminant key, non-literal
 * discriminant value, primitive member, etc.). Bailing to null lets
 * the caller emit `'unknown'` rather than a partially-valid descriptor.
 *
 * `depth` is the budget for resolving each branch's payload. The
 * caller subtracts one before calling, since detecting the union
 * itself doesn't consume budget — recursing into branches does.
 */
function tryExtractDiscriminatedUnion(
  union: ts.UnionTypeNode,
  typeIndex: TypeIndex,
  depth: number,
): {
  kind: 'discriminated-union'
  discriminant: string
  variants: Record<string, Record<string, MsgField>>
} | null {
  // Resolve each branch to its underlying object literal node, chasing
  // through type-alias references in the local index. Returns null if
  // any branch isn't an object-literal-shaped type.
  const branches: ts.TypeLiteralNode[] = []
  for (const member of union.types) {
    const lit = resolveToTypeLiteral(member, typeIndex)
    if (lit === null) return null
    branches.push(lit)
  }
  if (branches.length === 0) return null

  // Find a property name that EVERY branch declares with a string-
  // literal value, and where the values are pairwise distinct.
  // Iterate over the first branch's properties; for each candidate
  // name, check the rest.
  const first = branches[0]
  if (!first) return null
  let discriminant: string | null = null
  let firstBranchValue: string | null = null
  for (const member of first.members) {
    if (!ts.isPropertySignature(member) || !member.name || !ts.isIdentifier(member.name)) continue
    if (!member.type) continue
    if (!ts.isLiteralTypeNode(member.type) || !ts.isStringLiteral(member.type.literal)) continue
    const candidate = member.name.text

    const valuesByBranch: string[] = [member.type.literal.text]
    let ok = true
    for (let i = 1; i < branches.length; i++) {
      const branch = branches[i]
      if (!branch) {
        ok = false
        break
      }
      const otherValue = literalDiscriminantValue(branch, candidate)
      if (otherValue === null) {
        ok = false
        break
      }
      valuesByBranch.push(otherValue)
    }
    if (!ok) continue

    // All distinct?
    const uniq = new Set(valuesByBranch)
    if (uniq.size !== valuesByBranch.length) continue

    discriminant = candidate
    firstBranchValue = member.type.literal.text
    break
  }

  if (discriminant === null || firstBranchValue === null) return null

  // Build the variant payload map. Each variant's payload is the
  // branch's properties EXCEPT the discriminant itself (which the
  // synthesizer re-adds at example time, like the top-level Msg `type`).
  const variants: Record<string, Record<string, MsgField>> = {}
  for (const branch of branches) {
    const value = literalDiscriminantValue(branch, discriminant)
    if (value === null) return null
    const fields: Record<string, MsgField> = {}
    for (const member of branch.members) {
      if (!ts.isPropertySignature(member) || !member.name || !ts.isIdentifier(member.name)) continue
      const name = member.name.text
      if (name === discriminant) continue
      const baseType: MsgFieldType = member.type
        ? resolveFieldType(member.type, typeIndex, depth)
        : 'unknown'
      const optional = member.questionToken !== undefined
      fields[name] = optional ? { type: baseType, optional: true } : baseType
    }
    variants[value] = fields
  }

  return { kind: 'discriminated-union', discriminant, variants }
}

/**
 * Resolve a type node down to an inline object-literal type node,
 * following one level of named-reference indirection through the local
 * index. Returns null when the type isn't (or can't be reduced to) an
 * object literal. We only chase one hop because every additional hop
 * needs a depth budget to terminate, and discriminated-union detection
 * is bounded by the outer caller's budget already.
 */
function resolveToTypeLiteral(t: ts.TypeNode, typeIndex: TypeIndex): ts.TypeLiteralNode | null {
  if (ts.isTypeLiteralNode(t)) return t
  if (ts.isTypeReferenceNode(t) && ts.isIdentifier(t.typeName)) {
    const target = typeIndex.get(t.typeName.text)
    if (!target) return null
    if (ts.isInterfaceDeclaration(target)) {
      // Synthesize a TypeLiteralNode-like shape from the interface
      // members. Cheaper than reconstructing the AST: we only need
      // the members to drive collectInlineShape semantics, but the
      // discriminated-union detector reads property signatures, which
      // interfaces have directly. We shim via a property-list view.
      return interfaceToTypeLiteralLike(target)
    }
    if (ts.isTypeNode(target)) {
      // Type alias: recurse one level.
      return resolveToTypeLiteral(target, typeIndex)
    }
  }
  return null
}

/**
 * Adapter for interface declarations: discriminated-union detection
 * and field iteration only need the members list, which both
 * `TypeLiteralNode` and `InterfaceDeclaration` expose. We return the
 * interface cast as a TypeLiteralNode-shaped object so the rest of
 * this file's helpers (which check `ts.isPropertySignature(member)`)
 * work uniformly across both node kinds.
 */
function interfaceToTypeLiteralLike(iface: ts.InterfaceDeclaration): ts.TypeLiteralNode {
  return { members: iface.members } as unknown as ts.TypeLiteralNode
}

/**
 * Read a string-literal property value from an object-literal-like
 * member list, or null if the named property isn't present, isn't a
 * property signature, or isn't typed as a string literal.
 */
function literalDiscriminantValue(lit: ts.TypeLiteralNode, name: string): string | null {
  for (const member of lit.members) {
    if (!ts.isPropertySignature(member) || !member.name || !ts.isIdentifier(member.name)) continue
    if (member.name.text !== name) continue
    if (!member.type) return null
    if (ts.isLiteralTypeNode(member.type) && ts.isStringLiteral(member.type.literal)) {
      return member.type.literal.text
    }
    return null
  }
  return null
}

export function resolveFieldType(
  type: ts.TypeNode,
  typeIndex: TypeIndex = new Map(),
  depth = MAX_FIELD_DEPTH,
): MsgFieldType {
  // Primitive keywords
  if (type.kind === ts.SyntaxKind.StringKeyword) return 'string'
  if (type.kind === ts.SyntaxKind.NumberKeyword) return 'number'
  if (type.kind === ts.SyntaxKind.BooleanKeyword) return 'boolean'

  // Standalone literal type — `flag: true` or `value: 5`. Single-value
  // enum so the schema records the constant rather than collapsing it
  // to 'unknown'. Useful for sentinel discriminants outside discriminated
  // unions (e.g. `kind: 'always-this-one'` on a non-union type).
  if (ts.isLiteralTypeNode(type)) {
    const lit = type.literal
    if (ts.isStringLiteral(lit)) return { enum: [lit.text] }
    if (ts.isNumericLiteral(lit)) {
      const n = Number(lit.text)
      return Number.isFinite(n) ? { enum: [n] } : 'unknown'
    }
    if (lit.kind === ts.SyntaxKind.TrueKeyword) return { enum: [true] }
    if (lit.kind === ts.SyntaxKind.FalseKeyword) return { enum: [false] }
  }

  // Union of literals — 'a' | 'b' (strings), 1 | 2 | 3 (numbers), or
  // true / false (booleans). Mixed-type unions ('a' | 1) bail to
  // 'unknown' — the LLM can't reason about that shape from the schema
  // alone, so we'd rather not emit a misleading enum than enumerate
  // the values without their types.
  if (ts.isUnionTypeNode(type)) {
    const enumResult = tryExtractLiteralUnion(type)
    if (enumResult !== null) return enumResult

    // Discriminated union of object literals — depth-budgeted because
    // each branch may contain its own nested shapes.
    if (depth > 0) {
      const discResult = tryExtractDiscriminatedUnion(type, typeIndex, depth - 1)
      if (discResult !== null) return discResult
    }
  }

  // Below this point, all branches need depth budget. Bail out cheaply.
  if (depth <= 0) return 'unknown'

  // Inline object literal — `{a: number; b: string}` directly.
  if (ts.isTypeLiteralNode(type)) {
    return { kind: 'object', shape: collectInlineShape(type, typeIndex, depth - 1) }
  }

  // Array type — `T[]` and `readonly T[]`.
  if (ts.isArrayTypeNode(type)) {
    return { kind: 'array', element: resolveFieldType(type.elementType, typeIndex, depth - 1) }
  }
  // Generic Array<T> (less common in app code but compiler may produce it).
  if (
    ts.isTypeReferenceNode(type) &&
    ts.isIdentifier(type.typeName) &&
    type.typeName.text === 'Array' &&
    type.typeArguments?.length === 1 &&
    type.typeArguments[0]
  ) {
    return {
      kind: 'array',
      element: resolveFieldType(type.typeArguments[0], typeIndex, depth - 1),
    }
  }
  // ReadonlyArray<T> → same shape; the readonly modifier is purely a
  // TypeScript-side concern that the agent never observes at runtime.
  if (
    ts.isTypeReferenceNode(type) &&
    ts.isIdentifier(type.typeName) &&
    type.typeName.text === 'ReadonlyArray' &&
    type.typeArguments?.length === 1 &&
    type.typeArguments[0]
  ) {
    return {
      kind: 'array',
      element: resolveFieldType(type.typeArguments[0], typeIndex, depth - 1),
    }
  }
  // `readonly T[]` parses as TypeOperator(readonly) wrapping ArrayType.
  if (ts.isTypeOperatorNode(type) && type.operator === ts.SyntaxKind.ReadonlyKeyword) {
    return resolveFieldType(type.type, typeIndex, depth)
  }

  // Named type reference — chase it through the local index.
  if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) {
    const target = typeIndex.get(type.typeName.text)
    if (target) {
      if (ts.isInterfaceDeclaration(target)) {
        return {
          kind: 'object',
          shape: collectInterfaceShape(target, typeIndex, depth - 1),
        }
      }
      // Type alias — recurse on its body. `type Foo = …` could resolve
      // to anything (object literal, array, union, primitive); each
      // already has its own branch above.
      return resolveFieldType(target, typeIndex, depth - 1)
    }
    // Reference to a type the index doesn't know about — typically
    // imported from another module. Cross-file resolution is the
    // separate cross-file-resolver pipeline's job; leave this as
    // unknown rather than fabricating a misleading shape.
    return 'unknown'
  }

  return 'unknown'
}

function collectInlineShape(
  lit: ts.TypeLiteralNode,
  typeIndex: TypeIndex,
  depth: number,
): Record<string, MsgField> {
  const shape: Record<string, MsgField> = {}
  for (const member of lit.members) {
    if (!ts.isPropertySignature(member) || !member.name || !ts.isIdentifier(member.name)) continue
    const name = member.name.text
    const baseType: MsgFieldType = member.type
      ? resolveFieldType(member.type, typeIndex, depth)
      : 'unknown'
    const optional = member.questionToken !== undefined
    if (!optional) {
      shape[name] = baseType
    } else {
      shape[name] = { type: baseType, optional: true }
    }
  }
  return shape
}

function collectInterfaceShape(
  iface: ts.InterfaceDeclaration,
  typeIndex: TypeIndex,
  depth: number,
): Record<string, MsgField> {
  const shape: Record<string, MsgField> = {}
  for (const member of iface.members) {
    if (!ts.isPropertySignature(member) || !member.name || !ts.isIdentifier(member.name)) continue
    const name = member.name.text
    const baseType: MsgFieldType = member.type
      ? resolveFieldType(member.type, typeIndex, depth)
      : 'unknown'
    const optional = member.questionToken !== undefined
    if (!optional) {
      shape[name] = baseType
    } else {
      shape[name] = { type: baseType, optional: true }
    }
  }
  return shape
}

/**
 * Read the leading JSDoc block immediately above `member`. The
 * TypeScript parser doesn't attach JSDoc to interior property
 * signatures, so we re-scan the source between the previous member's
 * end (or the type-literal's `{`) and this member's start, and return
 * the last `/** … *\/` block found there. Returns `''` when none.
 */
function readMemberJSDoc(source: string, member: ts.PropertySignature): string {
  const ranges = ts.getLeadingCommentRanges(source, member.pos) ?? []
  // Walk in order, keeping only `/** */` blocks. Multiple back-to-back
  // JSDocs concatenate (matches msg-annotations.ts's existing behavior).
  const docs = ranges
    .filter((r) => r.kind === ts.SyntaxKind.MultiLineCommentTrivia)
    .map((r) => source.slice(r.pos, r.end))
    .filter((txt) => txt.startsWith('/**'))
  return docs.join('\n')
}

/**
 * Match `@should("…")` (and curly-quote variant) anywhere in the
 * JSDoc. Mirrors msg-annotations.ts's `@intent` parser — same grammar,
 * same tolerance for either ASCII or curly quotes.
 *
 * Returns the unescaped string content, or null when the tag is
 * absent or malformed.
 */
function readShouldHint(comment: string): string | null {
  if (!comment) return null
  const match = comment.match(/@should\s*\(\s*["“]([^"”]*)["”]\s*\)/)
  return match?.[1] ?? null
}
