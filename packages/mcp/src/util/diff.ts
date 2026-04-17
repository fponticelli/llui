export interface HtmlDiffResult {
  match: boolean
  differences: Array<{ path: string; expected: string; actual: string }>
}

export function domDiff(
  expected: string,
  actual: string,
  opts: { ignoreWhitespace?: boolean } = {},
): HtmlDiffResult {
  const norm = (s: string): string => (opts.ignoreWhitespace ? s.replace(/\s+/g, ' ').trim() : s)
  const e = norm(expected)
  const a = norm(actual)
  if (e === a) return { match: true, differences: [] }
  return {
    match: false,
    differences: [{ path: 'root', expected: e, actual: a }],
  }
}

export interface StateDiff {
  added: Record<string, unknown>
  removed: Record<string, unknown>
  changed: Record<string, { from: unknown; to: unknown }>
}

export function diffState(a: unknown, b: unknown): StateDiff {
  const out: StateDiff = { added: {}, removed: {}, changed: {} }
  if (
    a == null ||
    b == null ||
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    Array.isArray(a) !== Array.isArray(b)
  ) {
    if (a !== b) out.changed['<root>'] = { from: a, to: b }
    return out
  }
  const aObj = a as Record<string, unknown>
  const bObj = b as Record<string, unknown>
  const keys = new Set([...Object.keys(aObj), ...Object.keys(bObj)])
  for (const k of keys) {
    if (!(k in aObj)) out.added[k] = bObj[k]
    else if (!(k in bObj)) out.removed[k] = aObj[k]
    else if (!Object.is(aObj[k], bObj[k])) out.changed[k] = { from: aObj[k], to: bObj[k] }
  }
  return out
}
