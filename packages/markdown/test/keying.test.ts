import { describe, it, expect } from 'vitest'
import {
  toKeyedBlocks,
  parseMarkdown,
  collectDefinitions,
  resolveOptions,
  incrementalParse,
  keyingHashComputations,
  type ParseCache,
} from '../src/index.js'
import type { Definition, Nodes, Root } from 'mdast'

const keysFor = (
  src: string,
  opts: Parameters<typeof resolveOptions>[0] = {},
): (string | number)[] => {
  const root = parseMarkdown(src, opts)
  const defs = collectDefinitions(root)
  return toKeyedBlocks(root, src, resolveOptions(opts), defs).map((b) => b.key)
}

describe('toKeyedBlocks — uniqueness', () => {
  it('deduplicates identical-content blocks with a #n suffix', () => {
    const keys = keysFor('para\n\npara\n\npara')
    expect(new Set(keys).size).toBe(keys.length) // all unique
    expect(keys[0]).not.toBe(keys[1])
  })

  it('deduplicates colliding user keyOf results (would corrupt `each` otherwise)', () => {
    // A keyOf that returns a constant hands `each` duplicate keys — dedup rescues it.
    const keys = keysFor('# a\n\n# b\n\n# c', { keyOf: () => 'same' })
    expect(new Set(keys).size).toBe(3)
    expect(keys[0]).toBe('same')
    expect(keys[1]).toBe('same#1')
    expect(keys[2]).toBe('same#2')
  })

  it('preserves distinct user keyOf results verbatim', () => {
    const keys = keysFor('# a\n\n# b', { keyOf: (_n, i) => `k${i}` })
    expect(keys).toEqual(['k0', 'k1'])
  })
})

describe('toKeyedBlocks — content hash', () => {
  it('gives different content changes different keys (64-bit two-base hash)', () => {
    const [a] = keysFor('hello world')
    const [b] = keysFor('hello worlx')
    expect(a).not.toBe(b)
  })

  it('folds resolved reference definitions into a ref-bearing block key', () => {
    // Same block source `[a][r]`, different resolution ⇒ different key.
    const unresolved = keysFor('[a][r]')[0]
    const resolved = keysFor('[a][r]\n\n[r]: /x')[0]
    // The first block in each is the paragraph `[a][r]` (byte-identical source).
    expect(unresolved).not.toBe(resolved)
  })

  it('folds a consumed FOOTNOTE reference into a ref-bearing block key (#84)', () => {
    // `see[^a]` is LITERAL TEXT until `[^a]:` exists, so the block's source slice
    // and node type are identical either way — only the fingerprint can tell the
    // two apart. Blind to `footnoteReference`, it cannot, and the streamed prefix
    // block keeps its key (and its stale literal-text DOM) forever.
    const unresolved = keysFor('see[^a] here')[0]
    const resolved = keysFor('see[^a] here\n\n[^a]: the note')[0]
    expect(unresolved).not.toBe(resolved)
  })

  it('keeps a link reference and a footnote reference with the SAME id distinct', () => {
    // Un-namespaced ids would collapse `[a][x]` and `and[^x]` into one entry, so
    // the footnote definition arriving would leave the fingerprint unchanged.
    const linkOnly = keysFor('see [a][x] and[^x]\n\n[x]: /link')[0]
    const both = keysFor('see [a][x] and[^x]\n\n[x]: /link\n\n[^x]: the note')[0]
    expect(linkOnly).not.toBe(both)
  })

  it('leaves ref-FREE blocks with a pure content key (unchanged by unrelated defs)', () => {
    const bare = keysFor('plain paragraph')[0]
    const withDef = keysFor('plain paragraph\n\n[r]: /x')[0]
    expect(bare).toBe(withDef) // paragraph consumes no refs ⇒ stable
  })
})

describe('toKeyedBlocks — hash field', () => {
  it('exposes a content hash that changes with content', () => {
    const root1 = parseMarkdown('x')
    const root2 = parseMarkdown('y')
    const h1 = toKeyedBlocks(root1, 'x', resolveOptions({}), collectDefinitions(root1))[0]?.hash
    const h2 = toKeyedBlocks(root2, 'y', resolveOptions({}), collectDefinitions(root2))[0]?.hash
    expect(h1).not.toBe(h2)
  })

  it('accepts a typed mdast node in keyOf', () => {
    const keys = keysFor('# Heading', {
      keyOf: (node: Nodes) => `type-${node.type}`,
    })
    expect(keys[0]).toBe('type-heading')
  })
})

describe('toKeyedBlocks — per-block hash memoization (streaming O(tail))', () => {
  const opts = resolveOptions({})
  const parse = (s: string): Root => parseMarkdown(s)
  const keysOf = (root: Root, src: string): (string | number)[] =>
    toKeyedBlocks(root, src, opts, collectDefinitions(root)).map((b) => b.key)

  it('re-hashes only the changed tail across a streamed append, not the whole doc', () => {
    let cache: ParseCache | undefined

    const s1 = '# Title\n\nfirst paragraph\n\n'
    const r1 = incrementalParse(cache, s1, parse)
    cache = r1.cache
    keyingHashComputations(true) // reset counter
    keysOf(r1.root, s1)
    // Cold pass: every block is hashed once.
    expect(keyingHashComputations(true)).toBe(r1.root.children.length)

    const s2 = s1 + 'second paragraph'
    const r2 = incrementalParse(cache, s2, parse)
    expect(r2.reused).toBeGreaterThanOrEqual(1) // the incremental parser reused a prefix
    keyingHashComputations(true) // reset
    keysOf(r2.root, s2)
    // The reused prefix blocks (SAME node objects) hit the memo → zero re-hashing;
    // only the freshly-parsed tail blocks are hashed.
    expect(keyingHashComputations(true)).toBe(r2.root.children.length - r2.reused)
  })

  it('keeps produced keys byte-identical to a non-incremental (memo-cold) parse', () => {
    let cache: ParseCache | undefined
    const chunks = [
      '# Doc\n\nintro\n\n',
      '# Doc\n\nintro\n\nmiddle\n\n',
      '# Doc\n\nintro\n\nmiddle\n\ntail',
    ]
    for (const src of chunks) {
      const inc = incrementalParse(cache, src, parse)
      cache = inc.cache
      const memoKeys = keysOf(inc.root, src)
      // A cold full parse (new node objects → all memo misses) must key identically.
      const cold = parse(src)
      expect(keysOf(cold, src)).toEqual(memoKeys)
    }
  })

  it('re-hashes a reused ref-bearing block when a definition it resolves changes', () => {
    let cache: ParseCache | undefined
    const s1 = '[a][r]\n\n[r]: /old'
    const r1 = incrementalParse(cache, s1, parse)
    cache = r1.cache
    const k1 = keysOf(r1.root, s1)

    // Same prefix block object `[a][r]` is reused, but the definition url changed —
    // its content-id (and key) must change, so the memo cannot blindly reuse it.
    const s2 = '[a][r]\n\n[r]: /new'
    const r2 = incrementalParse(cache, s2, parse)
    const k2 = keysOf(r2.root, s2)
    expect(k2[0]).not.toBe(k1[0])
  })
})

describe('referenceFingerprint — the NUL separator invariant (#94)', () => {
  // Written as the `\0` ESCAPE here for the same reason keying.ts writes it that
  // way: a raw byte turns the file binary for git.
  const NUL = '\0'

  // That the FILE holds no raw NUL — the half of #94 that keeps this file
  // reviewable — is pinned repo-wide in `scripts/test/source-encoding.test.ts`;
  // this package has no node types to read itself with. What follows is the other
  // half: why U+0000 is the right VALUE for the separator.

  it('cannot occur in a definition identifier, url or title (CommonMark U+0000 → U+FFFD)', () => {
    // This is the whole justification for the sentinel. micromark performs the
    // substitution in its PREPROCESSOR — upstream of every tokenizer and of any
    // user-supplied syntax extension — so no Markdown source can smuggle a NUL
    // into a fingerprinted field, raw or via the `&#0;` character reference.
    const src = `[a${NUL}b]: /u${NUL}rl "t${NUL}itle"\n\n[e]: /a&#0;b "&#0;"\n`
    const defs = collectDefinitions(parseMarkdown(src))
    expect(defs.size).toBe(2)
    for (const [id, def] of defs) {
      expect(id).not.toContain(NUL)
      expect(def.url).not.toContain(NUL)
      expect(def.title ?? '').not.toContain(NUL)
    }
    // Replaced, not dropped: the label is still one definition, spelled U+FFFD.
    expect([...defs.keys()]).toContain('a�b')
  })

  it('separates url from title unambiguously (a `|` in a url is not a field break)', () => {
    // The previous `${id}=${url}|${title}` layout fingerprinted these two
    // definition states IDENTICALLY (`l:r=/a|b|`): url `/a|b` with no title, and
    // url `/a` with title `b|`. Same block source ⇒ same key ⇒ the paragraph
    // never re-renders and keeps the wrong href.
    const inUrl = keysFor('see [x][r]\n\n[r]: /a|b')[0]
    const inTitle = keysFor('see [x][r]\n\n[r]: /a "b|"')[0]
    expect(inUrl).not.toBe(inTitle)
  })

  it('cannot be forged by a separator INSIDE a url (fields are length-prefixed)', () => {
    // The case the parser cannot reach but the PUBLIC SURFACE can: `toKeyedBlocks`,
    // `renderMarkdown` and `createMarkdown(parse)` are all exported, and the
    // definition table is derived from whatever tree the caller's `ParseFn`
    // returns — a custom parser or an mdastExtension never passes micromark's
    // preprocessor, so a url CAN hold a SEP.
    //
    // Fixed arity alone only fixes field POSITIONS while every field is SEP-free.
    // These two definitions join to the identical field string (`p<SEP>q<SEP>r`),
    // so with SEP-joined fields they fingerprint the same and the `|` bug returns
    // verbatim: same block source, same key, stale href. Length-prefixing each
    // field makes the encoding injective for ANY content — note that
    // length-prefixing the whole RECORD does NOT fix this, since both splittings
    // produce a body of the same length.
    const src = 'see [x][r] here\n\n[r]: /p'
    const opts = resolveOptions({})
    const table = (url: string, title: string | null): ReadonlyMap<string, Definition> =>
      new Map([['r', { type: 'definition', identifier: 'r', label: 'r', url, title }]])
    const keyWith = (url: string, title: string | null): string | number =>
      toKeyedBlocks(parseMarkdown(src), src, opts, table(url, title))[0]!.key
    expect(keyWith(`p${NUL}q`, 'r')).not.toBe(keyWith('p', `q${NUL}r`))
  })

  it('distinguishes an EMPTY title from an ABSENT one', () => {
    // `title ?? ''` collapses the two. mdast-util-from-markdown happens to
    // normalize `[r]: /u ""` to `title: null`, so Markdown source alone cannot
    // reach the difference — but `Definition['title']` is `string | null |
    // undefined`, `mdastExtensions` is a public option and the definition table is
    // a PARAMETER here, so the fingerprint must not lean on that normalization.
    // The definition must be IN the source for `[x][r]` to parse as a
    // linkReference at all (an unresolvable one stays literal text); the table the
    // fingerprint reads is then supplied here, with the two titles under test.
    const src = 'see [x][r]\n\n[r]: /u'
    const opts = resolveOptions({})
    const table = (title: string | null): ReadonlyMap<string, Definition> =>
      new Map([['r', { type: 'definition', identifier: 'r', label: 'r', url: '/u', title }]])
    const keyWith = (title: string | null): string | number =>
      toKeyedBlocks(parseMarkdown(src), src, opts, table(title))[0]!.key
    expect(keyWith(null)).not.toBe(keyWith(''))
  })

  it('distinguishes an ABSENT definition from one whose fields spell the absent record', () => {
    const undefinedRef = keysFor('see [x][r]')[0]
    const emptyUrl = keysFor('see [x][r]\n\n[r]: <>')[0]
    expect(undefinedRef).not.toBe(emptyUrl)
  })

  it('does not let a raw NUL in the SOURCE forge a fingerprint (length-prefixed hash)', () => {
    // `blockSource` slices the source the CALLER passed — before micromark's
    // substitution — so it is the ONE hashed component that can still contain a
    // NUL. Without the length prefix, `source + fingerprint` is ambiguous: the
    // forged paragraph below (a ref-FREE block whose text spells the record layout
    // verbatim, `[^n]` staying literal with no definition) hashes exactly like the
    // real one plus its footnote fingerprint. Same node type, same hash ⇒ same key,
    // so a stream editing one into the other would never re-render the block.
    //
    // The forged text must spell the CURRENT record layout to be a real forgery —
    // `\0ref:` then the four length-prefixed fields of `f:n` (`3\0f:n`, `1\0f`,
    // `0\0`, `0\0`). If the layout changes, recompute it here rather than deleting
    // the test: a version of this that no longer spells the layout still passes,
    // and pins nothing.
    const real = keysFor('a[^n]\n\n[^n]: d')[0]
    const forged = keysFor(`a[^n]${NUL}ref:3${NUL}f:n1${NUL}f0${NUL}0${NUL}`)[0]
    expect(forged).not.toBe(real)
  })
})
