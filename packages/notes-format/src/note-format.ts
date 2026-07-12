// Pure note-format helpers — the canonical home for the on-disk format
// rules (filename derivation, slug, session naming, status replay).
//
// These are fs-free and DOM-free so BOTH the server store
// (@llui/vite-plugin's filesystem notebook) and browser stores
// (indexedDbStore, export bundles) derive identical ids, filenames, and
// queue state from the same source. The on-disk contract is
// docs/proposals/devmode-annotate/01-on-disk-format.md.

import type { Author, NoteKind, NoteStatus, StatusTransition } from './note-types.js'

/**
 * On-disk note-format schema version. Stamped into export bundles and
 * checked on dev import so a producer and consumer never silently disagree.
 * v2 = the current "body under a `body:` frontmatter key" format (v1 was the
 * legacy trailing-```json fence, still readable by `parseNote`).
 */
export const NOTE_SCHEMA_VERSION = 2

// ── Slug derivation ───────────────────────────────────────────────────────
// First 3-4 content words of the prose, stopwords stripped, sanitized to
// [a-z0-9-], capped at 32 chars, "capture" fallback.

const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'of',
  'to',
  'in',
  'on',
  'at',
  'for',
  'and',
  'or',
  'but',
  'with',
  'by',
  'from',
  'as',
  'into',
])

const SLUG_MAX_LEN = 32
const SLUG_MAX_WORDS = 4

export function deriveSlug(prose: string): string {
  const normalized = prose
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

  if (normalized === '') return 'capture'

  const words: string[] = []
  for (const tok of normalized.split(' ')) {
    if (tok === '') continue
    if (STOPWORDS.has(tok)) continue
    words.push(tok)
    if (words.length >= SLUG_MAX_WORDS) break
  }

  if (words.length === 0) return 'capture'

  let slug = words.join('-')
  if (slug.length > SLUG_MAX_LEN) {
    const kept: string[] = []
    let len = 0
    for (const w of words) {
      const next = len === 0 ? w.length : len + 1 + w.length
      if (next > SLUG_MAX_LEN && kept.length > 0) break
      kept.push(w)
      len = next
    }
    slug = kept.join('-')
    if (slug.length > SLUG_MAX_LEN) slug = slug.slice(0, SLUG_MAX_LEN)
  }

  return slug
}

export function deriveFilename(id: string, author: Author, kind: NoteKind, slug: string): string {
  return `${id}-${author}-${kind}-${slug}.md`
}

/** 3-digit zero-padded session-local sequence id (001, 002, … then 1000+). */
export function padId(n: number): string {
  return n < 1000 ? String(n).padStart(3, '0') : String(n)
}

// ── Filename parsing ──────────────────────────────────────────────────────

export const NOTE_FILENAME_RE = /^(\d{3,})-(human|llm)-([a-z]+)-(.+)\.md$/

export interface ParsedFilename {
  id: string
  idNum: number
  author: Author
  kind: NoteKind
  slug: string
}

export function parseFilename(filename: string): ParsedFilename | null {
  const m = NOTE_FILENAME_RE.exec(filename)
  if (!m) return null
  const idStr = m[1]!
  const idNum = parseInt(idStr, 10)
  if (Number.isNaN(idNum)) return null
  return {
    id: idStr,
    idNum,
    author: m[2] as Author,
    kind: m[3] as NoteKind,
    slug: m[4]!,
  }
}

/** The next id given the ids already present (handles gaps): padId(max+1). */
export function nextId(existingIds: readonly number[]): string {
  let maxId = 0
  for (const n of existingIds) if (n > maxId) maxId = n
  return padId(maxId + 1)
}

// ── Session naming ────────────────────────────────────────────────────────

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** Default UTC session folder name: `session-YYYY-MM-DD-HHMM`. */
export function defaultSessionName(d: Date): string {
  const yyyy = d.getUTCFullYear()
  const mm = pad2(d.getUTCMonth() + 1)
  const dd = pad2(d.getUTCDate())
  const hh = pad2(d.getUTCHours())
  const mi = pad2(d.getUTCMinutes())
  return `session-${yyyy}-${mm}-${dd}-${hh}${mi}`
}

// ── Preview ───────────────────────────────────────────────────────────────

/** One-line preview of prose for note summaries. */
export function preview(prose: string, max = 80): string {
  const flat = prose.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : flat.slice(0, max)
}

// ── Status replay ─────────────────────────────────────────────────────────
// Notes are immutable; status is an append-only transition log overlaid on
// top. "Current status" is the last `to` for a note id.

/** Current status for a note: last `to`, or null when it has no transitions. */
export function currentStatusFromHistory(history: readonly StatusTransition[]): NoteStatus | null {
  if (history.length === 0) return null
  return history[history.length - 1]!.to
}

export interface QueueEntry {
  noteId: string
  status: NoteStatus
  transitions: StatusTransition[]
}

/**
 * Materialize per-note current status from a flat transition log, newest
 * touched first. One entry per note id that has ever transitioned;
 * optionally filtered by status.
 */
export function buildQueue(
  transitions: readonly StatusTransition[],
  filter?: { status?: NoteStatus | NoteStatus[] },
): QueueEntry[] {
  const byNote = new Map<string, StatusTransition[]>()
  for (const t of transitions) {
    const arr = byNote.get(t.noteId) ?? []
    arr.push(t)
    byNote.set(t.noteId, arr)
  }
  const filterSet = filter?.status
    ? new Set(Array.isArray(filter.status) ? filter.status : [filter.status])
    : null
  const out: QueueEntry[] = []
  for (const [noteId, txns] of byNote) {
    const status = txns[txns.length - 1]!.to
    if (filterSet && !filterSet.has(status)) continue
    out.push({ noteId, status, transitions: txns })
  }
  out.sort((a, b) => {
    const aTs = a.transitions[a.transitions.length - 1]!.ts
    const bTs = b.transitions[b.transitions.length - 1]!.ts
    return aTs < bTs ? 1 : aTs > bTs ? -1 : 0
  })
  return out
}
