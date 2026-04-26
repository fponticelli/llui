import ts from 'typescript'

/**
 * The "bare type" of a field. Covers four cases:
 *   - primitive keyword as a string: `'string'`, `'number'`, `'boolean'`, `'unknown'`
 *   - string-literal union: `{enum: ['a', 'b']}`
 *   - nested object shape: `{kind: 'object', shape: {...}}` — emitted when
 *     a field's type is a local interface/type alias the extractor could
 *     follow (depth-limited; cross-file references stay `'unknown'`).
 *   - array of element type: `{kind: 'array', element: <bare type>}`.
 *
 * The synthesizer in `@llui/agent`'s `list_actions` walks these to build
 * copy-paste-ready payload examples; the validator in `send_message`
 * walks them too (treating object/array as "any" since deep validation
 * is the reducer's job).
 */
export type MsgFieldType =
  | string
  | { enum: string[] }
  | { kind: 'object'; shape: Record<string, MsgField> }
  | { kind: 'array'; element: MsgFieldType }

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
 * 3 covers the common cases (Msg payload → Criterion → ValueMeta),
 * keeps the bundle bounded, and is well under the Tarjan-style
 * depths needed for actual recursive types.
 */
const MAX_FIELD_DEPTH = 3

export function resolveFieldType(
  type: ts.TypeNode,
  typeIndex: TypeIndex = new Map(),
  depth = MAX_FIELD_DEPTH,
): MsgFieldType {
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
