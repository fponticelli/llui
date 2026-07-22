/**
 * Agent-write: reconcile an AGENT-AUTHORED full-document rewrite into an existing
 * Loro document without tearing down history.
 *
 * ── The problem ────────────────────────────────────────────────────────────
 *
 * An LLM rewrites a note's WHOLE markdown. The naive route — reparse the new
 * markdown into the live bound editor (`root.clear()` + rebuild) — mints a fresh
 * `NodeKey` for every node, so the outbound sync (`to-loro.ts`) matches nothing
 * through the `NodeKey → ContainerID` registry and recreates EVERY container.
 * A concurrent edit from another window merges into a container this side just
 * deleted and is lost; a mounted `LLuiDecoratorNode` sub-app under any block is
 * torn down. Measured at 0% ContainerID survival even for IDENTICAL markdown.
 *
 * ── The design ─────────────────────────────────────────────────────────────
 *
 * Reconcile a PARSED TARGET TREE directly against the existing Loro document,
 * matching existing child carriers to target children by CONTENT rather than by
 * NodeKey. Unchanged blocks keep their `ContainerID`s (and therefore their
 * `NodeKey`s and decorator mounts on the inbound bounce); a text-changed block
 * keeps its `LoroText` and diffs the characters; only genuinely new/removed/moved
 * blocks touch the ordering. This is the analog of loro-prosemirror's
 * content-equality match (`eqLoroObjNode`), living where the reconciler already
 * is.
 *
 * This is a SIBLING to the outbound sync ({@link import('./to-loro.js')}), not a
 * replacement: it writes the Loro document directly under {@link
 * AGENT_WRITE_ORIGIN}, and the existing inbound path ({@link
 * import('./to-lexical.js')}) replicates that change into any live editor bound
 * to the same document — preserving `NodeKey`s and decorator mounts on the
 * bounce, and self-healing the `ContainerID ↔ NodeKey` mapping there. For that
 * bounce to happen, {@link AGENT_WRITE_ORIGIN} must be on the inbound target's
 * list of local origins to apply; `binding.ts` wires that.
 *
 * ── What this deliberately does NOT consult ────────────────────────────────
 *
 * The `ContainerNodeMap` registry is intentionally NOT read here — content
 * matching is the whole point, and the mapping self-heals on the inbound bounce.
 * (Contrast `to-loro.ts`, whose whole job is IDENTITY matching through that
 * registry.)
 *
 * ── Where the markdown parse lives ─────────────────────────────────────────
 *
 * The markdown → target-tree PARSE is the CALLER's job, because it is
 * caller-specific: the caller owns its custom nodes and its own `@lexical/markdown`
 * transformer set, and that transformer set defines the tree. This module pulls
 * neither `@lexical/markdown` nor `@lexical/headless` (both would otherwise become
 * runtime dependencies of a binding whose core — the reconciler — needs neither).
 * The caller parses markdown headlessly with its own transformers and projects the
 * resulting Lexical tree with {@link projectTarget} (or {@link
 * targetFromEditorState}), then hands the plain, serializable {@link TargetElement}
 * to {@link reconcileTargetIntoLoro}. The reconciler is the reusable core; the
 * markdown parse is not.
 */

import {
  $getRoot,
  $isElementNode,
  $isTextNode,
  type EditorState,
  type ElementNode,
  type LexicalNode,
  type TextNode,
} from 'lexical'
import type { LoroDoc, LoroText } from 'loro-crdt'

import { allocate, jitterFor } from './order.js'
import {
  createElementChild,
  createTextChild,
  deleteChild,
  elementChildren,
  elementProps,
  elementType,
  isTextContainer,
  newUuid,
  orderedChildren,
  setChildPosition,
  type ChildContainer,
  type ChildEntry,
  type ChildrenContainer,
  type ElementContainer,
  type PropValue,
} from './schema.js'
import {
  applyMarkOps,
  applyTextDiff,
  diffRunFormats,
  diffText,
  normalizeRuns,
  runsFromText,
  runsText,
  type TextRun,
} from './text.js'

// ---------------------------------------------------------------------------
// The target tree
// ---------------------------------------------------------------------------

/** A maximal run of adjacent text nodes — the schema's text unit (see `schema.ts`). */
export interface TargetText {
  readonly kind: 'text'
  readonly runs: readonly TextRun[]
}

/**
 * A Lexical element (paragraph/heading/list/…) or a leaf mirrored as an element
 * (`LineBreakNode`, `LLuiDecoratorNode`) whose payload lives entirely in `props`.
 */
export interface TargetElement {
  readonly kind: 'element'
  readonly type: string
  readonly props: Readonly<Record<string, PropValue>>
  readonly children: readonly TargetChild[]
}

/** One child of a target element: a text run or a nested element. */
export type TargetChild = TargetText | TargetElement

/** Lexical node props that are structure/bookkeeping, never document data. */
const NON_PROP_KEYS: ReadonlySet<string> = new Set(['type', 'version', 'children'])

/**
 * Normalize an `exportJSON` value into a stored {@link PropValue}, dropping
 * `undefined` exactly as `to-loro.ts`'s `syncProps` does — so a target block's
 * props signature equals what the Loro container already holds.
 */
function toProp(value: unknown): PropValue {
  if (value === null) return null
  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
      return value
    case 'object': {
      if (Array.isArray(value)) return value.map(toProp)
      const out: Record<string, PropValue> = {}
      for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
        if (inner === undefined) continue
        out[key] = toProp(inner)
      }
      return out
    }
    default:
      throw new Error(
        `lexical-loro: agent-write cannot store a non-JSON prop value (${typeof value})`,
      )
  }
}

/** The document-data props of a Lexical node, mirroring `to-loro.ts`'s `syncProps`. */
function propsOf(node: LexicalNode): Record<string, PropValue> {
  const json = node.exportJSON() as Record<string, unknown>
  const out: Record<string, PropValue> = {}
  for (const [key, value] of Object.entries(json)) {
    if (NON_PROP_KEYS.has(key) || value === undefined) continue
    out[key] = toProp(value)
  }
  return out
}

/**
 * Project one Lexical element (or element-mirrored leaf) to a {@link TargetElement}.
 *
 * MUST be called inside a Lexical read (`editorState.read(() => …)`), because it
 * reads node content. Uses only `lexical` (a peer dependency) — never
 * `@lexical/markdown`. See {@link targetFromEditorState} for the common wrapper.
 */
export function projectTarget(node: LexicalNode): TargetElement {
  const props = propsOf(node)
  if (!$isElementNode(node)) return { kind: 'element', type: node.getType(), props, children: [] }

  const children: TargetChild[] = []
  let run: TextNode[] = []
  const flush = (): void => {
    if (run.length === 0) return
    children.push({
      kind: 'text',
      runs: normalizeRuns(run.map((n) => ({ text: n.getTextContent(), format: n.getFormat() }))),
    })
    run = []
  }
  for (const child of (node as ElementNode).getChildren()) {
    // Only a PLAIN TextNode joins a text run (which stores just text + format). A
    // TextNode SUBCLASS (wikilink token, mention, …) carries extra state — merged
    // into a run it is flattened to bare text, dropping e.g. a wikilink's target.
    // Project it as its own carrier (`props` = exportJSON) so it round-trips via
    // importJSON. Mirrors the same guard in `to-loro.ts` / `to-lexical.ts`.
    if ($isTextNode(child) && child.getType() === 'text') {
      run.push(child)
    } else {
      flush()
      children.push(projectTarget(child))
    }
  }
  flush()
  return { kind: 'element', type: node.getType(), props, children }
}

/**
 * Project the root of an `EditorState` to a {@link TargetElement}, doing the read
 * for you.
 *
 * The caller owns the markdown → editor-state parse (its own headless editor and
 * `@lexical/markdown` transformer set); this projects the parsed tree into the
 * plain, serializable shape {@link reconcileTargetIntoLoro} consumes. Uses only
 * `lexical`.
 */
export function targetFromEditorState(state: EditorState): TargetElement {
  let target: TargetElement | undefined
  state.read(() => {
    target = projectTarget($getRoot())
  })
  if (target === undefined)
    throw new Error('lexical-loro: agent-write failed to project editor state')
  return target
}

// ---------------------------------------------------------------------------
// Content signatures
// ---------------------------------------------------------------------------

/** Canonical, sort-stable JSON of a prop value, so equal content compares equal. */
function stableProps(value: PropValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableProps).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableProps(value[k]!)}`).join(',')}}`
}

function runsSignature(runs: readonly TextRun[]): string {
  return `T|${JSON.stringify(normalizeRuns(runs).map((r) => [r.text, r.format]))}`
}

/** The content signature of a target child — identical content ⇒ identical string. */
function targetSignature(child: TargetChild): string {
  if (child.kind === 'text') return runsSignature(child.runs)
  return `E|${child.type}|${stableProps(child.props)}|[${child.children
    .map(targetSignature)
    .join(',')}]`
}

/** The content signature of an existing carrier — the mirror of {@link targetSignature}. */
function entrySignature(entry: ChildEntry): string {
  if (entry.kind === 'text' && isTextContainer(entry.container)) {
    return runsSignature(runsFromText(entry.container))
  }
  const container = entry.container as ElementContainer
  const props = elementProps(container).toJSON() as Record<string, PropValue>
  return `E|${elementType(container)}|${stableProps(props)}|[${orderedChildren(container)
    .map(entrySignature)
    .join(',')}]`
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/** How a target child was resolved against the existing carriers. */
type MatchTag = 'exact' | 'reuse' | 'new'

interface Match {
  /** The reused carrier, or `null` when the child must be created. */
  readonly entry: ChildEntry | null
  readonly tag: MatchTag
}

/** The Lexical type a target element maps a carrier to (text runs share `'#text'`). */
function targetKindKey(child: TargetChild): string {
  return child.kind === 'text' ? '#text' : `E:${child.type}`
}

function entryKindKey(entry: ChildEntry): string {
  return entry.kind === 'text' ? '#text' : `E:${elementType(entry.container as ElementContainer)}`
}

/** An existing carrier paired with its rendered index, for the position bias. */
interface Carrier {
  readonly entry: ChildEntry
  readonly index: number
}

/**
 * Match desired children to existing carriers by CONTENT, in two passes:
 *
 *  1. EXACT signature — an unchanged subtree keeps its whole identity and needs
 *     no descent. Within a group of byte-identical carriers the match is biased
 *     toward the SAME POSITION: each target claims the same-signature carrier
 *     whose rendered index is nearest the target's own index. This is the
 *     duplicate-block mitigation — a still-identical sibling keeps its OWN carrier
 *     rather than an arbitrary same-content one, so the block the user CHANGED is
 *     the one whose carrier is freed for reuse.
 *  2. SAME-KIND fallback — a leftover carrier of the same type/text-kind is
 *     reused for a changed block, so a text edit diffs its `LoroText` and an
 *     element edit recurses, rather than deleting and recreating.
 *
 * Whatever is still unmatched is created (desired) or deleted (existing).
 *
 * ── The residual, stated honestly ──────────────────────────────────────────
 *
 * Position bias reduces, but CANNOT eliminate, mis-assignment among TRUE
 * duplicates. When the count of a byte-identical group changes (e.g. one of three
 * identical paragraphs is deleted), content is by definition insufficient to say
 * WHICH carrier the user meant to keep, and position proximity is only a guess;
 * the trailing carrier is dropped regardless of intent. `NodeKey` identity — which
 * the agent path does not have, since the agent hands us markdown, not an edited
 * editor state — is the only complete answer. See the duplicate-block tests.
 */
function matchChildren(current: readonly ChildEntry[], desired: readonly TargetChild[]): Match[] {
  const matched = new Array<Match>(desired.length).fill({ entry: null, tag: 'new' })
  const claimed = new Set<ChildEntry>()

  // Pass 1: exact content signature, biased toward the same rendered position.
  const bySig = new Map<string, Carrier[]>()
  for (let index = 0; index < current.length; index++) {
    const entry = current[index]!
    const sig = entrySignature(entry)
    const bucket = bySig.get(sig)
    if (bucket === undefined) bySig.set(sig, [{ entry, index }])
    else bucket.push({ entry, index })
  }
  for (let i = 0; i < desired.length; i++) {
    const bucket = bySig.get(targetSignature(desired[i]!))
    if (bucket === undefined || bucket.length === 0) continue
    // Take the same-content carrier nearest this target's index (position bias),
    // ties resolved toward the earlier carrier.
    let best = 0
    let bestDistance = Math.abs(bucket[0]!.index - i)
    for (let b = 1; b < bucket.length; b++) {
      const distance = Math.abs(bucket[b]!.index - i)
      if (distance < bestDistance) {
        best = b
        bestDistance = distance
      }
    }
    const [carrier] = bucket.splice(best, 1)
    matched[i] = { entry: carrier!.entry, tag: 'exact' }
    claimed.add(carrier!.entry)
  }

  // Pass 2: same-kind fallback for changed blocks.
  const byKind = new Map<string, ChildEntry[]>()
  for (const entry of current) {
    if (claimed.has(entry)) continue
    const key = entryKindKey(entry)
    const bucket = byKind.get(key)
    if (bucket === undefined) byKind.set(key, [entry])
    else bucket.push(entry)
  }
  for (let i = 0; i < desired.length; i++) {
    if (matched[i]!.entry !== null) continue
    const entry = byKind.get(targetKindKey(desired[i]!))?.shift()
    if (entry === undefined) continue
    matched[i] = { entry, tag: 'reuse' }
    claimed.add(entry)
  }

  return matched
}

// ---------------------------------------------------------------------------
// Placement (fractional-index, batch, never-rebalance)
// ---------------------------------------------------------------------------

interface Context {
  readonly doc: LoroDoc
  readonly jitter: string
  ops: number
}

/**
 * Longest strictly-increasing subsequence indices — the reorder planner, so a
 * move rewrites only genuinely displaced `pos` keys. Mirrors `to-loro.ts`.
 */
function longestIncreasingSubsequence(values: readonly number[]): number[] {
  if (values.length === 0) return []
  const tails: number[] = []
  const previous = new Array<number>(values.length).fill(-1)
  for (let i = 0; i < values.length; i++) {
    let low = 0
    let high = tails.length
    while (low < high) {
      const mid = (low + high) >> 1
      if (values[tails[mid]!]! < values[i]!) low = mid + 1
      else high = mid
    }
    if (low > 0) previous[i] = tails[low - 1]!
    tails[low] = i
  }
  const out = new Array<number>(tails.length)
  let cursor = tails[tails.length - 1]!
  for (let i = tails.length - 1; i >= 0; i--) {
    out[i] = cursor
    cursor = previous[cursor]!
  }
  return out
}

/** Dense ranks so equal positions share a rank and the strict LIS keeps at most one. */
function positionRanks(positions: readonly string[]): number[] {
  const distinct = [...new Set(positions)].sort()
  const rank = new Map(distinct.map((pos, index) => [pos, index]))
  return positions.map((pos) => rank.get(pos)!)
}

/**
 * Assign every desired child a position: keep the already-ordered survivors,
 * re-position the rest, create the ones with no carrier — one maximal gap at a
 * time so a multi-block insertion is allocated as ONE batch (never interleaves a
 * concurrent paste, and never rebalances). Mirrors `to-loro.ts`'s `placeChildren`.
 */
function placeChildren(
  children: ChildrenContainer,
  desired: readonly TargetChild[],
  matched: readonly Match[],
  context: Context,
): ChildContainer[] {
  const survivorIndices: number[] = []
  for (let i = 0; i < desired.length; i++) if (matched[i]!.entry !== null) survivorIndices.push(i)

  const ranks = positionRanks(survivorIndices.map((i) => matched[i]!.entry!.pos))
  const keep = new Set<number>()
  for (const index of longestIncreasingSubsequence(ranks)) keep.add(survivorIndices[index]!)

  const placed = new Array<ChildContainer>(desired.length)
  for (const index of keep) placed[index] = matched[index]!.entry!.container

  let i = 0
  while (i < desired.length) {
    if (keep.has(i)) {
      i++
      continue
    }
    let end = i
    while (end < desired.length && !keep.has(end)) end++
    const before = i === 0 ? null : matched[i - 1]!.entry!.pos
    const after = end === desired.length ? null : matched[end]!.entry!.pos
    const keys = allocate(before, after, end - i, context.jitter)
    for (let j = i; j < end; j++) {
      const key = keys[j - i]!
      const entry = matched[j]!.entry
      if (entry === null) {
        placed[j] = createChild(children, desired[j]!, key, context)
        continue
      }
      setChildPosition(entry.carrier, key)
      context.ops++
      placed[j] = entry.container
    }
    i = end
  }
  return placed
}

// ---------------------------------------------------------------------------
// Reconcile
// ---------------------------------------------------------------------------

/**
 * Commit origin stamped on the single agent-write commit.
 *
 * Distinct from `to-loro.ts`'s `OUTBOUND_ORIGIN` so the inbound path can tell an
 * agent write apart from an echo of its own outbound write: `binding.ts` lists
 * this origin among the LOCAL batches the inbound path must still APPLY, which is
 * what bounces an agent write into a live editor (preserving `NodeKey`s and
 * decorator mounts).
 */
export const AGENT_WRITE_ORIGIN = 'agent-write'

/**
 * Reconcile a parsed target tree into an existing Loro document, preserving the
 * `ContainerID`s of unchanged and text-edited blocks, and commit under `origin`.
 *
 * A SIBLING to `syncLexicalToLoro` — it writes Loro directly rather than mirroring
 * a Lexical update, matches by CONTENT rather than by `NodeKey`, and does NOT
 * consult the `ContainerNodeMap` (which self-heals on the inbound bounce).
 *
 * @param doc    the shared document.
 * @param root   its root element container, as returned by `initDoc`.
 * @param target the desired tree, from {@link targetFromEditorState} /
 *               {@link projectTarget} (the caller owns the markdown parse).
 * @param origin the commit origin. Defaults to {@link AGENT_WRITE_ORIGIN}; keep
 *               it on the inbound target's applied-local-origins list, or a live
 *               editor bound to the same doc will not see the change.
 * @returns the number of Loro write ops emitted. `0` means the target already
 *          matched the document — nothing committed, no peer sees an event.
 */
export function reconcileTargetIntoLoro(
  doc: LoroDoc,
  root: ElementContainer,
  target: TargetElement,
  origin: string = AGENT_WRITE_ORIGIN,
): number {
  const context: Context = { doc, jitter: jitterFor(doc.peerId), ops: 0 }
  reconcileElement(root, target, context)
  if (context.ops > 0) doc.commit({ origin })
  return context.ops
}

function reconcileElement(
  container: ElementContainer,
  target: TargetElement,
  context: Context,
): void {
  syncProps(container, target.props, context)
  reconcileChildren(container, orderedChildren(container), target.children, context)
}

function syncProps(
  container: ElementContainer,
  target: Readonly<Record<string, PropValue>>,
  context: Context,
): void {
  const props = elementProps(container)
  const seen = new Set<string>()
  for (const [key, value] of Object.entries(target)) {
    seen.add(key)
    if (jsonEqual(props.get(key), value)) continue
    props.set(key, value)
    context.ops++
  }
  for (const key of props.keys()) {
    if (seen.has(key)) continue
    props.delete(key)
    context.ops++
  }
}

function reconcileChildren(
  container: ElementContainer,
  current: readonly ChildEntry[],
  desired: readonly TargetChild[],
  context: Context,
): void {
  const children = elementChildren(container)
  const matched = matchChildren(current, desired)
  const survivors = new Set(matched.map((m) => m.entry).filter((e): e is ChildEntry => e !== null))

  // Delete carriers no target child reused. A carrier is addressed by uuid, so
  // deleting one cannot shift another.
  for (const entry of current) {
    if (survivors.has(entry)) continue
    deleteChild(children, entry.uuid)
    context.ops++
  }

  const placed = placeChildren(children, desired, matched, context)

  // Descend: exact matches are unchanged (no work); reused carriers get a text
  // diff or a recursive element reconcile.
  for (let i = 0; i < desired.length; i++) {
    const match = matched[i]!
    if (match.tag !== 'reuse') continue
    const child = desired[i]!
    const containerAt = placed[i]!
    if (child.kind === 'text') {
      if (isTextContainer(containerAt)) syncText(containerAt, child.runs, context)
    } else if (!isTextContainer(containerAt)) {
      reconcileElement(containerAt, child, context)
    }
  }
}

/**
 * Fill a text run's `LoroText` to `runs`: diff the characters (no caret — an
 * agent edit has none), then replay the resulting formats as `mark`/`unmark`.
 * Mirrors `to-loro.ts`'s `syncText` minus the cursor bias.
 */
function syncText(text: LoroText, runs: readonly TextRun[], context: Context): void {
  const target = normalizeRuns(runs.map((r) => ({ text: r.text, format: r.format })))
  const targetString = runsText(target)
  if (text.toString() !== targetString) {
    const diff = diffText(text.toString(), targetString)
    applyTextDiff(text, diff)
    if (diff.remove > 0) context.ops++
    if (diff.insert !== '') context.ops++
  }
  const ops = diffRunFormats(runsFromText(text), target)
  applyMarkOps(text, ops)
  context.ops += ops.length
}

/** Create, attach and fill a brand-new child at position `pos`. */
function createChild(
  children: ChildrenContainer,
  child: TargetChild,
  pos: string,
  context: Context,
): ChildContainer {
  context.ops++
  const uuid = newUuid()
  if (child.kind === 'text') {
    const text = createTextChild(children, uuid, pos)
    syncText(text, child.runs, context)
    return text
  }
  const element = createElementChild(children, uuid, pos, child.type)
  reconcileElement(element, child, context)
  return element
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => jsonEqual(item, b[i]))
  }
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  return keys.every((key) => key in right && jsonEqual(left[key], right[key]))
}
