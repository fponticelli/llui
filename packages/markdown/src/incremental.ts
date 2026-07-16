// Incremental (tail re-parse) Markdown parsing for the streaming case.
//
// Reactive `markdown()` re-derives an mdast tree every time its source signal
// changes. Re-parsing the WHOLE source on each chunk is O(N) per chunk — O(N·k)
// over a k-chunk stream, and the parse (micromark tokenizing every character +
// building the nested tree) is the dominant per-chunk cost for growing LLM output.
//
// `incrementalParse` reuses the previously-parsed top-level blocks for the stable
// prefix of the document and re-parses only the changed TAIL:
//
//   1. Find the longest common byte prefix of the old and new source.
//   2. Snap the boundary BACK to the end of the last previously-parsed top-level
//      block that is a SEALED LEAF — a non-container block (not list / blockquote /
//      footnoteDefinition) whose end is followed by a blank line in the new source.
//      A blank-line seal after a leaf block is a point NO later text can reach
//      across: setext underlines and lazy paragraph continuation both require
//      adjacency (no blank line), so nothing in the tail can retro-reclassify a
//      block before the seal. Container blocks are never used as the terminal
//      reused block because a later line can still continue a list/blockquote or
//      flip a list's looseness; but a container is fine INTERIOR to the reused
//      prefix, shielded by the sealed leaf that terminates it.
//   3. Reuse the old block nodes (and thus their keys/DOM) for `[0, cut)` and parse
//      only `newSrc.slice(cut)`, shifting the tail nodes' positions back to absolute
//      coordinates so the combined tree is byte-for-byte what a full parse produces.
//
// DOCUMENT-GLOBAL LABELS (reference & footnote definitions) are the subtle hazard,
// because they cross blank-line seals:
//   - A link/footnote definition arriving in the TAIL can reclassify earlier text
//     (`[a][r]` / `word[^1]` are literal text until their definition exists). Guard:
//     if the set of definition/footnote-definition identifiers changes at all
//     between the old tree and the incremental tree, fall back to a full parse.
//   - A reference in the TAIL can point at a definition in the reused PREFIX. Parsing
//     the tail in isolation would miss those definitions and leave the reference as
//     literal text. Guard: inject the prefix's definition identifiers as dummy
//     definitions ahead of the tail parse so tail references still form reference
//     nodes (their url/title are resolved at render time from the combined tree, so
//     the dummy destinations are never observed).
//
// Non-monotonic sources (time-travel / replay feeding a shorter or unrelated string)
// need no special case: an unrelated string shares no usable sealed boundary before
// the divergence, so the boundary search finds nothing and we full-parse.
//
// In dev the result is asserted equal to a full parse of the same source (see
// `render.ts`); the assertion is the safety net that this file's invariants hold.

import type { Root, RootContent, Definition, FootnoteDefinition } from 'mdast'
import type { Node } from 'unist'

/** Old source + its parsed tree, threaded across reactive updates. */
export interface ParseCache {
  readonly source: string
  readonly root: Root
}

/** Result of one (incremental or full) parse: the tree plus the cache to thread
 * into the next update. `reused` is the number of prefix blocks reused (0 = full
 * parse) — used only for dev diagnostics. */
export interface IncrementalResult {
  readonly root: Root
  readonly cache: ParseCache
  readonly reused: number
}

/** Container block types that must never be the TERMINAL reused block: a later
 * line can still continue them (list items / blockquote lines) or flip a list's
 * looseness, retro-changing a block we would have reused. */
const CONTAINER_TYPES: ReadonlySet<string> = new Set(['list', 'blockquote', 'footnoteDefinition'])

/** Leaf block types that ABSORB later blank lines + text when left unterminated:
 * an unclosed ``` fence (`code`) and an HTML type-1 block (`html`, e.g. `<pre>`)
 * run to EOF, swallowing a following blank line rather than being sealed by it.
 * For these, a blank line present only in the NEW source is not a real seal — the
 * old parse must ALSO have had a blank-line seal (proving the block was already
 * closed there, not merely EOF-terminated) before the block can be reused. */
const EOF_ABSORBING_TYPES: ReadonlySet<string> = new Set(['code', 'html'])

interface MutablePoint {
  line: number
  column: number
  offset?: number
}
interface MutablePosition {
  start: MutablePoint
  end: MutablePoint
}

/** Length of the longest common byte (UTF-16 code unit) prefix of `a` and `b`. */
function commonPrefixLength(a: string, b: string): number {
  const n = a.length < b.length ? a.length : b.length
  let i = 0
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++
  return i
}

/** Is offset `e` in `src` immediately followed by a blank line? (Optional trailing
 * spaces/tabs, a line ending, a whitespace-only line, then another line ending.)
 * A blank line after a leaf block seals it against setext / lazy continuation. */
function hasBlankLineSeal(src: string, e: number): boolean {
  const len = src.length
  let i = e
  while (i < len && (src[i] === ' ' || src[i] === '\t')) i++
  if (i >= len) return false
  if (src[i] === '\r') i++
  if (src[i] !== '\n') return false
  i++
  while (i < len && (src[i] === ' ' || src[i] === '\t')) i++
  if (i < len && src[i] === '\r') i++
  return i < len && src[i] === '\n'
}

/** Number of `\n` characters in `src[0, end)`. */
function countNewlines(src: string, end: number): number {
  let c = 0
  for (let i = 0; i < end; i++) if (src.charCodeAt(i) === 10) c++
  return c
}

/** Shift a freshly-parsed tail node's positions from tail-slice-local coordinates
 * back to absolute coordinates in the full new source. Columns are unchanged: the
 * tail always begins at a line start (column 1) after the blank-line seal. */
function shiftPositions(node: Node, offsetDelta: number, lineDelta: number): void {
  const pos = node.position as MutablePosition | undefined
  if (pos) {
    if (pos.start) {
      if (pos.start.offset != null) pos.start.offset += offsetDelta
      pos.start.line += lineDelta
    }
    if (pos.end) {
      if (pos.end.offset != null) pos.end.offset += offsetDelta
      pos.end.line += lineDelta
    }
  }
  const kids = (node as { children?: readonly Node[] }).children
  if (kids) for (const child of kids) shiftPositions(child, offsetDelta, lineDelta)
}

/** Collect document-global label identifiers — link/image reference definitions
 * (`l:` namespace) and GFM footnote definitions (`f:` namespace) — from a node
 * list. Namespacing keeps a link def `x` distinct from a footnote def `x`. */
function collectLabelIds(nodes: readonly Node[]): Set<string> {
  const out = new Set<string>()
  const visit = (node: Node): void => {
    if (node.type === 'definition') {
      out.add('l:' + (node as Definition).identifier.toLowerCase())
    } else if (node.type === 'footnoteDefinition') {
      out.add('f:' + (node as FootnoteDefinition).identifier.toLowerCase())
    }
    const kids = (node as { children?: readonly Node[] }).children
    if (kids) for (const child of kids) visit(child)
  }
  for (const n of nodes) visit(n)
  return out
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false
  for (const x of a) if (!b.has(x)) return false
  return true
}

/** Parse `source` incrementally against `cache` (the previous source + tree), or
 * fully when no safe reuse boundary exists. The returned tree is structurally
 * identical to `parse(source)` — reuse only ever changes which node OBJECTS are
 * shared with the previous tree (so their keys, and thus their DOM, survive). */
export function incrementalParse(
  cache: ParseCache | undefined,
  source: string,
  parse: (src: string) => Root,
  allowPrefixReuse = true,
): IncrementalResult {
  const full = (): IncrementalResult => {
    const root = parse(source)
    return { root, cache: { source, root }, reused: 0 }
  }
  if (!cache) return full()
  const { source: oldSource, root: oldRoot } = cache
  if (oldSource === source) {
    return { root: oldRoot, cache, reused: oldRoot.children.length }
  }

  // Prefix reuse's seal invariant is proven only for CommonMark + GFM. When the
  // caller runs custom (non-seal-safe) syntax extensions, a changed source is
  // re-parsed in full — a stale prefix is worse than the extra parse cost.
  if (!allowPrefixReuse) return full()

  const lcp = commonPrefixLength(oldSource, source)
  if (lcp === 0) return full()

  // Find the largest reusable prefix: walk blocks from the end, take the first
  // (highest) sealed leaf whose end sits within the common prefix.
  let reuseCount = -1
  let cut = 0
  for (let k = oldRoot.children.length - 1; k >= 0; k--) {
    const child = oldRoot.children[k]!
    const end = child.position?.end?.offset
    if (end == null || end > lcp) continue
    if (CONTAINER_TYPES.has(child.type)) continue
    if (!hasBlankLineSeal(source, end)) continue
    // For EOF-absorbing leaves (unclosed ``` fence / HTML type-1 block) the seal
    // must ALSO exist in the OLD source: such a block ran to EOF and would absorb
    // the appended blank line + text, so a seal seen only in the new source is a
    // lie and reusing the block would split one block into two.
    if (EOF_ABSORBING_TYPES.has(child.type) && !hasBlankLineSeal(oldSource, end)) continue
    reuseCount = k + 1
    cut = end
    break
  }
  if (reuseCount <= 0) return full()

  const reused = oldRoot.children.slice(0, reuseCount)

  // Inject the prefix's definition identifiers so a reference in the tail that
  // points at a prefix definition still forms a reference node. Destinations are
  // dummies — url/title come from the real (reused) definition nodes at render.
  let injected = ''
  for (const label of collectLabelIds(reused)) {
    const id = label.slice(2)
    injected += label[0] === 'l' ? `[${id}]: /llui-x\n\n` : `[^${id}]: llui-x\n\n`
  }

  const tailRoot = parse(injected + source.slice(cut))
  const injectedLen = injected.length
  const injectedLines = countNewlines(injected, injectedLen)
  const offsetDelta = cut - injectedLen
  const lineDelta = countNewlines(source, cut) - injectedLines

  const tailChildren: RootContent[] = []
  for (const child of tailRoot.children) {
    if ((child.position?.start?.offset ?? 0) < injectedLen) continue // drop injected defs
    shiftPositions(child, offsetDelta, lineDelta)
    tailChildren.push(child)
  }

  const root: Root = { type: 'root', children: [...reused, ...tailChildren] }

  // A label added or removed anywhere can reclassify earlier text (`[a][r]` /
  // `word[^1]` are literal until defined). If the label id-set changed, the reused
  // prefix may be stale — fall back to a full parse.
  if (!sameSet(collectLabelIds(oldRoot.children), collectLabelIds(root.children))) {
    return full()
  }

  return { root, cache: { source, root }, reused: reuseCount }
}
