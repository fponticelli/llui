/**
 * Selector specificity, computed from the selector text — the thing #241 is
 * about, and the thing a string assertion cannot see.
 *
 * `expect(selector).toBe('…')` pins a spelling; it says nothing about whether
 * that spelling outranks a consumer's override, which is the property the token
 * contract actually depends on. This computes (a, b, c) per the Selectors Level
 * 4 rules the two candidate spellings differ on:
 *
 *   - `:where(…)` contributes ZERO, whatever is inside it;
 *   - `:not(…)` / `:is(…)` / `:has(…)` contribute their most specific argument;
 *   - `:root` is an ordinary pseudo-class, so (0,1,0) — which is why wrapping
 *     `:root` itself gives (0,0,0) and loses to `tokens.css`.
 *
 * Deliberately not a general CSS parser: it covers the compound-selector grammar
 * the token stylesheets use, and `parseSpecificity` THROWS on anything it does
 * not understand rather than returning a plausible-looking zero. A silent zero
 * here would read as "the guard is harmless", which is the exact wrong answer.
 * `specificity.test.ts` checks it against hand-computed values, including both
 * spellings from #241 and the broken (0,0,0) variant.
 */

export type Specificity = readonly [number, number, number]

/** Negative if `a` is less specific than `b`, positive if more, 0 if tied. */
export function compareSpecificity(a: Specificity, b: Specificity): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

export function formatSpecificity(s: Specificity): string {
  return `(${s[0]},${s[1]},${s[2]})`
}

const IDENT_START = /[a-zA-Z_-]/
const IDENT_REST = /[a-zA-Z0-9_-]/

/** Split a selector LIST on top-level commas (not commas inside `(…)`/`[…]`). */
export function splitSelectorList(list: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < list.length; i++) {
    const ch = list[i]
    if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']') depth--
    else if (ch === ',' && depth === 0) {
      out.push(list.slice(start, i))
      start = i + 1
    }
  }
  out.push(list.slice(start))
  return out.map((s) => s.trim()).filter((s) => s.length > 0)
}

/** Pseudo-classes whose specificity is that of their most specific argument. */
const MATCHES_ANY = new Set(['not', 'is', 'has'])

export function parseSpecificity(selector: string): Specificity {
  const s = selector.trim()
  if (s.length === 0) throw new Error('parseSpecificity: empty selector')

  // A selector LIST takes the specificity of its most specific member. The token
  // stylesheet's explicit block is exactly that (`.dark, [data-theme='dark']`).
  const parts = splitSelectorList(s)
  if (parts.length > 1) {
    return parts
      .map(parseSpecificity)
      .reduce<Specificity>((max, cur) => (compareSpecificity(cur, max) > 0 ? cur : max), [0, 0, 0])
  }

  let a = 0
  let b = 0
  let c = 0
  let i = 0

  const readIdent = (): string => {
    const start = i
    if (!IDENT_START.test(s[i] ?? ''))
      throw new Error(`parseSpecificity: expected an identifier at ${i} in ${s}`)
    while (i < s.length && IDENT_REST.test(s[i] as string)) i++
    return s.slice(start, i)
  }

  /** `s[i]` is `(`; returns the balanced contents and leaves `i` past the `)`. */
  const readParenthesized = (): string => {
    const start = i + 1
    let depth = 0
    for (; i < s.length; i++) {
      if (s[i] === '(') depth++
      else if (s[i] === ')') {
        depth--
        if (depth === 0) {
          const inner = s.slice(start, i)
          i++
          return inner
        }
      }
    }
    throw new Error(`parseSpecificity: unbalanced parentheses in ${s}`)
  }

  const maxOf = (list: string): Specificity =>
    splitSelectorList(list)
      .map(parseSpecificity)
      .reduce<Specificity>((max, cur) => (compareSpecificity(cur, max) > 0 ? cur : max), [0, 0, 0])

  while (i < s.length) {
    const ch = s[i] as string
    if (/\s/.test(ch) || ch === '>' || ch === '+' || ch === '~') {
      i++
    } else if (ch === '*') {
      i++ // the universal selector contributes nothing
    } else if (ch === '#') {
      i++
      readIdent()
      a++
    } else if (ch === '.') {
      i++
      readIdent()
      b++
    } else if (ch === '[') {
      const close = s.indexOf(']', i)
      if (close === -1) throw new Error(`parseSpecificity: unterminated attribute selector in ${s}`)
      i = close + 1
      b++
    } else if (ch === ':') {
      const isPseudoElement = s[i + 1] === ':'
      i += isPseudoElement ? 2 : 1
      const name = readIdent().toLowerCase()
      const inner = s[i] === '(' ? readParenthesized() : null
      if (name === 'where') {
        // Contributes zero. This is the whole of #241's fix.
      } else if (MATCHES_ANY.has(name)) {
        if (inner === null)
          throw new Error(`parseSpecificity: :${name} without an argument in ${s}`)
        const [ia, ib, ic] = maxOf(inner)
        a += ia
        b += ib
        c += ic
      } else if (isPseudoElement) {
        c++
      } else {
        // An ordinary pseudo-class, `:root` included. Functional forms this
        // helper does not model (`:nth-child(… of …)`) are rejected rather than
        // silently under-counted.
        if (inner !== null && /\bof\b/i.test(inner))
          throw new Error(
            `parseSpecificity: unsupported functional pseudo-class :${name}(${inner})`,
          )
        b++
      }
    } else if (IDENT_START.test(ch)) {
      readIdent()
      c++
    } else {
      throw new Error(
        `parseSpecificity: unexpected character ${JSON.stringify(ch)} at ${i} in ${s}`,
      )
    }
  }

  return [a, b, c]
}
