// The NotesStore port — the single transport seam the HUD depends on.
//
// The HUD never talks to `/_llui/*` directly; it talks to a NotesStore.
// `devServerStore` (the only adapter today) wraps the existing Vite-plugin
// endpoints with byte-for-byte the same requests, so dev behaviour is
// unchanged (see docs/proposals/devmode-annotate/06-live-apps.md, P1).
// Production adapters (IndexedDB, export bundle, HTTP) slot in behind this
// same interface without touching the HUD core.

import type {
  Author,
  CreateNoteRequest,
  CreateNoteResponse,
  CurrentSessionResponse,
  ListNotesQuery,
  ListNotesResponse,
  NoteStatus,
  ServerEvent,
  SseRole,
  StatusTransition,
} from './note-types.js'

/** One session as returned by the session list. */
export interface SessionSummary {
  id: string
  noteCount: number
  startedAt?: string
}

/** Status sidecar for a single note: its current status + transition log. */
export interface NoteStatusResponse {
  current: NoteStatus | null
  history: StatusTransition[]
}

/** A note's place in the task queue. */
export interface QueueEntry {
  noteId: string
  status: NoteStatus
}

export interface QueueResponse {
  queue: QueueEntry[]
}

/** A note fetched in full (the `format=json` shape). Frontmatter/body are
 *  intentionally loose — consumers narrow what they read. Concrete
 *  `NoteFrontmatter`/`NoteBody` values assign here (they carry these fields
 *  and more); the dev-server adapter also fills it from raw server JSON. */
export interface FullNote {
  frontmatter: {
    kind: string
    author: string
    intent?: string
    screenshot?: string | null
  }
  prose: string
  body?: { repro?: unknown[] }
}

/** A status transition the HUD requests (POST status). */
export interface StatusUpdate {
  to: NoteStatus
  by: Author | 'system'
  reason?: string
}

/** A mutable patch to an existing note (PATCH). */
export interface NoteUpdate {
  prose?: string
}

/** One note in raw export form: its serialized `.md` plus optional screenshot. */
export interface RawNote {
  /** The `.md` filename (canonical `{id}-{author}-{kind}-{slug}.md`). */
  filename: string
  /** Serialized note markdown (YAML frontmatter + prose). */
  markdown: string
  /** Screenshot bytes (PNG), or null when the note has none. */
  screenshot: Uint8Array | null
}

/** One session in raw export form. */
export interface RawSession {
  id: string
  notes: RawNote[]
  /** `status.jsonl` content (one JSON transition per line; '' when empty). */
  statusJsonl: string
}

/**
 * A store that can produce its notebook as raw on-disk-format entries, for
 * export into a zip bundle. Browser stores implement this; the dev-server
 * store doesn't need to (its files already live on disk).
 */
export interface ExportableStore {
  exportSessions(sessionIds?: string[]): Promise<RawSession[]>
}

/** Live-event subscription parameters. */
export interface EventSubscription {
  role: SseRole
  onEvent: (event: ServerEvent) => void
  onError?: (err: unknown) => void
}

/**
 * The transport the HUD reads and writes through. Methods reject on
 * failure; callers keep their own try/catch and best-effort semantics.
 */
export interface NotesStore {
  /** Create a note (text/rect/capture/reply, or a task). */
  createNote(req: CreateNoteRequest): Promise<CreateNoteResponse>

  /** List all sessions, newest first. */
  listSessions(): Promise<SessionSummary[]>

  /** The session the store is currently writing into. */
  currentSession(): Promise<CurrentSessionResponse>

  /** Summaries of the notes in a session. */
  listNotes(query: ListNotesQuery): Promise<ListNotesResponse>

  /** A single note in full, or null if it can't be read. */
  readNote(id: string, sessionId: string): Promise<FullNote | null>

  /** A note's current status + transition history. */
  getStatus(id: string, sessionId: string): Promise<NoteStatusResponse>

  /** The task queue for a session. */
  getQueue(sessionId: string): Promise<QueueResponse>

  /** Delete a note. */
  deleteNote(id: string, sessionId: string): Promise<void>

  /** Patch a note (currently prose only). */
  updateNote(id: string, sessionId: string, update: NoteUpdate): Promise<void>

  /** Request a status transition for a note. */
  postStatus(id: string, sessionId: string, update: StatusUpdate): Promise<void>

  /** A URL usable directly as an `<img src>` for a note's screenshot.
   *  `screenshotRef` is the frontmatter `screenshot` value. Synchronous so
   *  it can be read inside a reactive view binding. */
  screenshotUrl(id: string, screenshotRef: string): string

  /** Subscribe to live notebook events. Returns an unsubscribe function.
   *  A noop subscription (returning a noop unsubscribe) is valid when the
   *  store has no live channel. */
  subscribeEvents(sub: EventSubscription): () => void
}
