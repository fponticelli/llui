// Status sidecar for task-mode notes (P6).
//
// status.jsonl is an append-only log of state transitions, one per
// JSON line. Notes themselves stay immutable; status overlays them.
// `currentStatus(noteId)` is "the last `to` value for that id" — O(file
// size) but fine in practice (~50KB for a 200-note session).
//
// Apply semantics: when a transition lands on `accepted`, callers may
// pull the proposedDiff out of the related reply note and feed it to
// `git apply` (handled at the middleware layer, not here).

import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  buildQueue,
  currentStatusFromHistory,
  type QueueEntry,
} from '@llui/notes-format/note-format'

import type { NoteStatus, StatusTransition } from './types.js'

// Re-exported for existing server call sites; canonical replay is shared
// with browser stores.
export type { QueueEntry }

const STATUS_FILE = 'status.jsonl'

function statusPath(sessionDir: string): string {
  return join(sessionDir, STATUS_FILE)
}

/**
 * Append a transition to status.jsonl. The file is created on first
 * append. `from` is the current status (or null on the first
 * transition for this note) so the line is self-describing.
 */
export function appendStatus(sessionDir: string, transition: StatusTransition): void {
  const line = JSON.stringify(transition) + '\n'
  appendFileSync(statusPath(sessionDir), line, 'utf8')
}

/**
 * Read the full status history for a single note id, in chronological
 * order. Empty array when the file doesn't exist or the note has no
 * transitions.
 */
export function readStatusHistory(sessionDir: string, noteId: string): StatusTransition[] {
  const path = statusPath(sessionDir)
  if (!existsSync(path)) return []
  const raw = readFileSync(path, 'utf8')
  const out: StatusTransition[] = []
  for (const line of raw.split('\n')) {
    if (line === '') continue
    try {
      const parsed = JSON.parse(line) as StatusTransition
      if (parsed.noteId === noteId) out.push(parsed)
    } catch {
      // Skip malformed lines silently — log corruption is rare and a
      // single bad line shouldn't kill the read.
    }
  }
  return out
}

/**
 * Current status for a note: last `to` value, or null when no
 * transitions exist (= the note hasn't entered the status machine).
 */
export function currentStatus(sessionDir: string, noteId: string): NoteStatus | null {
  return currentStatusFromHistory(readStatusHistory(sessionDir, noteId))
}

/**
 * Read every transition in the session log, regardless of note id.
 * Used by listQueue() to materialize the current status of all notes.
 */
export function readAllTransitions(sessionDir: string): StatusTransition[] {
  const path = statusPath(sessionDir)
  if (!existsSync(path)) return []
  const raw = readFileSync(path, 'utf8')
  const out: StatusTransition[] = []
  for (const line of raw.split('\n')) {
    if (line === '') continue
    try {
      out.push(JSON.parse(line) as StatusTransition)
    } catch {
      // skip malformed
    }
  }
  return out
}

/**
 * Materialize per-note status by replaying every transition. Returns
 * one entry per noteId that has ever been touched; filter by status
 * via `filter`.
 */
export function listQueue(
  sessionDir: string,
  filter?: { status?: NoteStatus | NoteStatus[] },
): QueueEntry[] {
  return buildQueue(readAllTransitions(sessionDir), filter)
}
