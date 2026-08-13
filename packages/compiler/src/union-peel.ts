import ts from 'typescript'

/**
 * Shared union pre-processing for the two schema extractors
 * (`msg-schema.ts` and `state-schema.ts`).
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

/** Result of peeling a set of branches off a union type node. */
export interface PeeledUnion {
  /**
   * The union with the peeled branches removed: the sole survivor when one
   * branch is left, a rebuilt union node when several are, or the ORIGINAL
   * node untouched when nothing was peeled (or when peeling would leave
   * nothing behind).
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
  if (!ts.isUnionTypeNode(type)) return { type, peeled: false }
  const remainder = type.types.filter((t) => !matches(t))
  if (remainder.length === type.types.length) return { type, peeled: false }
  if (remainder.length === 0) return { type, peeled: false }
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
