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
