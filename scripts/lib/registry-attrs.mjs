// Cross-check the STATE ATTRIBUTES a registry recipe styles against the ones
// its headless machine actually publishes.
//
// This exists because that mismatch is the registry's most expensive bug class
// and NOTHING else catches it. Four shipped at once and every check stayed
// green, because a class naming an attribute nobody emits is perfectly valid
// CSS: `scroll-area` styled `data-[orientation=…]` while the machine publishes
// `data-axis` (the thumb rendered at ZERO pixels); `carousel`'s indicator used
// `data-[state=active]` against a bare `data-active` (the current dot never
// highlighted); `calendar` used react-day-picker's `data-[state=…]` throughout
// (no today marker, no selection fill, no range, no focus ring on any day); and
// `resizable` bound `aria-[orientation=…]` alongside `data-[orientation=…]`,
// which for this machine mean OPPOSITE axes. Only a render showed any of them.
//
// It is deliberately a ONE-DIRECTION check — a recipe naming an attribute the
// machine never emits — because that direction is always a bug. The reverse (a
// machine publishing an attribute nothing styles) is normal and desirable: a
// part bag is a public surface, and most consumers style a fraction of it.
import ts from 'typescript'

/** `data-[foo=bar]:x` / `data-foo:x` / `not-data-foo:x` / `group-data-foo/n:x` /
 *  `aria-[foo=bar]:x` / `aria-foo:x` / `peer-data-[foo]:x` — every spelling
 *  Tailwind offers for an attribute variant. Returns bare attribute names. */
export function attrsInCandidate(candidate) {
  const out = new Set()
  // Bracketed form: data-[state=open], group-data-[collapsible=icon]/x, aria-[orientation=vertical]
  for (const m of candidate.matchAll(
    /(?:^|:)(?:not-|group-|peer-)*((?:data|aria)-)\[([a-zA-Z0-9-]+)/g,
  )) {
    out.add(m[1] + m[2])
  }
  // Bare form: data-active:, not-data-in-month:, group-data-focused/day:
  for (const m of candidate.matchAll(
    /(?:^|:)(?:not-|group-|peer-)*((?:data|aria)-[a-zA-Z0-9-]+?)(?:\/[a-zA-Z0-9-]+)?:/g,
  )) {
    // Skip the bracketed form, already handled (its next char is `[`).
    if (!m[0].includes('[')) out.add(m[1])
  }
  return [...out]
}

/**
 * Every `'data-*'` / `'aria-*'` key a module's exported `*Parts` interfaces
 * declare. Read from the TYPE, not the implementation: the interface is the
 * published contract, and a key present in one but not the other is its own bug
 * the package's own type-check already catches.
 */
export function publishedAttrs(fileName, source) {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const out = new Set()
  const walk = (node) => {
    if (ts.isPropertySignature(node) && node.name !== undefined) {
      const name = ts.isStringLiteral(node.name)
        ? node.name.text
        : ts.isIdentifier(node.name)
          ? node.name.text
          : null
      if (name !== null && (name.startsWith('data-') || name.startsWith('aria-'))) out.add(name)
    }
    ts.forEachChild(node, walk)
  }
  walk(sf)
  return out
}

// ── Value-level cross-check ────────────────────────────────────────────────
//
// The name-level check above cannot see the second half of this bug class: a
// recipe that names the RIGHT attribute and the WRONG value. Every boolean
// `data-*` in `@llui/components` is published BARE (`'' | undefined`) — the
// package-wide convention — while shadcn writes `data-invalid="true"` /
// `data-disabled="true"`. `data-[invalid=true]:text-destructive` therefore
// matches nothing a part bag ever produces, and it shipped that way in
// `field.ts` on all three of its rules: the `Field` root's destructive text and
// both `group-data-[disabled=true]/field:opacity-50`. Name-level, they were
// perfect. A render is the only other thing that shows it.

/** `data-[foo=bar]` pairs a candidate styles, as `"data-foo=bar"`. The bare
 *  spelling (`data-foo:`) carries no value and is not reported here. */
export function attrValuePairsInCandidate(candidate) {
  const out = new Set()
  // Unanchored on purpose: `data-[x=y]` cannot occur inside a longer token, and
  // every variant prefix Tailwind allows (`not-`, `group-`, `peer-`, a `/name`
  // suffix) sits OUTSIDE the bracket. Anchoring on `^|:` is what an earlier cut
  // did, and it matched nothing at all — `group-data-[…]` has no colon before
  // the attribute and the `[` is not a name character.
  for (const m of candidate.matchAll(/((?:data|aria)-)\[([a-zA-Z0-9-]+)=([a-zA-Z0-9-]+)\]/g)) {
    out.add(`${m[1]}${m[2]}=${m[3]}`)
  }
  return [...out]
}

/** Attributes a candidate styles in the BARE spelling only (`data-foo:x`,
 *  `group-data-foo/n:x`) — i.e. "present at all", with no value asserted. This
 *  is what a value-level parity allowance must be paired with: the bracketed
 *  form contributes the same attribute NAME, so pairing against names alone
 *  would be satisfied by the dead spelling itself. */
export function bareAttrsInCandidate(candidate) {
  const out = new Set()
  for (const m of candidate.matchAll(
    /(?:^|:)(?:not-|group-|peer-)*((?:data|aria)-[a-zA-Z0-9-]+?)(?:\/[a-zA-Z0-9-]+)?:/g,
  )) {
    if (!m[0].includes('[')) out.add(m[1])
  }
  return [...out]
}

/** Unwrap `Signal<X>` / `Reactive<X>` to X; anything else is returned as-is. */
function unwrapReactive(typeNode) {
  if (
    ts.isTypeReferenceNode(typeNode) &&
    ts.isIdentifier(typeNode.typeName) &&
    (typeNode.typeName.text === 'Signal' || typeNode.typeName.text === 'Reactive') &&
    typeNode.typeArguments?.length === 1
  ) {
    return typeNode.typeArguments[0]
  }
  return typeNode
}

/**
 * The literal string values a type can hold, or `null` when the type is OPEN
 * (a `string`, an imported alias, a template literal — anything whose members
 * this syntax-only read cannot enumerate). `null` means "no verdict": the check
 * stays silent rather than guessing, in keeping with the one-direction rule.
 */
function literalValues(typeNode) {
  const inner = unwrapReactive(typeNode)
  const members = ts.isUnionTypeNode(inner) ? inner.types : [inner]
  const out = new Set()
  for (const m of members) {
    if (ts.isLiteralTypeNode(m)) {
      const lit = m.literal
      if (ts.isStringLiteral(lit)) {
        out.add(lit.text)
        continue
      }
      // `null` and `undefined` mean ABSENT, which no `[attr=value]` can select.
      if (lit.kind === ts.SyntaxKind.NullKeyword) continue
      return null
    }
    if (m.kind === ts.SyntaxKind.UndefinedKeyword) continue
    return null
  }
  return out
}

/**
 * Every `'data-*'` / `'aria-*'` key a module's exported `*Parts` interfaces
 * declare, mapped to the literal values it can hold (`null` = open type).
 * A key declared more than once unions its value sets, and one OPEN declaration
 * opens the attribute everywhere in the module.
 */
export function publishedAttrValues(fileName, source) {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const out = new Map()
  const walk = (node) => {
    if (ts.isPropertySignature(node) && node.name !== undefined && node.type !== undefined) {
      const name = ts.isStringLiteral(node.name)
        ? node.name.text
        : ts.isIdentifier(node.name)
          ? node.name.text
          : null
      if (name !== null && (name.startsWith('data-') || name.startsWith('aria-'))) {
        const values = literalValues(node.type)
        if (out.has(name)) {
          const prev = out.get(name)
          if (prev === null || values === null) out.set(name, null)
          else for (const v of values) prev.add(v)
        } else {
          out.set(name, values === null ? null : new Set(values))
        }
      }
    }
    ts.forEachChild(node, walk)
  }
  walk(sf)
  return out
}
