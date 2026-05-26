// Session resolution + rotation. The "current" session is tracked in
// `<notesDir>/current-session` (one line, plain text). Sessions are
// subdirectories of `notesDir`. Rotating preserves all prior sessions
// untouched — only the marker file changes.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface ResolveSessionOptions {
  /** Override for tests / fixed-seed runs. Defaults to `new Date()`. */
  now?: () => Date
  /** Override for env-based session names (LLUI_SESSION_NAME). */
  sessionName?: string
  /** Format the session folder name from the start date. Overrides
   *  the default UTC `session-YYYY-MM-DD-HHMM` scheme. Ignored when
   *  `sessionName` is explicitly set. */
  formatSessionFolder?: (date: Date) => string
}

export interface SessionInfo {
  sessionId: string
  /** ISO timestamp at session start (the resolution moment, not the dir mtime). */
  startedAt: string
  /** Absolute path to the session subdirectory. */
  notesDir: string
}

export interface RotatedSession extends SessionInfo {
  previousSessionId: string
}

const MARKER_FILE = 'current-session'

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

export function defaultSessionName(d: Date): string {
  // UTC to keep sessions stable across timezones and DST shifts. Devs
  // working across timezones see one consistent label.
  const yyyy = d.getUTCFullYear()
  const mm = pad2(d.getUTCMonth() + 1)
  const dd = pad2(d.getUTCDate())
  const hh = pad2(d.getUTCHours())
  const mi = pad2(d.getUTCMinutes())
  return `session-${yyyy}-${mm}-${dd}-${hh}${mi}`
}

export function readCurrentSessionFile(notesRoot: string): string | null {
  const p = join(notesRoot, MARKER_FILE)
  if (!existsSync(p)) return null
  return readFileSync(p, 'utf8').trim() || null
}

/**
 * Atomically write the current-session marker. We write to a sibling
 * tmp file then rename — POSIX rename is atomic within a filesystem, so
 * a reader either sees the old name or the new one, never a partial.
 */
function writeCurrentSessionFile(notesRoot: string, sessionId: string): void {
  mkdirSync(notesRoot, { recursive: true })
  const target = join(notesRoot, MARKER_FILE)
  const tmp = join(notesRoot, `${MARKER_FILE}.tmp-${process.pid}`)
  writeFileSync(tmp, sessionId + '\n', 'utf8')
  renameSync(tmp, target)
}

/**
 * Ensure a session subdirectory exists. Does NOT touch the marker file —
 * use rotateSession or resolveCurrentSession for that.
 */
export function ensureSession(notesRoot: string, sessionId: string): string {
  const dir = join(notesRoot, sessionId)
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Resolve the current session: reuse the one named by current-session if
 * present, otherwise mint a new one from `defaultSessionName(now())` (or
 * the env override).
 */
export function resolveCurrentSession(
  notesRoot: string,
  opts: ResolveSessionOptions = {},
): SessionInfo {
  const existing = readCurrentSessionFile(notesRoot)
  if (existing !== null) {
    const dir = ensureSession(notesRoot, existing)
    return { sessionId: existing, startedAt: new Date().toISOString(), notesDir: dir }
  }
  const now = opts.now ? opts.now() : new Date()
  const sessionId =
    opts.sessionName ??
    (opts.formatSessionFolder ? opts.formatSessionFolder(now) : defaultSessionName(now))
  const dir = ensureSession(notesRoot, sessionId)
  writeCurrentSessionFile(notesRoot, sessionId)
  return { sessionId, startedAt: now.toISOString(), notesDir: dir }
}

/**
 * Start a fresh session. The previous session is left on disk; only the
 * marker moves.
 */
export function rotateSession(notesRoot: string, opts: ResolveSessionOptions = {}): RotatedSession {
  const previousSessionId = readCurrentSessionFile(notesRoot) ?? ''
  const now = opts.now ? opts.now() : new Date()
  const sessionId =
    opts.sessionName ??
    (opts.formatSessionFolder ? opts.formatSessionFolder(now) : defaultSessionName(now))
  const dir = ensureSession(notesRoot, sessionId)
  writeCurrentSessionFile(notesRoot, sessionId)
  return {
    sessionId,
    previousSessionId,
    startedAt: now.toISOString(),
    notesDir: dir,
  }
}
