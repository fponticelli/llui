// `unsafeHtml` — render a raw HTML string as live DOM nodes inline between anchor
// comments (an escape hatch for pre-rendered markup: markdown, syntax highlighting).
// Reactive on the bound string; the parsed nodes carry NO bindings. The caller owns
// trust/sanitization.

import { requireCtx, mountable, type Mountable, type Producer } from './build-context.js'
import { removeBetween, parseFragment } from './dom-region.js'

/**
 * Render a raw HTML string as live DOM nodes, inline between anchor comments (no
 * wrapper element). Reactive: when the bound string changes, the previously
 * inserted fragment is removed and the new HTML parsed in. The parsed nodes carry
 * NO reactive bindings — `unsafeHtml` is an escape hatch for pre-rendered markup
 * (markdown, syntax highlighting). The caller is responsible for trust/sanitization.
 */
export function signalUnsafeHtml(
  produce: Producer,
  deps: readonly string[],
  componentRooted?: boolean,
): Mountable {
  return mountable(() => buildSignalUnsafeHtml(produce, deps, componentRooted))
}

function buildSignalUnsafeHtml(
  produce: Producer,
  deps: readonly string[],
  componentRooted?: boolean,
): Node {
  const c = requireCtx()
  const doc = c.doc
  const start = doc.createComment('unsafe-html')
  const end = doc.createComment('/unsafe-html')
  const frag = doc.createDocumentFragment()
  frag.appendChild(start)
  frag.appendChild(end)

  c.specs.push({
    deps,
    produce,
    componentRooted,
    commit: (value) => {
      const parent = end.parentNode
      if (!parent) return
      removeBetween(start, end)
      const html = value == null ? '' : String(value)
      if (html === '') return
      const parsed = parseFragment(doc, html)
      // Snapshot childNodes before insertion (insertBefore drains the fragment).
      for (const n of Array.from(parsed.childNodes)) parent.insertBefore(n, end)
    },
  })

  // On host dispose, clear the inserted region (mirrors signalShow) so an enclosing
  // arm's teardown doesn't orphan these nodes between now-removed anchors.
  c.teardowns.push(() => removeBetween(start, end))

  return frag
}
