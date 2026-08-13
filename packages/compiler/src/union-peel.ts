import ts from 'typescript'

/**
 * Shared type-node pre-processing for the two schema extractors
 * (`msg-schema.ts` and `state-schema.ts`) — the parenthesis unwrap and the
 * `undefined`/`null` union peels.
 *
 * Both walk TypeScript type nodes and both must strip `undefined` off a
 * union BEFORE classifying what is left, or the classification trips over
 * the `undefined` member: a literal-union scan sees a non-literal branch,
 * a discriminated-union scan sees a non-object branch, and the whole field
 * collapses to `unknown` — losing the enum values AND the optionality that
 * `| undefined` was there to express (issue #88, which was exactly this
 * peel missing on the state side).
 *
 * The peel lives here rather than in either extractor because the two ABIs
 * ({@link import('./msg-schema.js').MsgFieldType} and
 * {@link import('./state-schema.js').StateType}) are separate but must agree
 * on WHICH branches are absence and which are values. A second copy of this
 * logic is how the two drifted apart before.
 *
 * `null` is deliberately NOT part of the optional peel — see
 * {@link peelNullUnion}.
 */

/**
 * Strip every layer of `( … )` off a type node.
 *
 * A `ParenthesizedTypeNode` is legal ANYWHERE a type is, and it is not a union,
 * not an array, not a literal — so every `ts.isXTypeNode` test in both
 * resolvers is false for it and the field collapses to `unknown`. That mattered
 * most for array elements: parentheses are the ONLY way to write a union as an
 * element type (`'a' | 'b'[]` parses as `'a' | ('b'[])`, a different type), so
 * before this unwrap EVERY array-of-union field in every consumer's State came
 * out as `{kind: 'array', of: 'unknown'}` and #88's enum/null/optional handling
 * could not reach any of them (issue #96).
 *
 * Because parentheses are legal everywhere, the unwrap belongs at the TOP of
 * each resolver and inside the peels below — an isolated fix at the array arm
 * leaves every sibling position broken, which is how #96 read on `main`.
 */
export function unwrapParenthesizedType(type: ts.TypeNode): ts.TypeNode {
  let t = type
  // `(('a' | 'b'))[]` nests, so loop rather than unwrap once.
  while (ts.isParenthesizedTypeNode(t)) t = t.type
  return t
}

/** Result of peeling a set of branches off a union type node. */
export interface PeeledUnion {
  /**
   * The union with the peeled branches removed: the sole survivor when one
   * branch is left, a rebuilt union node when several are, or the input
   * node — unwrapped of any enclosing parentheses — when nothing was peeled
   * (or when peeling would leave nothing behind).
   */
  type: ts.TypeNode
  /** True when at least one branch was actually peeled off. */
  peeled: boolean
}

/**
 * Remove every branch of `type` matching `matches`, and return the
 * remainder for normal classification.
 *
 * Returns the node unchanged with `peeled: false` when `type` is not a
 * union, when no branch matches, or when EVERY branch matches
 * (pathological — `undefined | undefined`; fabricating a shape out of an
 * empty remainder would be worse than letting the caller fall through to
 * `unknown`).
 */
function peelUnionBranches(type: ts.TypeNode, matches: (t: ts.TypeNode) => boolean): PeeledUnion {
  // The peels run on the field's DECLARED node, BEFORE the resolvers get their
  // own unwrap, so `mode: ('a' | 'b' | undefined)` would otherwise not look
  // like a union at all and the optionality would be lost outright — not
  // merely mis-shaped (#96). Unwrapping each branch too covers the rarer
  // `T | (undefined)` / `T | (null)` spellings.
  const inner = unwrapParenthesizedType(type)
  if (!ts.isUnionTypeNode(inner)) return { type: inner, peeled: false }
  const remainder = inner.types.filter((t) => !matches(unwrapParenthesizedType(t)))
  if (remainder.length === inner.types.length) return { type: inner, peeled: false }
  if (remainder.length === 0) return { type: inner, peeled: false }
  const sole = remainder[0]
  if (remainder.length === 1 && sole) return { type: sole, peeled: true }
  // Rebuild `'a' | 'b' | undefined` as `'a' | 'b'` so the remainder runs
  // through literal-union / discriminated-union detection as if the peeled
  // branch had never been there.
  return { type: ts.factory.createUnionTypeNode(remainder), peeled: true }
}

/**
 * Detect `T | undefined` (or `undefined | T`, or `T1 | T2 | undefined`)
 * and return the union without the `undefined` branch plus a flag marking
 * the field as implicitly optional. Mirrors the runtime semantics:
 * `field: T | undefined` is exactly equivalent to `field?: T` — the value
 * may be ABSENT, and `undefined` does not survive a JSON round-trip.
 *
 * Pre-strict-null codebases declare optional fields as `field: T | undefined`
 * rather than `field?: T`. Without this peel the union matches neither
 * literal-union nor discriminated-union detection, so it collapses to
 * `unknown` and an agent has to spell out `field: undefined` literally on
 * every payload.
 */
export function peelOptionalUnion(type: ts.TypeNode): {
  type: ts.TypeNode
  isImplicitOptional: boolean
} {
  const { type: peeledType, peeled } = peelUnionBranches(
    type,
    (t) => t.kind === ts.SyntaxKind.UndefinedKeyword,
  )
  return { type: peeledType, isImplicitOptional: peeled }
}

/**
 * Detect `T | null` and return the union without the `null` branch plus a
 * nullability flag.
 *
 * `null` is a VALUE, not an absence: it survives JSON (state must be
 * JSON-serializable) and TypeScript keeps `field: T | null` REQUIRED. So a
 * caller must never turn `isNullable` into optionality — it peels `null`
 * only so the remainder can still be classified (`'a' | 'b' | null` really
 * is an enum plus null), and re-attaches nullability alongside that
 * classification.
 *
 * Only `state-schema.ts` consumes this today: `StateType` can express the
 * result (`{kind: 'union', of: [T, 'null']}`), whereas `MsgFieldType` has
 * no null member, so peeling null on the Msg side would silently widen a
 * payload field's declared type. That asymmetry is in the ABIs, not in the
 * peel.
 */
export function peelNullUnion(type: ts.TypeNode): { type: ts.TypeNode; isNullable: boolean } {
  const { type: peeledType, peeled } = peelUnionBranches(type, isNullLiteral)
  return { type: peeledType, isNullable: peeled }
}

/** True for the `null` type node, which TypeScript parses as a literal type
 * wrapping the `null` keyword (unlike `undefined`, which is a keyword type). */
export function isNullLiteral(t: ts.TypeNode): boolean {
  return ts.isLiteralTypeNode(t) && t.literal.kind === ts.SyntaxKind.NullKeyword
}
