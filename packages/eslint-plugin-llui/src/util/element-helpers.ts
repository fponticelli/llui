/**
 * Element-helper identifiers exposed by `@llui/dom`. Mirrored from the
 * compiler's `ELEMENT_HELPERS` set so the lint rules see the same
 * surface the runtime does — when an authoring helper is added in
 * `@llui/dom`, it must be added here too.
 *
 * Several rules need to recognise an element-helper call shape
 * (`div(props, children)` vs. `div(children)`); centralising the set
 * keeps every rule's allowlist in lockstep.
 */
export const ELEMENT_HELPERS = new Set([
  'a',
  'abbr',
  'article',
  'aside',
  'b',
  'blockquote',
  'br',
  'button',
  'canvas',
  'code',
  'dd',
  'details',
  'dialog',
  'div',
  'dl',
  'dt',
  'em',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'i',
  'iframe',
  'img',
  'input',
  'label',
  'legend',
  'li',
  'main',
  'mark',
  'nav',
  'ol',
  'optgroup',
  'option',
  'output',
  'p',
  'pre',
  'progress',
  'section',
  'select',
  'small',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'textarea',
  'tfoot',
  'th',
  'thead',
  'time',
  'tr',
  'ul',
  'video',
])

/**
 * Subset of element helpers that are interactive by default — i.e.,
 * receive keyboard focus and dispatch click events without ARIA help.
 * The accessibility rule uses this to scope the `onClick on
 * non-interactive` warning.
 */
export const INTERACTIVE_ELEMENTS = new Set([
  'button',
  'a',
  'input',
  'select',
  'textarea',
  'details',
  'summary',
])
