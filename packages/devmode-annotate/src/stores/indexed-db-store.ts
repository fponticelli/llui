// IndexedDB NotesStore adapter — runs the HUD entirely in the browser with
// no dev server. Screenshots are stored as Blobs (not base64-in-markdown);
// `screenshotUrl` serves them via object URLs. Live events are emitted
// in-process so the same tab's browse view stays current after writes.
//
// Ids, filenames, session names, and status replay all come from
// `note-format` — the same logic the dev-server store's backend uses — so a
// later export bundle reproduces the canonical on-disk layout exactly.

import {
  buildQueue,
  currentStatusFromHistory,
  defaultSessionName,
  deriveFilename,
  deriveSlug,
  nextId,
  parseFilename,
  preview,
} from '../note-format.js'
import { serializeNote } from '../note-serialize.js'
import type {
  CreateNoteRequest,
  CreateNoteResponse,
  CurrentSessionResponse,
  ListNotesQuery,
  ListNotesResponse,
  NoteBody,
  NoteFrontmatter,
  NoteSummary,
  ServerEvent,
  StatusTransition,
} from '../note-types.js'
import type {
  EventSubscription,
  ExportableStore,
  FullNote,
  NotesStore,
  NoteStatusResponse,
  NoteUpdate,
  QueueResponse,
  RawSession,
  SessionSummary,
  StatusUpdate,
} from '../notes-store.js'

export interface IndexedDbStoreOptions {
  /** IndexedDB database name. Default `llui-devmode-annotate`. */
  dbName?: string
  /** Clock override (tests / deterministic runs). Default `() => new Date()`. */
  now?: () => Date
}

interface StoredSession {
  id: string
  startedAt: string
}

interface StoredNote {
  /** `${sessionId}/${id}` — the primary key. */
  key: string
  sessionId: string
  id: string
  filename: string
  frontmatter: NoteFrontmatter
  body: NoteBody
  prose: string
  screenshot: Uint8Array | null
}

interface StoredTransition extends StatusTransition {
  sessionId: string
}

const DB_VERSION = 1
const META_CURRENT_SESSION = 'currentSession'

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

function openDb(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' })
      if (!db.objectStoreNames.contains('sessions'))
        db.createObjectStore('sessions', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('notes')) {
        const notes = db.createObjectStore('notes', { keyPath: 'key' })
        notes.createIndex('bySession', 'sessionId', { unique: false })
      }
      if (!db.objectStoreNames.contains('transitions')) {
        const txns = db.createObjectStore('transitions', { keyPath: 'seq', autoIncrement: true })
        txns.createIndex('bySession', 'sessionId', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function summarize(note: StoredNote): NoteSummary {
  const fm = note.frontmatter
  const summary: NoteSummary = {
    id: fm.id,
    sessionId: note.sessionId,
    filename: note.filename,
    ts: fm.ts,
    author: fm.author,
    kind: fm.kind,
    url: fm.url,
    componentPath: fm.componentPath,
    preview: preview(note.prose),
    hasScreenshot: note.screenshot !== null,
  }
  if (fm.intent !== undefined) summary.intent = fm.intent
  if (fm.chainName !== undefined) summary.chainName = fm.chainName
  if (fm.replyTo !== undefined) summary.replyTo = fm.replyTo
  if (fm.proposedDiff?.summary) summary.proposedSummary = fm.proposedDiff.summary
  return summary
}

/**
 * Build a browser-local NotesStore backed by IndexedDB. No dev server
 * required; the HUD captures, persists, and browses entirely client-side.
 */
export function indexedDbStore(opts: IndexedDbStoreOptions = {}): NotesStore & ExportableStore {
  const dbName = opts.dbName ?? 'llui-devmode-annotate'
  const now = opts.now ?? ((): Date => new Date())

  let dbPromise: Promise<IDBDatabase> | null = null
  const db = (): Promise<IDBDatabase> => (dbPromise ??= openDb(dbName))

  // Object URLs are created lazily on read and cached by note id so the
  // synchronous `screenshotUrl` binding can return one. Revoked on replace.
  const urlCache = new Map<string, string>()
  const cacheScreenshot = (id: string, bytes: Uint8Array | null): void => {
    const prev = urlCache.get(id)
    if (prev) {
      if (typeof URL !== 'undefined' && URL.revokeObjectURL) URL.revokeObjectURL(prev)
      urlCache.delete(id)
    }
    if (bytes && typeof URL !== 'undefined' && URL.createObjectURL) {
      // Copy into a fresh ArrayBuffer-backed view so the Blob ctor's type is
      // satisfied regardless of the stored array's backing buffer.
      urlCache.set(
        id,
        URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/png' })),
      )
    }
  }

  // In-process event bus — a single tab's writes refresh its own browse view.
  const subscribers = new Set<(e: ServerEvent) => void>()
  const emit = (e: ServerEvent): void => {
    for (const fn of subscribers) {
      try {
        fn(e)
      } catch {
        // a subscriber throwing shouldn't break the write path
      }
    }
  }

  const getMeta = async (key: string): Promise<string | null> => {
    const tx = (await db()).transaction('meta', 'readonly')
    const rec = await promisify(tx.objectStore('meta').get(key))
    return rec ? (rec as { key: string; value: string }).value : null
  }

  const ensureSession = async (): Promise<string> => {
    const existing = await getMeta(META_CURRENT_SESSION)
    if (existing) return existing
    const id = defaultSessionName(now())
    const tx = (await db()).transaction(['sessions', 'meta'], 'readwrite')
    tx.objectStore('sessions').put({ id, startedAt: now().toISOString() } satisfies StoredSession)
    tx.objectStore('meta').put({ key: META_CURRENT_SESSION, value: id })
    await txDone(tx)
    return id
  }

  const notesForSession = async (sessionId: string): Promise<StoredNote[]> => {
    const tx = (await db()).transaction('notes', 'readonly')
    const idx = tx.objectStore('notes').index('bySession')
    const all = await promisify(idx.getAll(IDBKeyRange.only(sessionId)))
    return all as StoredNote[]
  }

  const transitionsForSession = async (sessionId: string): Promise<StatusTransition[]> => {
    const tx = (await db()).transaction('transitions', 'readonly')
    const idx = tx.objectStore('transitions').index('bySession')
    const all = (await promisify(idx.getAll(IDBKeyRange.only(sessionId)))) as StoredTransition[]
    return all.map(({ sessionId: _sid, ...t }) => t)
  }

  const getNote = async (sessionId: string, id: string): Promise<StoredNote | null> => {
    const tx = (await db()).transaction('notes', 'readonly')
    const rec = await promisify(tx.objectStore('notes').get(`${sessionId}/${id}`))
    return (rec as StoredNote | undefined) ?? null
  }

  return {
    async createNote(req: CreateNoteRequest): Promise<CreateNoteResponse> {
      const sessionId = await ensureSession()
      const slug = deriveSlug(req.body)
      const existing = await notesForSession(sessionId)
      const id = nextId(existing.map((n) => parseFilename(n.filename)?.idNum ?? 0))
      let filename = deriveFilename(id, req.frontmatter.author, req.frontmatter.kind, slug)
      // Collision guard (matches the server's -2/-3 suffix behaviour).
      const taken = new Set(existing.map((n) => n.filename))
      let attempt = 2
      while (taken.has(filename)) {
        filename = deriveFilename(
          id,
          req.frontmatter.author,
          req.frontmatter.kind,
          `${slug}-${attempt}`,
        )
        attempt++
      }

      const screenshotFilename = req.screenshot ? filename.replace(/\.md$/, '.png') : null
      const frontmatter: NoteFrontmatter = {
        ...req.frontmatter,
        id,
        ts: now().toISOString(),
        screenshot: screenshotFilename,
      }
      const bytes = req.screenshot ? base64ToBytes(req.screenshot) : null
      const record: StoredNote = {
        key: `${sessionId}/${id}`,
        sessionId,
        id,
        filename,
        frontmatter,
        body: req.noteBody,
        prose: req.body,
        screenshot: bytes,
      }

      const tx = (await db()).transaction('notes', 'readwrite')
      tx.objectStore('notes').put(record)
      await txDone(tx)

      if (bytes) cacheScreenshot(id, bytes)
      emit({ type: 'note-created', id, filename, author: frontmatter.author })
      return { id, filename, path: `${sessionId}/${filename}`, sessionId }
    },

    async listSessions(): Promise<SessionSummary[]> {
      const tx = (await db()).transaction(['sessions', 'notes'], 'readonly')
      const sessions = (await promisify(tx.objectStore('sessions').getAll())) as StoredSession[]
      const idx = tx.objectStore('notes').index('bySession')
      const out: SessionSummary[] = []
      for (const s of sessions) {
        const count = await promisify(idx.count(IDBKeyRange.only(s.id)))
        out.push({ id: s.id, noteCount: count, startedAt: s.startedAt })
      }
      out.sort((a, b) => a.id.localeCompare(b.id))
      return out
    },

    async currentSession(): Promise<CurrentSessionResponse> {
      const sessionId = await ensureSession()
      return { sessionId, startedAt: now().toISOString(), notesDir: dbName }
    },

    async listNotes(query: ListNotesQuery): Promise<ListNotesResponse> {
      const sessionId = query.sessionId ?? (await ensureSession())
      const notes = await notesForSession(sessionId)
      let summaries = notes.map(summarize)
      summaries.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))
      if (query.author) summaries = summaries.filter((n) => n.author === query.author)
      if (query.kind) {
        const kinds = Array.isArray(query.kind) ? query.kind : [query.kind]
        summaries = summaries.filter((n) => kinds.includes(n.kind))
      }
      if (query.since) {
        const since = query.since
        summaries = summaries.filter((n) => n.ts > since)
      }
      const total = summaries.length
      if (query.limit !== undefined) summaries = summaries.slice(0, query.limit)
      return { sessionId, notes: summaries, total }
    },

    async readNote(id: string, sessionId: string): Promise<FullNote | null> {
      const note = await getNote(sessionId, id)
      if (!note) return null
      cacheScreenshot(id, note.screenshot)
      return { frontmatter: note.frontmatter, prose: note.prose, body: note.body }
    },

    async getStatus(id: string, sessionId: string): Promise<NoteStatusResponse> {
      const history = (await transitionsForSession(sessionId)).filter((t) => t.noteId === id)
      return { current: currentStatusFromHistory(history), history }
    },

    async getQueue(sessionId: string): Promise<QueueResponse> {
      const queue = buildQueue(await transitionsForSession(sessionId)).map((e) => ({
        noteId: e.noteId,
        status: e.status,
      }))
      return { queue }
    },

    async deleteNote(id: string, sessionId: string): Promise<void> {
      const tx = (await db()).transaction('notes', 'readwrite')
      tx.objectStore('notes').delete(`${sessionId}/${id}`)
      await txDone(tx)
      cacheScreenshot(id, null)
      emit({ type: 'note-deleted', id, sessionId })
    },

    async updateNote(id: string, sessionId: string, update: NoteUpdate): Promise<void> {
      const note = await getNote(sessionId, id)
      if (!note) throw new Error(`note not found: ${sessionId}/${id}`)
      if (update.prose !== undefined) note.prose = update.prose
      const tx = (await db()).transaction('notes', 'readwrite')
      tx.objectStore('notes').put(note)
      await txDone(tx)
      emit({ type: 'note-updated', id, sessionId })
    },

    async postStatus(id: string, sessionId: string, update: StatusUpdate): Promise<void> {
      const history = (await transitionsForSession(sessionId)).filter((t) => t.noteId === id)
      const from = currentStatusFromHistory(history)
      const transition: StoredTransition = {
        sessionId,
        ts: now().toISOString(),
        noteId: id,
        from,
        to: update.to,
        by: update.by,
        ...(update.reason !== undefined ? { reason: update.reason } : {}),
      }
      const tx = (await db()).transaction('transitions', 'readwrite')
      tx.objectStore('transitions').add(transition)
      await txDone(tx)
      emit({
        type: 'status-changed',
        noteId: id,
        from,
        to: update.to,
        ...(update.reason !== undefined ? { reason: update.reason } : {}),
      })
    },

    async exportSessions(sessionIds?: string[]): Promise<RawSession[]> {
      const tx = (await db()).transaction('sessions', 'readonly')
      const allSessions = (await promisify(tx.objectStore('sessions').getAll())) as StoredSession[]
      const wanted = sessionIds ? allSessions.filter((s) => sessionIds.includes(s.id)) : allSessions
      wanted.sort((a, b) => a.id.localeCompare(b.id))

      const out: RawSession[] = []
      for (const s of wanted) {
        const notes = await notesForSession(s.id)
        notes.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))
        const rawNotes = notes.map((n) => ({
          filename: n.filename,
          markdown: serializeNote({ frontmatter: n.frontmatter, prose: n.prose, body: n.body }),
          screenshot: n.screenshot,
        }))
        const transitions = await transitionsForSession(s.id)
        const statusJsonl = transitions.map((t) => JSON.stringify(t)).join('\n')
        out.push({ id: s.id, notes: rawNotes, statusJsonl })
      }
      return out
    },

    screenshotUrl(id: string): string {
      return urlCache.get(id) ?? ''
    },

    subscribeEvents(sub: EventSubscription): () => void {
      subscribers.add(sub.onEvent)
      return () => {
        subscribers.delete(sub.onEvent)
      }
    },
  }
}
