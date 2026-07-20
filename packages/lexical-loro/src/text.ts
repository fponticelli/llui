/**
 * Text: format-bitmask ↔ named-Loro-mark conversion, the run diff that replays
 * Lexical's resulting state, and a cursor-biased string diff.
 *
 * ── Why formats are DECOMPOSED into named marks ────────────────────────────
 *
 * `TextNode.__format` is a bitmask. Storing it as ONE Loro value makes two peers
 * concurrently toggling bold and italic on overlapping ranges a last-writer-wins
 * conflict that SILENTLY DROPS one of them. Stored as independent named marks
 * (`bold`, `italic`, …) the same edit converges to the union. This is measured
 * in `test/expand-semantics.test.ts` §4, both the working and the broken form.
 *
 * The bit values are derived from Lexical's `TEXT_TYPE_TO_FORMAT` at runtime —
 * never hardcoded, so a Lexical release that renumbers or adds a format is a
 * compile/boot-time failure here rather than silent corruption.
 *
 * ── Why the outbound direction replays STATE, not keystrokes ───────────────
 *
 * Loro's `expand` rule cannot reproduce Lexical's boundary behaviour: no uniform
 * table works, and no PER-FORMAT table can either, because the divergence set is
 * identical for all 11 formats — Lexical has no per-format inclusivity, its
 * caret is uniformly left-biased (`LexicalSelection.ts:3164-3204`). Three cases
 * are unreachable by any table:
 *
 *   1. typing at index 0 of a formatted first run
 *   2. a format toggled ON at a collapsed caret
 *   3. a format toggled OFF at a collapsed caret
 *
 * So after each Lexical update we diff the RESULTING TextNode runs against what
 * Loro currently holds and emit explicit `mark`/`unmark` ops for every format
 * bit that differs — {@link diffRunFormats}. `expand` then governs only what
 * happens to text a REMOTE peer inserts concurrently at a mark boundary.
 *
 * ── Index units ────────────────────────────────────────────────────────────
 *
 * All offsets here are UTF-16 code units: JavaScript string indices, Lexical
 * offsets, and loro-crdt's JS text indices all agree (pinned in
 * `test/schema.test.ts`). No conversion at this seam.
 */

import { TEXT_TYPE_TO_FORMAT, type TextFormatType } from 'lexical'
import type { LoroText } from 'loro-crdt'

// ---------------------------------------------------------------------------
// Format vocabulary
// ---------------------------------------------------------------------------

/**
 * The Lexical text formats a Loro binding represents, in bit order (see
 * Lexical's `LexicalConstants.ts`). Each becomes an INDEPENDENT named mark.
 */
export const LORO_TEXT_FORMATS = [
  'bold',
  'italic',
  'strikethrough',
  'underline',
  'code',
  'subscript',
  'superscript',
  'highlight',
  'lowercase',
  'uppercase',
  'capitalize',
] as const

export type LoroTextFormat = (typeof LORO_TEXT_FORMATS)[number]

/**
 * Mark name → bit value, derived from Lexical rather than hardcoded.
 *
 * Built eagerly so a format this package names but Lexical does not define
 * fails at module load — a loud boot error instead of a format that silently
 * never round-trips.
 */
export const FORMAT_BITS: Readonly<Record<LoroTextFormat, number>> = Object.freeze(
  Object.fromEntries(
    LORO_TEXT_FORMATS.map((format) => {
      const bit = TEXT_TYPE_TO_FORMAT[format as TextFormatType]
      if (bit === undefined) {
        throw new Error(
          `lexical-loro: Lexical does not define the text format '${format}' — ` +
            'LORO_TEXT_FORMATS is out of sync with TEXT_TYPE_TO_FORMAT',
        )
      }
      return [format, bit]
    }),
  ) as Record<LoroTextFormat, number>,
)

/** Every bit this binding knows how to represent. */
export const KNOWN_FORMAT_MASK: number = LORO_TEXT_FORMATS.reduce(
  (mask, format) => mask | FORMAT_BITS[format],
  0,
)

/** The bit value of a named format. */
export function formatBit(format: LoroTextFormat): number {
  return FORMAT_BITS[format]
}

/** Decompose a Lexical bitmask into the named marks it sets, in bit order. */
export function formatsFromBitmask(bitmask: number): LoroTextFormat[] {
  return LORO_TEXT_FORMATS.filter((format) => (bitmask & FORMAT_BITS[format]) !== 0)
}

/** Recompose named marks into a Lexical bitmask. */
export function bitmaskFromFormats(formats: Iterable<LoroTextFormat>): number {
  let bitmask = 0
  for (const format of formats) bitmask |= FORMAT_BITS[format]
  return bitmask
}

/**
 * Read a Loro delta's attribute bag as a Lexical bitmask.
 *
 * Only `true` counts as set: Loro represents an unmark as an explicit `null`
 * attribute in the delta, which must read as OFF, not as "present".
 */
export function bitmaskFromAttributes(
  attributes: Readonly<Record<string, unknown>> | undefined,
): number {
  if (attributes === undefined) return 0
  let bitmask = 0
  for (const format of LORO_TEXT_FORMATS) {
    if (attributes[format] === true) bitmask |= FORMAT_BITS[format]
  }
  return bitmask
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

/** A maximal stretch of text sharing one Lexical format bitmask. */
export interface TextRun {
  readonly text: string
  readonly format: number
}

/** Concatenated text of a run list. */
export function runsText(runs: readonly TextRun[]): string {
  return runs.map((run) => run.text).join('')
}

/**
 * Coalesce adjacent equal-format runs and drop empty ones, so two run lists
 * describing the same content compare structurally equal.
 *
 * Necessary because Lexical's node boundaries are a rendering detail: `ab`+`c`
 * and `abc` at the same format are the same document.
 */
export function normalizeRuns(runs: readonly TextRun[]): TextRun[] {
  const out: TextRun[] = []
  for (const run of runs) {
    if (run.text === '') continue
    const last = out[out.length - 1]
    if (last !== undefined && last.format === run.format) {
      out[out.length - 1] = { text: last.text + run.text, format: last.format }
    } else {
      out.push({ text: run.text, format: run.format })
    }
  }
  return out
}

/** A Loro text delta item, as returned by `LoroText#toDelta`. */
export interface TextDeltaItem {
  readonly insert?: unknown
  readonly attributes?: Readonly<Record<string, unknown>>
}

/** Project a `LoroText`'s delta into normalized Lexical-shaped runs. */
export function runsFromDelta(delta: readonly TextDeltaItem[]): TextRun[] {
  return normalizeRuns(
    delta.map((item) => ({
      text: String(item.insert ?? ''),
      format: bitmaskFromAttributes(item.attributes),
    })),
  )
}

/** Project a live `LoroText` into normalized Lexical-shaped runs. */
export function runsFromText(text: LoroText): TextRun[] {
  return runsFromDelta(text.toDelta() as readonly TextDeltaItem[])
}

/**
 * Expand runs into a per-character bitmask array.
 *
 * Per-character is what makes the run diff correct without special-casing:
 * the two sides may be segmented completely differently (Lexical split a node
 * where Loro did not), and comparing per character makes segmentation moot.
 */
function bitmaskPerCharacter(runs: readonly TextRun[]): number[] {
  const out: number[] = []
  for (const run of runs) {
    for (let i = 0; i < run.text.length; i++) out.push(run.format)
  }
  return out
}

// ---------------------------------------------------------------------------
// Run-format diff — the outbound replay
// ---------------------------------------------------------------------------

/** An explicit format operation to apply to a `LoroText`. */
export interface MarkOp {
  readonly kind: 'mark' | 'unmark'
  /** Inclusive UTF-16 start offset. */
  readonly start: number
  /** Exclusive UTF-16 end offset. */
  readonly end: number
  readonly format: LoroTextFormat
}

/**
 * Diff two run lists into the minimal explicit `mark`/`unmark` ops that turn
 * `current` into `target`.
 *
 * `current` is what Loro holds after the text edit landed (so `expand` has
 * already had its say); `target` is the runs Lexical actually produced. Both
 * MUST describe the same character count — call this only after the text
 * content has been reconciled.
 *
 * Each format is diffed INDEPENDENTLY (that is the whole point of decomposing
 * the bitmask) and differing characters are coalesced into maximal ranges, so a
 * whole-paragraph bolding is one op, not one per character.
 */
export function diffRunFormats(current: readonly TextRun[], target: readonly TextRun[]): MarkOp[] {
  const from = bitmaskPerCharacter(current)
  const to = bitmaskPerCharacter(target)
  if (from.length !== to.length) {
    throw new Error(
      `lexical-loro: diffRunFormats requires equal-length runs — ` +
        `current has ${from.length} chars, target has ${to.length}; ` +
        'reconcile the text content before diffing formats',
    )
  }

  const ops: MarkOp[] = []
  for (const format of LORO_TEXT_FORMATS) {
    const bit = FORMAT_BITS[format]
    let start = -1
    let openKind: MarkOp['kind'] = 'mark'
    // Iterate one PAST the end so a range still open at the last character is
    // closed by the same branch as any other, with no duplicated tail logic.
    for (let i = 0; i <= from.length; i++) {
      let kind: MarkOp['kind'] | undefined
      if (i < from.length) {
        const wanted = (to[i]! & bit) !== 0
        const has = (from[i]! & bit) !== 0
        if (wanted !== has) kind = wanted ? 'mark' : 'unmark'
      }
      if (start !== -1 && kind !== openKind) {
        ops.push({ kind: openKind, start, end: i, format })
        start = -1
      }
      if (kind !== undefined && start === -1) {
        start = i
        openKind = kind
      }
    }
  }
  return ops
}

/**
 * Apply {@link MarkOp}s to a `LoroText`. The caller owns the surrounding
 * transaction (`doc.commit`), so a whole Lexical update lands as one Loro
 * change and therefore as one remote event batch.
 */
export function applyMarkOps(text: LoroText, ops: readonly MarkOp[]): void {
  for (const op of ops) {
    if (op.kind === 'mark') text.mark({ start: op.start, end: op.end }, op.format, true)
    else text.unmark({ start: op.start, end: op.end }, op.format)
  }
}

// ---------------------------------------------------------------------------
// Cursor-biased string diff
// ---------------------------------------------------------------------------

/** A single-region string edit: delete `remove` chars at `index`, insert `insert`. */
export interface TextDiff {
  /** UTF-16 offset at which the change applies. */
  readonly index: number
  /** Number of UTF-16 code units to delete at `index`. */
  readonly remove: number
  /** Text to insert at `index` after the deletion. */
  readonly insert: string
}

const HIGH_SURROGATE = /[\uD800-\uDBFF]/
const LOW_SURROGATE = /[\uDC00-\uDFFF]/

/**
 * Diff `a` → `b`, biased to place the change at `cursor`.
 *
 * A plain "common prefix / common suffix" diff is ambiguous whenever the edit
 * sits next to repeated characters: typing `o` in `foo` could be described as an
 * insert at index 1, 2 or 3, and the plain diff always picks the leftmost. Every
 * peer then sees the character inserted at the wrong place, which drags remote
 * carets and (through Loro's `expand`) can even attach the wrong formatting.
 *
 * Biasing the prefix scan to stop AT the cursor resolves the ambiguity in favour
 * of where the user actually typed. `@lexical/yjs` uses `simpleDiffWithCursor`
 * for exactly this reason; this is that algorithm (lib0's
 * `simpleDiffStringWithCursor`), including its surrogate-pair rollbacks, ported
 * so the package carries no lib0 dependency.
 *
 * Surrogate handling: the scans never stop between the halves of a surrogate
 * pair, so an astral character is always inserted or deleted whole.
 *
 * @param cursor UTF-16 offset of the caret in `b` (the new string).
 */
export function diffTextWithCursor(a: string, b: string, cursor: number): TextDiff {
  let left = 0
  let right = 0
  // Scan the common prefix, but stop at the cursor: the user's caret marks
  // where the change really is.
  while (left < a.length && left < b.length && a[left] === b[left] && left < cursor) left++
  if (left > 0 && HIGH_SURROGATE.test(a[left - 1]!)) left--
  // Scan the common suffix.
  while (
    right + left < a.length &&
    right + left < b.length &&
    a[a.length - right - 1] === b[b.length - right - 1]
  )
    right++
  if (right > 0 && LOW_SURROGATE.test(a[a.length - right]!)) right--
  // Resume the prefix scan past the cursor — anything still common there is not
  // part of the edit, and leaving it in would make the diff larger than needed.
  while (right + left < a.length && right + left < b.length && a[left] === b[left]) left++
  if (left > 0 && HIGH_SURROGATE.test(a[left - 1]!)) left--
  return { index: left, remove: a.length - left - right, insert: b.slice(left, b.length - right) }
}

/**
 * Cursor-free variant: the change is placed as far LEFT as possible.
 *
 * Equivalent to lib0's `simpleDiffString`. Use it only where no caret is known
 * (a programmatic document change); prefer {@link diffTextWithCursor} on any
 * user-typing path, where the leftmost placement is exactly the wrong guess.
 */
export function diffText(a: string, b: string): TextDiff {
  return diffTextWithCursor(a, b, 0)
}

/**
 * Apply a {@link TextDiff} to a `LoroText`. A no-op diff writes nothing, so a
 * Lexical update that changed only formatting produces no text ops (and so no
 * spurious remote text event).
 */
export function applyTextDiff(text: LoroText, diff: TextDiff): void {
  if (diff.remove > 0) text.delete(diff.index, diff.remove)
  if (diff.insert !== '') text.insert(diff.index, diff.insert)
}
