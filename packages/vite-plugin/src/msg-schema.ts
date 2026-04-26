import ts from 'typescript'

/** The bare type form — "string", "number", "unknown", or an enum. */
export type MsgFieldType = string | { enum: string[] }

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

  for (const stmt of sf.statements) {
    if (!ts.isTypeAliasDeclaration(stmt)) continue
    if (stmt.name.text !== typeName) continue

    const variants: MsgSchema['variants'] = {}
    collectVariants(stmt.type, variants, source)

    if (Object.keys(variants).length === 0) return null

    return { discriminant: 'type', variants }
  }

  return null
}

function collectVariants(
  type: ts.TypeNode,
  variants: MsgSchema['variants'],
  source: string,
): void {
  if (ts.isUnionTypeNode(type)) {
    for (const member of type.types) {
      collectVariants(member, variants, source)
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

      const baseType: MsgFieldType = memberType ? resolveFieldType(memberType) : 'unknown'
      const optional = member.questionToken !== undefined
      const jsdoc = readMemberJSDoc(source, member)
      const hint = readShouldHint(jsdoc)

      // Emit bare form when there's nothing to add — saves bytes on
      // the typical case where most fields are required and unannotated.
      if (!optional && hint === null) {
        fields[name] = baseType
      } else {
        const rich: MsgFieldRich = { type: baseType }
        if (optional) rich.optional = true
        if (hint !== null) {
          rich.priority = 'should'
          rich.hint = hint
        }
        fields[name] = rich
      }
    }

    if (discriminantValue) {
      variants[discriminantValue] = fields
    }
  }
}

export function resolveFieldType(type: ts.TypeNode): MsgFieldType {
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
