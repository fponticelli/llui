/**
 * Markup integrity, measured on the LIVE DOM of a rendered document (#268).
 * Passed to `page.evaluate`, so it may reference only its own body and DOM
 * globals — no imports, no closures.
 *
 * What it reports, one finding per line, each naming the offending node:
 *
 *   - `duplicate-id`       two elements share an `id` (every idref below is
 *                          then ambiguous, and the platform picks the first);
 *   - `broken-idref`       an id-referencing attribute (`aria-labelledby`,
 *                          `aria-describedby`, `aria-controls`,
 *                          `aria-activedescendant`, `aria-owns`,
 *                          `aria-errormessage`, `aria-details`,
 *                          `aria-flowto`, `label[for]`, `headers`,
 *                          `input[list]`, `[form]`, `popovertarget`) names an
 *                          id no element in the document carries;
 *   - `empty-idref`        such an attribute is present but blank;
 *   - `invalid-nesting`    a content-model violation the HTML parser would
 *                          have REPAIRED had this been markup — but the DOM
 *                          is built by script, so nothing repairs it and the
 *                          accessibility tree inherits the nonsense:
 *                          interactive content inside `<a>`/`<button>`,
 *                          `<label>` in `<label>`, `<form>` in `<form>`,
 *                          flow content inside `<p>`, `<li>`/`<dt>`/`<dd>`/
 *                          table parts under the wrong parent, and non-`<li>`
 *                          children of `<ul>`/`<ol>`.
 *
 * axe covers ROLE-level structure (`list`, `listitem`, `aria-required-*`);
 * this covers the HTML content model and the idref graph, which axe checks
 * only partially (e.g. `aria-controls` on a collapsed control is skipped).
 */
export interface MarkupReport {
  readonly findings: readonly string[]
  /** Vacuity: how many elements / idrefs the probe actually judged. */
  readonly elements: number
  readonly idrefs: number
}

export function probeMarkup(): MarkupReport {
  const findings: string[] = []
  const describe = (element: Element): string => {
    const parts = [element.localName]
    if (element.id !== '') parts.push(`#${element.id}`)
    for (const name of ['data-scope', 'data-part', 'role']) {
      const value = element.getAttribute(name)
      if (value !== null) parts.push(`[${name}="${value}"]`)
    }
    return parts.join('')
  }

  const all = Array.from(document.querySelectorAll('*'))
  const ids = new Map<string, number>()
  for (const element of all) {
    if (element.id !== '') ids.set(element.id, (ids.get(element.id) ?? 0) + 1)
  }
  for (const [id, count] of ids) {
    if (count > 1) findings.push(`duplicate-id: "${id}" is carried by ${count} elements`)
  }

  const IDREF_LISTS = [
    'aria-labelledby',
    'aria-describedby',
    'aria-controls',
    'aria-owns',
    'aria-flowto',
    'aria-details',
    'headers',
  ]
  const IDREF_SINGLE = [
    'aria-activedescendant',
    'aria-errormessage',
    'for',
    'list',
    'form',
    'popovertarget',
  ]
  let idrefs = 0
  for (const element of all) {
    for (const name of [...IDREF_LISTS, ...IDREF_SINGLE]) {
      const value = element.getAttribute(name)
      if (value === null) continue
      // `for`/`list`/`form` are idrefs only on the elements that define them.
      if (name === 'for' && element.localName !== 'label' && element.localName !== 'output')
        continue
      if (name === 'list' && element.localName !== 'input') continue
      if (
        name === 'form' &&
        !['button', 'fieldset', 'input', 'object', 'output', 'select', 'textarea'].includes(
          element.localName,
        )
      )
        continue
      if (name === 'headers' && element.localName !== 'td' && element.localName !== 'th') continue
      idrefs += 1
      const tokens = IDREF_LISTS.includes(name)
        ? value.split(/\s+/).filter(Boolean)
        : [value.trim()].filter(Boolean)
      if (tokens.length === 0) {
        findings.push(`empty-idref: ${describe(element)} has an empty ${name}`)
        continue
      }
      for (const token of tokens) {
        // A COLLAPSED control may name a popup that is not mounted yet: every
        // LLui overlay unmounts its content while closed, and ARIA (and axe's
        // `aria-valid-attr-value`, which makes the same exception) accepts
        // `aria-controls` naming it while `aria-expanded="false"`. An EXPANDED
        // control naming a missing popup is still a broken reference.
        if (
          name === 'aria-controls' &&
          element.getAttribute('aria-expanded') === 'false' &&
          !ids.has(token)
        ) {
          continue
        }
        if (!ids.has(token)) {
          findings.push(
            `broken-idref: ${describe(element)} ${name}="${value}" names no element with id "${token}"`,
          )
        }
      }
    }
  }

  const INTERACTIVE =
    'a[href], button, details, embed, iframe, label, select, textarea, input:not([type="hidden"]), audio[controls], video[controls], [tabindex]:not([tabindex="-1"])'
  const FLOW_IN_P =
    'address, article, aside, blockquote, details, div, dl, fieldset, figcaption, figure, footer, form, h1, h2, h3, h4, h5, h6, header, hgroup, hr, main, menu, nav, ol, p, pre, section, table, ul'
  for (const element of all) {
    const name = element.localName
    if (name === 'a' || name === 'button') {
      const nested = element.querySelector(INTERACTIVE)
      if (nested !== null) {
        findings.push(
          `invalid-nesting: ${describe(nested)} is interactive content inside ${describe(element)}`,
        )
      }
    }
    if (name === 'label') {
      const nested = element.querySelector('label')
      if (nested !== null)
        findings.push(`invalid-nesting: ${describe(nested)} inside ${describe(element)}`)
    }
    if (name === 'form') {
      const nested = element.querySelector('form')
      if (nested !== null)
        findings.push(`invalid-nesting: ${describe(nested)} inside ${describe(element)}`)
    }
    if (name === 'p') {
      const nested = element.querySelector(FLOW_IN_P)
      if (nested !== null)
        findings.push(
          `invalid-nesting: ${describe(nested)} is flow content inside ${describe(element)}`,
        )
    }
    const parent = element.parentElement
    const parentName = parent?.localName ?? ''
    if (name === 'li' && !['ul', 'ol', 'menu'].includes(parentName)) {
      findings.push(
        `invalid-nesting: ${describe(element)} is a child of ${parent === null ? 'nothing' : describe(parent)}, not ul/ol/menu`,
      )
    }
    if (
      (name === 'dt' || name === 'dd') &&
      parentName !== 'dl' &&
      !(parentName === 'div' && parent?.parentElement?.localName === 'dl')
    ) {
      findings.push(`invalid-nesting: ${describe(element)} is outside a dl`)
    }
    if (name === 'ul' || name === 'ol') {
      for (const child of Array.from(element.children)) {
        if (!['li', 'script', 'template'].includes(child.localName)) {
          findings.push(
            `invalid-nesting: ${describe(child)} is a direct child of ${describe(element)}`,
          )
        }
      }
    }
    if (name === 'tr' && !['thead', 'tbody', 'tfoot', 'table'].includes(parentName)) {
      findings.push(
        `invalid-nesting: ${describe(element)} is a child of ${parent === null ? 'nothing' : describe(parent)}`,
      )
    }
    if ((name === 'td' || name === 'th') && parentName !== 'tr') {
      findings.push(
        `invalid-nesting: ${describe(element)} is a child of ${parent === null ? 'nothing' : describe(parent)}`,
      )
    }
    if (
      ['thead', 'tbody', 'tfoot', 'caption', 'colgroup'].includes(name) &&
      parentName !== 'table'
    ) {
      findings.push(`invalid-nesting: ${describe(element)} is outside a table`)
    }
  }

  return { findings, elements: all.length, idrefs }
}
