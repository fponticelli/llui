// Shared text-edit application — one offset-safe splicer used by both the signal
// transform (view lowering) and the lint autofix path, so the back-to-front
// ordering logic lives in exactly one place.

import MagicString from 'magic-string'
import type { SourceMap } from 'magic-string'

/** A text replacement expressed as a half-open `[start, end)` char-offset range
 * into the source, plus the text to put there (empty string = deletion). */
export interface TextEdit {
  start: number
  end: number
  text: string
}

/** Code + a real source map produced by {@link applyEditsWithMap}. */
export interface AppliedWithMap {
  code: string
  map: SourceMap
}

/**
 * Apply `edits` (and an optional `prepend`, e.g. the injected runtime import)
 * through ONE MagicString instance so the returned source map is coherent across
 * every splice. Replacements map to the start of their original span; the prepend
 * has no original counterpart (added content). Edits are assumed non-overlapping
 * — the transform guarantees this (nested-component containment + pass1/pass2
 * discipline). An insertion (`start === end`) is applied as a left-append.
 */
export function applyEditsWithMap(
  source: string,
  edits: readonly TextEdit[],
  opts: { fileName: string; prepend?: string },
): AppliedWithMap {
  const ms = new MagicString(source)
  for (const e of edits) {
    if (e.start === e.end) ms.appendLeft(e.start, e.text)
    else ms.overwrite(e.start, e.end, e.text)
  }
  if (opts.prepend) ms.prepend(opts.prepend)
  const map = ms.generateMap({ source: opts.fileName, includeContent: true, hires: true })
  return { code: ms.toString(), map }
}

/**
 * Apply `edits` to `source`, back-to-front so each splice leaves the offsets of
 * the not-yet-applied (earlier) edits valid. Edits are assumed non-overlapping;
 * see {@link mergeNonOverlapping} for callers that may produce overlaps. The
 * input array is not mutated.
 */
export function applyTextEdits(source: string, edits: readonly TextEdit[]): string {
  let out = source
  for (const e of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end)
  }
  return out
}

/**
 * Drop edits that overlap an already-kept edit, scanning in document order so the
 * earliest edit at any position wins. Returns the kept set (sorted by start) and
 * the count skipped — lets a caller apply a best-effort batch without corrupting
 * the source when two fixes target the same span.
 */
export function mergeNonOverlapping(edits: readonly TextEdit[]): {
  kept: TextEdit[]
  skipped: number
} {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end)
  const kept: TextEdit[] = []
  let lastEnd = -1
  let skipped = 0
  for (const e of sorted) {
    if (e.start < lastEnd) {
      skipped++
      continue
    }
    kept.push(e)
    lastEnd = e.end
  }
  return { kept, skipped }
}
