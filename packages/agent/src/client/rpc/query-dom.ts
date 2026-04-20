export type QueryDomArgs = { name: string; multiple?: boolean }
export type QueryDomResult = {
  elements: Array<{ text: string; attrs: Record<string, string>; path: number[] }>
}

export type QueryDomHost = {
  getRootElement(): Element | null
}

/**
 * Spec §7.7 / §8.2: reads only elements explicitly tagged
 * `data-agent="<name>"`. No full-DOM access in v1.
 */
export function handleQueryDom(host: QueryDomHost, args: QueryDomArgs): QueryDomResult {
  const root = host.getRootElement()
  if (!root) return { elements: [] }
  const selector = `[data-agent="${cssEscape(args.name)}"]`
  const nodes = args.multiple
    ? Array.from(root.querySelectorAll(selector))
    : ([root.querySelector(selector)].filter(Boolean) as Element[])

  return {
    elements: nodes.map((n) => ({
      text: (n.textContent ?? '').trim(),
      attrs: Object.fromEntries(Array.from(n.attributes).map((a) => [a.name, a.value])),
      path: computePath(root, n),
    })),
  }
}

function cssEscape(s: string): string {
  // Simple escape for double-quotes; most data-agent names won't need it.
  return s.replace(/"/g, '\\"')
}

function computePath(root: Element, target: Element): number[] {
  const out: number[] = []
  let cur: Element | null = target
  while (cur !== null && cur !== root) {
    const parent: Element | null = cur.parentElement
    if (!parent) break
    out.unshift(Array.from(parent.children).indexOf(cur))
    cur = parent
  }
  return out
}
