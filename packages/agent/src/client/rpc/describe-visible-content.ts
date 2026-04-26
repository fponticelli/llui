import type { MessageAnnotations, OutlineNode } from '../../protocol.js'

export type DescribeVisibleArgs = Record<string, never>
export type DescribeVisibleResult = {
  outline: OutlineNode[]
  /**
   * `'data-agent'` when the outline was scoped to author-tagged zones.
   * `'fallback'` when the app has no `data-agent` attributes and the
   * walker fell back to a generic semantic-element pass over the root.
   * `'truncated'` when the fallback outline hit the node-count cap and
   * stopped early; the caller can ask follow-up questions through
   * `query_dom` or by inspecting state directly.
   */
  source: 'data-agent' | 'fallback' | 'truncated'
}

export type DescribeVisibleHost = {
  getRootElement(): Element | null
  getBindingDescriptors(): Array<{ variant: string }> | null
  getMsgAnnotations(): Record<string, MessageAnnotations> | null
}

/**
 * Hard caps for the fallback walk. The author-tagged path doesn't need
 * caps — by definition the author chose what to expose. The fallback is
 * walking arbitrary DOM, so it has to bound the work.
 *
 * 200 nodes covers ~3–5 visible screens of typical app UI; depth 8 is
 * deep enough for nested content trees but stops us from descending
 * into giant virtualised lists or syntax-highlighted code blocks.
 */
const FALLBACK_MAX_NODES = 200
const FALLBACK_MAX_DEPTH = 8

/**
 * Walk data-agent-tagged subtrees and produce a structured outline.
 * Buttons cross-reference __bindingDescriptors so Claude can tie
 * visible text to variant names.
 *
 * If the app has no `data-agent` tags, fall back to a depth-limited
 * walk of the entire root element. This makes the tool useful for apps
 * that haven't (yet) tagged their views — typical first-pass dogfood
 * targets — instead of returning an empty outline that conveys
 * nothing. The fallback path sets `source: 'fallback'` so the caller
 * can tell the outline is best-effort.
 */
export function handleDescribeVisibleContent(host: DescribeVisibleHost): DescribeVisibleResult {
  const root = host.getRootElement()
  if (!root) return { outline: [], source: 'data-agent' }
  const allZones = Array.from(root.querySelectorAll('[data-agent]'))
  if (allZones.length > 0) {
    const out: OutlineNode[] = []
    // Only walk top-level zones; skip zones that are descendants of other zones
    const topLevel = allZones.filter(
      (zone) => !allZones.some((other) => other !== zone && other.contains(zone)),
    )
    for (const zone of topLevel) {
      walk(zone, out)
    }
    return { outline: out, source: 'data-agent' }
  }
  // Fallback: walk the entire root with caps. Useful for apps without
  // any data-agent annotations — at minimum the agent gets headings,
  // buttons, links, lists, and visible text it can use to orient.
  const out: OutlineNode[] = []
  const truncated = walkFallback(root, out, 0)
  return { outline: out, source: truncated ? 'truncated' : 'fallback' }
}

function walk(el: Element, out: OutlineNode[]): void {
  const tag = el.tagName.toLowerCase()
  const text = (el.textContent ?? '').trim()
  if (/^h[1-6]$/.test(tag)) {
    out.push({ kind: 'heading', level: Number(tag[1]), text })
    return
  }
  if (tag === 'button') {
    out.push({
      kind: 'button',
      text,
      disabled: (el as HTMLButtonElement).disabled,
      actionVariant: el.getAttribute('data-agent') ?? null,
    })
    return
  }
  if (tag === 'a' && el.getAttribute('href')) {
    out.push({ kind: 'link', text, href: el.getAttribute('href') ?? '' })
    return
  }
  if (tag === 'input') {
    out.push({
      kind: 'input',
      label: el.getAttribute('aria-label') ?? el.getAttribute('name') ?? null,
      value: (el as HTMLInputElement).value ?? null,
      type: (el as HTMLInputElement).type ?? 'text',
    })
    return
  }
  if (tag === 'ul' || tag === 'ol') {
    const items: OutlineNode[] = []
    for (const child of Array.from(el.children)) {
      if (child.tagName.toLowerCase() === 'li') {
        items.push({ kind: 'item', text: (child.textContent ?? '').trim() })
      }
    }
    out.push({ kind: 'list', items })
    return
  }
  if (text.length > 0 && el.children.length === 0) {
    out.push({ kind: 'text', text })
    return
  }
  for (const child of Array.from(el.children)) {
    walk(child, out)
  }
}

/**
 * Depth- and count-limited walk for the fallback path. Returns true
 * iff the cap was hit (at least one element was skipped). Same node
 * vocabulary as `walk` but prunes more aggressively:
 *
 *  - `<a>` without `href`, `<button>` without text — skipped (often
 *    icon-only chrome that adds noise without helping the agent).
 *  - Nested wrapper divs without semantic content — descended into
 *    but not emitted.
 *  - Standalone text nodes — only emitted when the parent has no
 *    semantic children (preserves the existing `walk` heuristic).
 */
function walkFallback(el: Element, out: OutlineNode[], depth: number): boolean {
  if (out.length >= FALLBACK_MAX_NODES) return true
  if (depth > FALLBACK_MAX_DEPTH) return false
  const tag = el.tagName.toLowerCase()
  // Skip script/style/noscript subtrees — never user-facing content.
  if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'template') return false
  const text = (el.textContent ?? '').trim()
  if (/^h[1-6]$/.test(tag)) {
    out.push({ kind: 'heading', level: Number(tag[1]), text })
    return false
  }
  if (tag === 'button') {
    if (text.length > 0 || el.getAttribute('aria-label')) {
      out.push({
        kind: 'button',
        text: text || el.getAttribute('aria-label') || '',
        disabled: (el as HTMLButtonElement).disabled,
        actionVariant: el.getAttribute('data-agent') ?? null,
      })
    }
    return out.length >= FALLBACK_MAX_NODES
  }
  if (tag === 'a' && el.getAttribute('href')) {
    out.push({ kind: 'link', text, href: el.getAttribute('href') ?? '' })
    return out.length >= FALLBACK_MAX_NODES
  }
  if (tag === 'input') {
    const inputType = (el as HTMLInputElement).type ?? 'text'
    // `hidden` inputs are almost always form-state plumbing; skip them.
    if (inputType !== 'hidden') {
      out.push({
        kind: 'input',
        label: el.getAttribute('aria-label') ?? el.getAttribute('name') ?? null,
        value: (el as HTMLInputElement).value ?? null,
        type: inputType,
      })
    }
    return out.length >= FALLBACK_MAX_NODES
  }
  if (tag === 'ul' || tag === 'ol') {
    const items: OutlineNode[] = []
    for (const child of Array.from(el.children)) {
      if (child.tagName.toLowerCase() === 'li') {
        const itemText = (child.textContent ?? '').trim()
        if (itemText.length > 0) items.push({ kind: 'item', text: itemText })
      }
    }
    if (items.length > 0) out.push({ kind: 'list', items })
    return out.length >= FALLBACK_MAX_NODES
  }
  // Bare text leaf: only emit if the element has a non-empty text and
  // no element children. Same rule as the tagged walker.
  if (text.length > 0 && el.children.length === 0) {
    out.push({ kind: 'text', text })
    return out.length >= FALLBACK_MAX_NODES
  }
  for (const child of Array.from(el.children)) {
    if (walkFallback(child, out, depth + 1)) return true
  }
  return false
}
