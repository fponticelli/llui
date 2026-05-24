// Filename derivation for notes. The on-disk filename format is
//   {id}-{author}-{kind}-{slug}.md
// where {id} is a 3-digit padded session-local sequence and {slug} is a
// kebab-case summary of the prose (or "capture" when prose is absent).
//
// Slug rules — from 01-on-disk-format.md, §"Filename derivation":
//   - First 3-4 words of the prose, stopwords stripped
//   - Sanitized to [a-z0-9-]
//   - Capped at 32 characters
//   - "capture" fallback when nothing remains

import type { Author, NoteKind } from './types.js'

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
  // 1. Normalize: lowercase, replace non-[a-z0-9] with spaces, collapse.
  const normalized = prose
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

  if (normalized === '') return 'capture'

  // 2. Tokenize and drop stopwords. Keep up to SLUG_MAX_WORDS content
  //    words. Pure digit tokens are content (not stopwords).
  const words: string[] = []
  for (const tok of normalized.split(' ')) {
    if (tok === '') continue
    if (STOPWORDS.has(tok)) continue
    words.push(tok)
    if (words.length >= SLUG_MAX_WORDS) break
  }

  if (words.length === 0) return 'capture'

  // 3. Join with hyphens, cap at SLUG_MAX_LEN — but only on a word
  //    boundary so the slug never ends mid-token.
  let slug = words.join('-')
  if (slug.length > SLUG_MAX_LEN) {
    // Walk words back until we fit. We keep at least one word.
    const kept: string[] = []
    let len = 0
    for (const w of words) {
      const next = len === 0 ? w.length : len + 1 + w.length
      if (next > SLUG_MAX_LEN && kept.length > 0) break
      kept.push(w)
      len = next
    }
    slug = kept.join('-')
    // First word longer than the cap: hard truncate (no good boundary
    // exists). This is the rare path; the slug is still meaningful as a
    // filename hint even if abbreviated.
    if (slug.length > SLUG_MAX_LEN) slug = slug.slice(0, SLUG_MAX_LEN)
  }

  return slug
}

export function deriveFilename(id: string, author: Author, kind: NoteKind, slug: string): string {
  return `${id}-${author}-${kind}-${slug}.md`
}

export function padId(n: number): string {
  return n < 1000 ? String(n).padStart(3, '0') : String(n)
}
