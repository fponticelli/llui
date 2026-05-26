// Filesystem-backed note storage. Each note is one `.md` file on disk
// with an optional sibling `.png` screenshot. Ids are 3-digit padded
// session-local sequences; filename is derived from
// id + author + kind + slug(prose).
//
// This module is the only writer to disk. The middleware delegates here.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

import { parseNote, serializeNote, type SerializedNote } from './frontmatter.js'
import { resolveCurrentSession } from './session.js'
import { deriveFilename, deriveSlug, padId } from './slug.js'

/**
 * Customizable parts of the on-disk format. None of these affect read
 * paths — listing and parsing still use the canonical filename regex,
 * so the slug callback is constrained to producing a `[a-z0-9-]+`
 * string (deriveSlug's contract). Session folder names are free-form.
 */
export interface NoteFormatConfig {
  /** Override the session folder name. Default: UTC
   *  `session-YYYY-MM-DD-HHMM`. */
  formatSessionFolder?: (date: Date) => string
  /** Override the slug derivation from prose. The slug becomes the
   *  tail of each filename (`{id}-{author}-{kind}-{slug}.md`). MUST
   *  return a `[a-z0-9-]+` string or filename-parsing breaks. */
  deriveSlug?: (prose: string) => string
}
import type {
  Author,
  CreateNoteRequest,
  CreateNoteResponse,
  ListNotesQuery,
  ListNotesResponse,
  NoteFrontmatter,
  NoteKind,
  NoteSummary,
} from './types.js'

const NOTE_FILENAME_RE = /^(\d{3,})-(human|llm)-([a-z]+)-(.+)\.md$/

interface ParsedFilename {
  id: string
  idNum: number
  author: Author
  kind: NoteKind
  slug: string
}

function parseFilename(filename: string): ParsedFilename | null {
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

function listNoteFilenames(sessionDir: string): string[] {
  if (!existsSync(sessionDir)) return []
  return readdirSync(sessionDir).filter((f) => f.endsWith('.md'))
}

function nextIdAndFilename(
  sessionDir: string,
  author: Author,
  kind: NoteKind,
  slug: string,
): { id: string; filename: string } {
  const filenames = listNoteFilenames(sessionDir)

  // Scan existing ids; new id is max+1. We also check OTHER files
  // (anything matching NOTE_FILENAME_RE) to skip past gaps caused by
  // out-of-band file writes (e.g. a HUD that wrote a placeholder).
  let maxId = 0
  for (const f of filenames) {
    const parsed = parseFilename(f)
    if (parsed && parsed.idNum > maxId) maxId = parsed.idNum
  }
  const nextNum = maxId + 1
  const id = padId(nextNum)

  // Resolve collisions: if the natural filename is taken, suffix -2, -3,
  // … before the .md extension. Rare path (same id + same slug as an
  // existing file) but possible if a HUD pre-wrote a placeholder.
  let filename = deriveFilename(id, author, kind, slug)
  let attempt = 2
  while (existsSync(join(sessionDir, filename))) {
    filename = deriveFilename(id, author, kind, `${slug}-${attempt}`)
    attempt++
  }
  return { id, filename }
}

export function createNote(
  notesRoot: string,
  req: CreateNoteRequest,
  format: NoteFormatConfig = {},
): CreateNoteResponse {
  const session = resolveCurrentSession(notesRoot, {
    ...(format.formatSessionFolder ? { formatSessionFolder: format.formatSessionFolder } : {}),
  })
  const sessionDir = session.notesDir

  const slug = (format.deriveSlug ?? deriveSlug)(req.body)
  const { id, filename } = nextIdAndFilename(
    sessionDir,
    req.frontmatter.author,
    req.frontmatter.kind,
    slug,
  )

  // The frontmatter on disk gets server-assigned id + ts. Also rewrite
  // `screenshot` to point at the actual sibling filename (callers can
  // pass any placeholder; we own the canonical name).
  const screenshotFilename = req.screenshot ? filename.replace(/\.md$/, '.png') : null
  const frontmatter: NoteFrontmatter = {
    ...req.frontmatter,
    id,
    ts: new Date().toISOString(),
    screenshot: screenshotFilename,
  }

  const serialized: SerializedNote = {
    frontmatter,
    prose: req.body,
    body: req.noteBody,
  }
  const md = serializeNote(serialized)
  const path = join(sessionDir, filename)
  writeFileSync(path, md, 'utf8')

  if (req.screenshot && screenshotFilename) {
    const pngPath = join(sessionDir, screenshotFilename)
    writeFileSync(pngPath, Buffer.from(req.screenshot, 'base64'))
  }

  return {
    id,
    filename,
    path,
    sessionId: session.sessionId,
  }
}

function findNoteFile(sessionDir: string, id: string): string | null {
  if (!existsSync(sessionDir)) return null
  const prefix = `${id}-`
  for (const f of readdirSync(sessionDir)) {
    if (f.startsWith(prefix) && f.endsWith('.md')) return f
  }
  return null
}

export function readNote(notesRoot: string, sessionId: string, id: string): SerializedNote {
  const sessionDir = join(notesRoot, sessionId)
  const filename = findNoteFile(sessionDir, id)
  if (!filename) {
    throw new Error(`note not found: ${sessionId}/${id}`)
  }
  const md = readFileSync(join(sessionDir, filename), 'utf8')
  return parseNote(md)
}

/**
 * Replace a note's prose, keeping its frontmatter intact. Returns the
 * updated SerializedNote. Throws when the note doesn't exist. The
 * status-history JSONL sidecar is untouched — edits don't reset task
 * state.
 */
export function updateNoteProse(
  notesRoot: string,
  sessionId: string,
  id: string,
  newProse: string,
): SerializedNote {
  const sessionDir = join(notesRoot, sessionId)
  const filename = findNoteFile(sessionDir, id)
  if (!filename) throw new Error(`note not found: ${sessionId}/${id}`)
  const existing = parseNote(readFileSync(join(sessionDir, filename), 'utf8'))
  const updated: SerializedNote = { ...existing, prose: newProse }
  writeFileSync(join(sessionDir, filename), serializeNote(updated), 'utf8')
  return updated
}

/**
 * Delete a note: the .md file + its sibling .png screenshot (if any).
 * Returns the list of paths actually removed. Idempotent — missing
 * files are skipped. The session-wide `status.jsonl` is intentionally
 * left alone; orphan transitions for the deleted note are harmless
 * since downstream readers filter by id.
 */
export function deleteNote(notesRoot: string, sessionId: string, id: string): string[] {
  const sessionDir = join(notesRoot, sessionId)
  const filename = findNoteFile(sessionDir, id)
  if (!filename) return []
  const removed: string[] = []
  const targets = [join(sessionDir, filename), join(sessionDir, filename.replace(/\.md$/, '.png'))]
  for (const t of targets) {
    if (existsSync(t)) {
      unlinkSync(t)
      removed.push(t)
    }
  }
  return removed
}

export function readScreenshot(notesRoot: string, sessionId: string, id: string): Buffer | null {
  const sessionDir = join(notesRoot, sessionId)
  const mdFilename = findNoteFile(sessionDir, id)
  if (!mdFilename) return null
  const pngPath = join(sessionDir, mdFilename.replace(/\.md$/, '.png'))
  if (!existsSync(pngPath)) return null
  return readFileSync(pngPath)
}

function preview(prose: string, max = 80): string {
  const flat = prose.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  return flat.slice(0, max)
}

function noteFileToSummary(
  notesRoot: string,
  sessionId: string,
  filename: string,
): NoteSummary | null {
  const parsed = parseFilename(filename)
  if (!parsed) return null
  const md = readFileSync(join(notesRoot, sessionId, filename), 'utf8')
  let note: SerializedNote
  try {
    note = parseNote(md)
  } catch {
    return null
  }
  const pngPath = join(notesRoot, sessionId, filename.replace(/\.md$/, '.png'))
  return {
    id: note.frontmatter.id,
    sessionId,
    filename,
    ts: note.frontmatter.ts,
    author: note.frontmatter.author,
    kind: note.frontmatter.kind,
    url: note.frontmatter.url,
    componentPath: note.frontmatter.componentPath,
    preview: preview(note.prose),
    hasScreenshot: existsSync(pngPath),
  }
}

export function listNotes(notesRoot: string, query: ListNotesQuery): ListNotesResponse {
  if (!existsSync(notesRoot)) {
    return { sessionId: '', notes: [], total: 0 }
  }
  const sessionId = query.sessionId ?? resolveCurrentSession(notesRoot).sessionId
  const sessionDir = join(notesRoot, sessionId)
  const filenames = listNoteFilenames(sessionDir)

  const summaries: NoteSummary[] = []
  for (const f of filenames) {
    const s = noteFileToSummary(notesRoot, sessionId, f)
    if (s) summaries.push(s)
  }
  // Sort ascending by id (natural session order)
  summaries.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))

  // Filter
  let filtered = summaries
  if (query.author) filtered = filtered.filter((n) => n.author === query.author)
  if (query.kind) {
    const kinds = Array.isArray(query.kind) ? query.kind : [query.kind]
    filtered = filtered.filter((n) => kinds.includes(n.kind))
  }
  if (query.since) {
    const since = query.since
    filtered = filtered.filter((n) => n.ts > since)
  }
  const total = filtered.length
  if (query.limit !== undefined) filtered = filtered.slice(0, query.limit)

  return { sessionId, notes: filtered, total }
}

export function listSessions(notesRoot: string): string[] {
  if (!existsSync(notesRoot)) return []
  const out: string[] = []
  for (const entry of readdirSync(notesRoot)) {
    const full = join(notesRoot, entry)
    if (!statSync(full).isDirectory()) continue
    if (!entry.startsWith('session-')) continue
    out.push(entry)
  }
  out.sort()
  return out
}

/** Ensures a directory exists, no-op if already present. Used by callers
 *  that want to materialize the notes root before any note is written
 *  (e.g. middleware startup). */
export function ensureNotesRoot(notesRoot: string): void {
  mkdirSync(notesRoot, { recursive: true })
}

/**
 * Delete a resolved task note's files: the task .md + .png plus every
 * reply note (`replyTo === taskNoteId`) and their screenshots. The
 * status.jsonl audit log is preserved — those transitions stay as a
 * trail of what happened.
 *
 * Used by the middleware when a task transitions to `applied` (the
 * success path). Idempotent: missing files are skipped silently.
 *
 * Returns the list of deleted filenames (sans the session dir prefix)
 * so the caller can log/broadcast.
 */
export function cleanupResolvedTask(
  notesRoot: string,
  sessionId: string,
  taskNoteId: string,
): string[] {
  const sessionDir = join(notesRoot, sessionId)
  if (!existsSync(sessionDir)) return []
  const deleted: string[] = []
  const filenames = listNoteFilenames(sessionDir)

  // First find the task note's own filename + delete it.
  const taskFile = findNoteFile(sessionDir, taskNoteId)
  if (taskFile) {
    deleteNoteFiles(sessionDir, taskFile, deleted)
  }

  // Then walk every other note in the session looking for replies.
  for (const f of filenames) {
    if (f === taskFile) continue
    let frontmatter: { replyTo?: string }
    try {
      const md = readFileSync(join(sessionDir, f), 'utf8')
      frontmatter = parseNote(md).frontmatter as { replyTo?: string }
    } catch {
      continue
    }
    if (frontmatter.replyTo === taskNoteId) {
      deleteNoteFiles(sessionDir, f, deleted)
    }
  }

  return deleted
}

function deleteNoteFiles(sessionDir: string, mdFilename: string, deleted: string[]): void {
  const mdPath = join(sessionDir, mdFilename)
  const pngPath = join(sessionDir, mdFilename.replace(/\.md$/, '.png'))
  try {
    unlinkSync(mdPath)
    deleted.push(mdFilename)
  } catch {
    /* ignore missing */
  }
  try {
    if (existsSync(pngPath)) {
      unlinkSync(pngPath)
      deleted.push(mdFilename.replace(/\.md$/, '.png'))
    }
  } catch {
    /* ignore */
  }
}
