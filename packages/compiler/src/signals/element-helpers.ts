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
  'svg',
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
])
