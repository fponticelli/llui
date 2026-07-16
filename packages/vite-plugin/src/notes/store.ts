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
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve, sep } from 'node:path'

import { deriveFilename, deriveSlug, nextId, parseFilename } from '@llui/notes-format/note-format'

import { parseNote, serializeNote, type SerializedNote } from './frontmatter.js'
import { resolveCurrentSession } from './session.js'

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
  ListNotesError,
  ListNotesQuery,
  ListNotesResponse,
  NoteFrontmatter,
  NoteKind,
  NoteSummary,
} from './types.js'

function listNoteFilenames(sessionDir: string): string[] {
  if (!existsSync(sessionDir)) return []
  return readdirSync(sessionDir).filter((f) => f.endsWith('.md'))
}

/** True when an fs error is an `EEXIST` (exclusive-create collision). */
function isEexist(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'EEXIST'
}

/**
 * Write `data` to `path` atomically: write a sibling tmp file then
 * `renameSync` over the target. POSIX rename is atomic within a
 * filesystem, so a concurrent reader sees either the old file or the
 * complete new one — never a half-written (torn) file. Mirrors the
 * session-marker write (`session.ts`).
 */
function atomicWriteFileSync(path: string, data: string | Buffer): void {
  const tmp = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`
  try {
    writeFileSync(tmp, data)
    renameSync(tmp, path)
  } catch (err) {
    // Best-effort cleanup so a failed write doesn't leak a tmp sidecar.
    try {
      if (existsSync(tmp)) unlinkSync(tmp)
    } catch {
      /* ignore */
    }
    throw err
  }
}

function nextIdAndFilename(
  sessionDir: string,
  author: Author,
  kind: NoteKind,
  slug: string,
): { id: string; filename: string } {
  const filenames = listNoteFilenames(sessionDir)

  // Scan existing ids; new id is max+1. We also check OTHER files
  // (anything matching the canonical filename regex) to skip past gaps
  // caused by out-of-band file writes (e.g. a HUD that wrote a placeholder).
  const id = nextId(filenames.map((f) => parseFilename(f)?.idNum ?? 0))

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

interface AllocatedNote {
  id: string
  filename: string
  path: string
  screenshotFilename: string | null
}

/**
 * Allocate the note id and write its `.md` atomically. `writeFileSync` with
 * the `wx` flag is an exclusive create (O_CREAT | O_EXCL): if the derived
 * filename already exists — a concurrent writer or an out-of-band HUD claimed
 * it between our scan and our write — it throws `EEXIST`. We then rescan
 * (picking a fresh id past the newcomer) and retry, instead of silently
 * clobbering another note. A brand-new file grows from zero in a single
 * write, so there is no truncate-then-write window for a torn read.
 */
function allocateAndWriteNote(
  sessionDir: string,
  req: CreateNoteRequest,
  slug: string,
  ts: string,
): AllocatedNote {
  const MAX_ID_ATTEMPTS = 128
  for (let attempt = 0; ; attempt++) {
    const alloc = nextIdAndFilename(sessionDir, req.frontmatter.author, req.frontmatter.kind, slug)
    const path = join(sessionDir, alloc.filename)
    // The frontmatter on disk gets server-assigned id + ts. Also rewrite
    // `screenshot` to point at the actual sibling filename (callers can
    // pass any placeholder; we own the canonical name).
    const screenshotFilename = req.screenshot ? alloc.filename.replace(/\.md$/, '.png') : null
    const frontmatter: NoteFrontmatter = {
      ...req.frontmatter,
      id: alloc.id,
      ts,
      screenshot: screenshotFilename,
    }
    const md = serializeNote({ frontmatter, prose: req.body, body: req.noteBody })
    try {
      writeFileSync(path, md, { encoding: 'utf8', flag: 'wx' })
      return { id: alloc.id, filename: alloc.filename, path, screenshotFilename }
    } catch (err) {
      if (isEexist(err) && attempt < MAX_ID_ATTEMPTS) continue
      throw err
    }
  }
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
  const ts = new Date().toISOString()

  const { id, filename, path, screenshotFilename } = allocateAndWriteNote(sessionDir, req, slug, ts)

  if (req.screenshot && screenshotFilename) {
    const pngPath = join(sessionDir, screenshotFilename)
    // Binary payload can be large and multi-write — write atomically so a
    // reader never sees a partially-decoded screenshot.
    atomicWriteFileSync(pngPath, Buffer.from(req.screenshot, 'base64'))
  }

  return {
    id,
    filename,
    path,
    sessionId: session.sessionId,
  }
}

/**
 * Resolve `<notesRoot>/<sessionId>` and verify it stays within `notesRoot`.
 * `sessionId` arrives from the HTTP query string and is otherwise unvalidated
 * (session folder names are free-form), so a value like `../../etc` would
 * escape the notes root and let a request read or delete arbitrary files.
 * Throw on any traversal rather than touching anything outside the root.
 */
export function resolveSessionDir(notesRoot: string, sessionId: string): string {
  const root = resolve(notesRoot)
  const dir = resolve(root, sessionId)
  if (dir !== root && !dir.startsWith(root + sep)) {
    throw new Error(`invalid sessionId: ${JSON.stringify(sessionId)}`)
  }
  return dir
}

function findNoteFile(sessionDir: string, id: string): string | null {
  if (!existsSync(sessionDir)) return null
  const prefix = `${id}-`
  const matches = readdirSync(sessionDir).filter((f) => f.startsWith(prefix) && f.endsWith('.md'))
  if (matches.length === 0) return null
  if (matches.length > 1) {
    // Two notes sharing one id is a corrupt/torn state (a duplicate-id race
    // that slipped past exclusive-create, or a manual copy). Surface it
    // loudly rather than silently pick one and mask the corruption.
    throw new Error(
      `note store integrity error: multiple files for id ${id}: ${matches.sort().join(', ')}`,
    )
  }
  return matches[0]!
}

export function readNote(notesRoot: string, sessionId: string, id: string): SerializedNote {
  const sessionDir = resolveSessionDir(notesRoot, sessionId)
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
  const sessionDir = resolveSessionDir(notesRoot, sessionId)
  const filename = findNoteFile(sessionDir, id)
  if (!filename) throw new Error(`note not found: ${sessionId}/${id}`)
  const existing = parseNote(readFileSync(join(sessionDir, filename), 'utf8'))
  const updated: SerializedNote = { ...existing, prose: newProse }
  // Overwriting an existing file truncates-then-writes, which a concurrent
  // reader can catch mid-flight. Write atomically (tmp + rename) instead.
  atomicWriteFileSync(join(sessionDir, filename), serializeNote(updated))
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
  const sessionDir = resolveSessionDir(notesRoot, sessionId)
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
  const sessionDir = resolveSessionDir(notesRoot, sessionId)
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

/**
 * Build a summary for one note file. Returns `null` when the filename is
 * not a canonical note name (e.g. a stray `README.md` — legitimately not a
 * note, so silently skipped). THROWS when a canonical note file fails to
 * parse — that is corruption the caller must surface, not swallow.
 */
function noteFileToSummary(
  notesRoot: string,
  sessionId: string,
  filename: string,
): NoteSummary | null {
  const parsed = parseFilename(filename)
  if (!parsed) return null
  const sessionDir = resolveSessionDir(notesRoot, sessionId)
  const md = readFileSync(join(sessionDir, filename), 'utf8')
  const note: SerializedNote = parseNote(md)
  const pngPath = join(sessionDir, filename.replace(/\.md$/, '.png'))
  const fm = note.frontmatter as typeof note.frontmatter & {
    intent?: NoteSummary['intent']
    chainName?: string
    replyTo?: string
    proposedDiff?: { summary?: string }
  }
  const summary: NoteSummary = {
    id: fm.id,
    sessionId,
    filename,
    ts: fm.ts,
    author: fm.author,
    kind: fm.kind,
    url: fm.url,
    componentPath: fm.componentPath,
    preview: preview(note.prose),
    hasScreenshot: existsSync(pngPath),
  }
  // Optional fields surfaced for HUD rehydration on reload. Only set
  // when actually present so older clients ignoring them aren't
  // surprised by unexpected keys.
  if (fm.intent !== undefined) summary.intent = fm.intent
  if (fm.chainName !== undefined) summary.chainName = fm.chainName
  if (fm.replyTo !== undefined) summary.replyTo = fm.replyTo
  if (fm.proposedDiff?.summary) summary.proposedSummary = fm.proposedDiff.summary
  return summary
}

export function listNotes(notesRoot: string, query: ListNotesQuery): ListNotesResponse {
  if (!existsSync(notesRoot)) {
    return { sessionId: '', notes: [], total: 0 }
  }
  const sessionId = query.sessionId ?? resolveCurrentSession(notesRoot).sessionId
  const sessionDir = resolveSessionDir(notesRoot, sessionId)
  const filenames = listNoteFilenames(sessionDir)

  const summaries: NoteSummary[] = []
  const errors: ListNotesError[] = []
  for (const f of filenames) {
    try {
      const s = noteFileToSummary(notesRoot, sessionId, f)
      if (s) summaries.push(s)
    } catch (err) {
      // A canonical note file that failed to parse (corrupt frontmatter,
      // torn write, hand-edit). Surface it instead of silently dropping so
      // a broken note is visible to the HUD / server logs.
      const message = err instanceof Error ? err.message : String(err)
      errors.push({ filename: f, message })
    }
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

  const response: ListNotesResponse = { sessionId, notes: filtered, total }
  if (errors.length > 0) response.errors = errors
  return response
}

export interface SessionListEntry {
  id: string
  /** Count of .md notes in the session dir. */
  noteCount: number
  /** ISO timestamp of the session dir's creation (birthtime when
   *  available, else mtime). Used to sort + display in the HUD. */
  startedAt: string
}

export function listSessions(notesRoot: string): SessionListEntry[] {
  if (!existsSync(notesRoot)) return []
  const out: SessionListEntry[] = []
  for (const entry of readdirSync(notesRoot)) {
    const full = join(notesRoot, entry)
    let st: ReturnType<typeof statSync>
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (!st.isDirectory()) continue
    if (!entry.startsWith('session-')) continue
    let noteCount = 0
    try {
      noteCount = readdirSync(full).filter((f) => f.endsWith('.md')).length
    } catch {
      // unreadable session dir; surface as 0 rather than skipping.
    }
    // birthtime can be 0 on some filesystems; fall back to mtime.
    const tsMs = st.birthtimeMs && st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs
    out.push({ id: entry, noteCount, startedAt: new Date(tsMs).toISOString() })
  }
  out.sort((a, b) => a.id.localeCompare(b.id))
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
  const sessionDir = resolveSessionDir(notesRoot, sessionId)
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
