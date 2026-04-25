import type { MessageAnnotations, OutlineNode } from '../../protocol.js'

export type DescribeVisibleArgs = Record<string, never>
export type DescribeVisibleResult = { outline: OutlineNode[] }

export type DescribeVisibleHost = {
  getRootElement(): Element | null
  getBindingDescriptors(): Array<{ variant: string }> | null
  getMsgAnnotations(): Record<string, MessageAnnotations> | null
}

/**
 * Walk data-agent-tagged subtrees and produce a structured outline.
 * Buttons cross-reference __bindingDescriptors so Claude can tie
 * visible text to variant names.
 */
export function handleDescribeVisibleContent(host: DescribeVisibleHost): DescribeVisibleResult {
  const root = host.getRootElement()
  if (!root) return { outline: [] }
  const out: OutlineNode[] = []
  const allZones = Array.from(root.querySelectorAll('[data-agent]'))
  // Only walk top-level zones; skip zones that are descendants of other zones
  const topLevel = allZones.filter(
    (zone) => !allZones.some((other) => other !== zone && other.contains(zone)),
  )
  for (const zone of topLevel) {
    walk(zone, out)
  }
  return { outline: out }
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
