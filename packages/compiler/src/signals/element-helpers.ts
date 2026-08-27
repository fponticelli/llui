// Shared element-helper constants.
//
// The single source of truth for which callee names are DOM element helpers
// (`div`, `span`, `strong`, `tbody`, …). Both the view transform (which lowers
// `tag(props, children)` to `el('tag', …)`) and the lint rules (no-node-
// construction, controlled-input, a11y) key off this set. It previously lived
// duplicated in transform-view.ts and rules.ts, and the two copies DRIFTED —
// rules' copy was missing `strong`/`tbody`/`em`/… so those calls escaped the
// lint. Keep this list in sync with `@llui/dom`'s element helpers; the compiler
// intentionally has no `@llui/dom` dependency, so the set is mirrored here.
//
// NAMESPACED helpers (`svg`, `path`, `circle`, …) are DELIBERATELY excluded
// from `ELEMENT_HELPERS`: the runtime builds them via `createElementNS` (SVG
// namespace), whereas lowering to `el('svg', …)` / `createElement('svg')`
// produces a non-namespaced HTMLUnknownElement that renders nothing. They must
// route through the runtime authoring helper verbatim, so they are NOT element
// helpers there. They ARE listed separately as `SVG_ELEMENT_HELPERS`: they take
// the exact same call forms, so a rule that only inspects a call's ARGUMENTS
// (never lowers it) must cover them too — see `ALL_ELEMENT_HELPERS`.
//
// `packages/dom/test/signals/element-helper-parity.test.ts` derives both sets
// from `@llui/dom`'s `authoring.ts` by AST walk and fails on any drift, so
// neither list can silently fall behind the runtime. That gate lives on the
// RUNTIME side because `authoring.ts` is an input of `@llui/dom#test` but of no
// task in this package — a copy here would replay from Turbo's cache while the
// runtime drifted. Do not move it here.

/** DOM element-helper callee names — tags that produce an element with props. */
export const ELEMENT_HELPERS: ReadonlySet<string> = new Set([
  'div',
  'span',
  'p',
  'a',
  'button',
  'input',
  'label',
  'form',
  'ul',
  'ol',
  'li',
  'section',
  'header',
  'footer',
  'nav',
  'main',
  'article',
  'aside',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'img',
  'table',
  'thead',
  'tbody',
  'tr',
  'td',
  'th',
  'select',
  'option',
  'textarea',
  'pre',
  'code',
  'small',
  'strong',
  'em',
  'i',
  'b',
  'figure',
  'figcaption',
  'canvas',
  'video',
  'audio',
  'details',
  'summary',
  'dialog',
  'fieldset',
  'legend',
  'blockquote',
  'hr',
  'br',
  'optgroup',
  'dl',
  'dt',
  'dd',
  'caption',
  'time',
])

/**
 * SVG element-helper callee names (the `svgHelper(...)` exports of `@llui/dom`).
 *
 * These are EXPORT names, not tags — the SVG `<text>` helper is exported as
 * `svgText` so it doesn't collide with the `text()` node helper. Kept out of
 * {@link ELEMENT_HELPERS} because the view transform must NOT lower them
 * (createElementNS), but they accept the identical `(children)` /
 * `(props?, children?)` call forms, so argument-shape rules apply unchanged.
 */
export const SVG_ELEMENT_HELPERS: ReadonlySet<string> = new Set([
  'svg',
  'path',
  'g',
  'circle',
  'rect',
  'line',
  'polyline',
  'polygon',
  'ellipse',
  'svgText',
  'svgTitle',
  'svgDesc',
])

/**
 * Every element-helper callee name — namespaced and not. Use this ONLY for
 * rules that inspect a call's arguments; never for lowering (see the note on
 * `SVG_ELEMENT_HELPERS` above: lowering a namespaced helper breaks it).
 */
export const ALL_ELEMENT_HELPERS: ReadonlySet<string> = new Set([
  ...ELEMENT_HELPERS,
  ...SVG_ELEMENT_HELPERS,
])
