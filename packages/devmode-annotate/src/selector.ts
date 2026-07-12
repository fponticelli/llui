// Single source of truth for CSS-selector synthesis in the HUD.
//
// Two shapes, both querySelector-compatible:
//
//  - `buildSelector(el)` — a SHORT, human-readable selector for the LLM and
//    the repro trace. Prefers `#id`, then `tag.class` (first non-`llui-`
//    class), then `tag:nth-of-type(n)` for positional disambiguation among
//    same-tag siblings. Walks up at most 4 ancestors, stopping at the first
//    id. This is the canonical builder — the element picker AND the repro
//    recorder both use it, so a recorded click on the 3rd of N identical
//    rows resolves back to that exact row on replay.
//
//  - `uniqueSelectorFor(el)` — a FULL unique path (`tag:nth-child(n)` up to a
//    parent with an id, or the root). Used by the debug collector's
//    source-map sampling, where an exact 1:1 querySelector match is required
//    to line an element up with its binding source.

/**
 * Build a short, stable CSS selector for the given element. Prefers `#id`,
 * then `tag.class` (first non-Llui class), then `tag:nth-of-type(n)`. Walks up
 * at most 4 ancestors to give enough context to locate the element while
 * staying readable. `:nth-of-type` disambiguates homogeneous siblings (e.g.
 * list rows) so the selector points at one specific element.
 */
export function buildSelector(el: Element): string {
  const parts: string[] = []
  let cur: Element | null = el
  for (let depth = 0; cur && depth < 4; depth++, cur = cur.parentElement) {
    if (cur.id) {
      parts.unshift(`#${cur.id}`)
      break // id is unique; nothing above matters
    }
    const tag = cur.tagName.toLowerCase()
    const classes = Array.from(cur.classList).filter((c) => !c.startsWith('llui-'))
    if (classes.length > 0) {
      parts.unshift(`${tag}.${classes[0]}`)
    } else if (cur.parentElement) {
      const el = cur
      const siblings = Array.from(cur.parentElement.children).filter(
        (c) => c.tagName === el.tagName,
      )
      const idx = siblings.indexOf(cur) + 1
      parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${idx})` : tag)
    } else {
      parts.unshift(tag)
    }
  }
  return parts.join(' > ')
}

/**
 * Synthesize a unique CSS selector for an element. Prefers id; falls back to a
 * chain of `tag:nth-child(n)` up to a parent with an id (or the root). The
 * result is querySelector-compatible and matches exactly one element.
 */
export function uniqueSelectorFor(el: Element): string | null {
  if (el.id) return `#${cssEscape(el.id)}`
  const parts: string[] = []
  let cur: Element | null = el
  while (cur && cur.tagName !== 'HTML' && cur.tagName !== 'BODY') {
    if (cur.id) {
      parts.unshift(`#${cssEscape(cur.id)}`)
      break
    }
    const parent: ParentNode | null = cur.parentNode
    if (!parent) break
    const children = parent.children
    let index = -1
    for (let k = 0; k < children.length; k++) {
      if (children[k] === cur) {
        index = k + 1
        break
      }
    }
    if (index <= 0) break
    parts.unshift(`${cur.tagName.toLowerCase()}:nth-child(${index})`)
    cur = parent instanceof Element ? parent : null
  }
  return parts.length > 0 ? parts.join(' > ') : null
}

function cssEscape(value: string): string {
  // Browsers expose CSS.escape; node tests (jsdom) generally do too.
  // Fall back to a manual escape for safety.
  const css = (globalThis as { CSS?: { escape?: (s: string) => string } }).CSS
  if (css?.escape) return css.escape(value)
  return value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`)
}
