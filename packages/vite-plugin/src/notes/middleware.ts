// HTTP middleware for the devmode-annotate notebook. Mounts a single
// handler at /_llui/ and dispatches internally to the endpoints described
// in 02-middleware.md.
//
// Transport-agnostic: takes a `notesRoot` + an `EventBus` + a
// `CaptureRegistry` and returns a Connect-style `(req, res, next)`
// handler. The Vite plugin wires it via `server.middlewares.use('/_llui',
// handler)`; tests mount it on a plain node http.Server.

import { execFileSync } from 'node:child_process'
import { existsSync, unlinkSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isAbsolute, relative, resolve } from 'node:path'

import type { CaptureRegistry } from './capture-registry.js'
import type { EventBus } from './event-bus.js'
import { checkSameOriginLoopback, isJsonContentType } from './request-guard.js'
import type { TrustedTaskRegistry } from './trusted-tasks.js'
import {
  cleanupResolvedTask,
  createNote,
  deleteNote,
  listNotes,
  listSessions,
  readNote,
  readScreenshot,
  resolveSessionDir,
  updateNoteProse,
  type NoteFormatConfig,
} from './store.js'
import { rotateSession, resolveCurrentSession } from './session.js'
import { serializeNote } from './frontmatter.js'
import { importBundle } from './import.js'
import { appendStatus, currentStatus, listQueue, readStatusHistory } from './status.js'
import type {
  Author,
  CaptureRequestPayload,
  CreateNoteRequest,
  ListNotesQuery,
  NoteKind,
  NoteStatus,
  ProposedDiff,
  ServerEvent,
  SseRole,
  StatusTransition,
} from './types.js'

export interface NotesMiddlewareConfig {
  notesRoot: string
  bus: EventBus
  registry: CaptureRegistry
  defaultCaptureTimeoutMs?: number
  /** Heartbeat interval for SSE keepalive in ms. Default 15000. */
  sseHeartbeatMs?: number
  /** Override session-folder naming and/or slug derivation. */
  format?: NoteFormatConfig
  /**
   * Provenance registry for task-intent notes. When provided, every task
   * note accepted through this (same-origin, authenticated) middleware is
   * marked here so the attention router only spawns agents for tasks a
   * trusted in-page writer created. Omit to skip provenance recording
   * (the router then falls back to on-disk intent — dev/test only).
   */
  trustedTasks?: TrustedTaskRegistry
}

export type MiddlewareHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void,
) => void

const ROUTE_PREFIX = '/_llui'
const DEFAULT_CAPTURE_TIMEOUT_MS = 30_000

interface Body {
  raw: Buffer
  json: () => unknown
}

async function readBody(req: IncomingMessage): Promise<Body> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks)
      resolve({
        raw,
        json: () => {
          if (raw.length === 0) return null
          return JSON.parse(raw.toString('utf8'))
        },
      })
    })
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(payload))
}

function sendText(res: ServerResponse, status: number, contentType: string, body: string): void {
  res.statusCode = status
  res.setHeader('content-type', contentType)
  res.end(body)
}

function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message })
}

/**
 * Guard JSON-body routes: reject anything that isn't declared
 * `application/json`. Browsers can issue cross-site `text/plain` /
 * form-encoded POSTs without a CORS preflight, so a JSON parser that
 * accepts any content type is a CSRF vector even behind the same-origin
 * check. Returns `false` (and answers 415) when the type is wrong.
 */
function requireJson(req: IncomingMessage, res: ServerResponse): boolean {
  if (!isJsonContentType(req)) {
    sendError(res, 415, 'content-type must be application/json')
    return false
  }
  return true
}

function parseQuery(url: string): URLSearchParams {
  const qIdx = url.indexOf('?')
  return new URLSearchParams(qIdx === -1 ? '' : url.slice(qIdx + 1))
}

function parseListQuery(qs: URLSearchParams): ListNotesQuery {
  const out: ListNotesQuery = {}
  const sessionId = qs.get('sessionId')
  if (sessionId) out.sessionId = sessionId
  const author = qs.get('author')
  if (author === 'human' || author === 'llm') out.author = author
  const kindRaw = qs.getAll('kind')
  if (kindRaw.length === 1) out.kind = kindRaw[0] as NoteKind
  else if (kindRaw.length > 1) out.kind = kindRaw as NoteKind[]
  const since = qs.get('since')
  if (since) out.since = since
  const limit = qs.get('limit')
  if (limit) {
    const n = parseInt(limit, 10)
    if (!Number.isNaN(n) && n > 0) out.limit = n
  }
  return out
}

function pathOf(url: string): string {
  const qIdx = url.indexOf('?')
  return qIdx === -1 ? url : url.slice(0, qIdx)
}

/**
 * Resolve `relPath` against `rootResolved` and return the absolute path
 * ONLY if it stays inside the root. Returns `null` for absolute paths or
 * any `..` escape. `rootResolved` must already be `resolve()`-d.
 */
function containWithinRoot(rootResolved: string, relPath: string): string | null {
  if (isAbsolute(relPath)) return null
  const full = resolve(rootResolved, relPath)
  const rel = relative(rootResolved, full)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null
  return full
}

export function createNotesMiddleware(config: NotesMiddlewareConfig): MiddlewareHandler {
  const { notesRoot, bus, registry, trustedTasks } = config
  const captureTimeoutMs = config.defaultCaptureTimeoutMs ?? DEFAULT_CAPTURE_TIMEOUT_MS
  const heartbeatMs = config.sseHeartbeatMs ?? 15_000
  const format = config.format ?? {}
  // Session-resolution opts derived from format. Pre-built so we don't
  // construct the same object on every request. resolveCurrentSession
  // is idempotent after the marker file exists, but the FIRST call
  // (mint) needs the custom formatter — so all callers pass it.
  const sessionOpts = format.formatSessionFolder
    ? { formatSessionFolder: format.formatSessionFolder }
    : {}

  return (req, res, next) => {
    const url = req.url ?? ''
    if (!url.startsWith(ROUTE_PREFIX)) {
      next()
      return
    }
    const path = pathOf(url)
    const method = (req.method ?? 'GET').toUpperCase()

    // Route table. Order matters: more-specific paths first.
    void route(req, res, path, method, url).catch((err) => {
      const message = err instanceof Error ? err.message : String(err)
      sendError(res, 500, message)
    })
  }

  async function route(
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
    method: string,
    url: string,
  ): Promise<void> {
    // CSRF / cross-site guard. Every state-changing request (create/patch/
    // delete a note, drive the status machine, rotate the session, ingest
    // a bundle, initiate a capture) must be a same-origin call to the
    // loopback dev server. Read-only GETs (list/read/SSE) are exempt — they
    // leak nothing an attacker couldn't already read same-origin, and SSE
    // must stay reachable. See request-guard.ts.
    const mutating =
      method === 'POST' || method === 'PATCH' || method === 'DELETE' || method === 'PUT'
    if (mutating) {
      const reject = checkSameOriginLoopback(req)
      if (reject) return sendError(res, 403, reject)
    }

    // SSE — must respond with text/event-stream and keep open.
    if (path === `${ROUTE_PREFIX}/events`) {
      if (method !== 'GET') return sendError(res, 405, 'method not allowed')
      const qs = parseQuery(url)
      const role = (qs.get('role') ?? 'viewer') as SseRole
      handleSse(req, res, role)
      return
    }

    if (path === `${ROUTE_PREFIX}/notes` && method === 'POST') {
      if (!requireJson(req, res)) return
      const body = await readBody(req)
      let payload: CreateNoteRequest
      try {
        payload = body.json() as CreateNoteRequest
      } catch {
        return sendError(res, 400, 'invalid JSON body')
      }
      if (!payload || typeof payload !== 'object') {
        return sendError(res, 400, 'request body must be an object')
      }
      if (!payload.frontmatter || typeof payload.frontmatter !== 'object') {
        return sendError(res, 400, 'frontmatter is required')
      }
      const result = createNote(notesRoot, payload, format)
      bus.broadcast({
        type: 'note-created',
        id: result.id,
        filename: result.filename,
        author: payload.frontmatter.author,
      })
      // Task-mode (P6): notes that arrive tagged `intent: 'task'`
      // enter the status machine with an 'open' transition so the
      // attention router (and llui_queue) can pick them up. Without
      // this, the note exists on disk but never appears as work.
      if (payload.frontmatter.intent === 'task') {
        // Record provenance: this task note came through the authenticated,
        // same-origin middleware, so the router may spawn an agent for it.
        trustedTasks?.mark(result.sessionId, result.id)
        const sd = resolveSessionDir(notesRoot, result.sessionId)
        appendStatus(sd, {
          ts: new Date().toISOString(),
          noteId: result.id,
          from: null,
          to: 'open',
          by: payload.frontmatter.author,
        })
        bus.broadcast({
          type: 'status-changed',
          noteId: result.id,
          from: null,
          to: 'open',
        })
      }
      // If the note answers a pending capture-request, resolve it.
      if (payload.frontmatter.fulfillsRequestId) {
        registry.fulfill(payload.frontmatter.fulfillsRequestId, result)
      }
      return sendJson(res, 201, result)
    }

    if (path === `${ROUTE_PREFIX}/notes` && method === 'GET') {
      const qs = parseQuery(url)
      const query = parseListQuery(qs)
      return sendJson(res, 200, listNotes(notesRoot, query))
    }

    // /_llui/notes/:id/status — task-mode (P6)
    const statusMatch = /^\/_llui\/notes\/([^/]+)\/status$/.exec(path)
    if (statusMatch) {
      const id = statusMatch[1]!
      const qs = parseQuery(url)
      const sessionId =
        qs.get('sessionId') ?? resolveCurrentSession(notesRoot, sessionOpts).sessionId
      let sessionDir: string
      try {
        sessionDir = resolveSessionDir(notesRoot, sessionId)
      } catch {
        return sendError(res, 400, 'invalid sessionId')
      }

      if (method === 'GET') {
        const history = readStatusHistory(sessionDir, id)
        const current = currentStatus(sessionDir, id)
        return sendJson(res, 200, { noteId: id, sessionId, current, history })
      }
      if (method === 'POST') {
        if (!requireJson(req, res)) return
        const body = await readBody(req)
        let payload: { to: NoteStatus; by?: Author | 'system'; reason?: string }
        try {
          payload = body.json() as typeof payload
        } catch {
          return sendError(res, 400, 'invalid JSON body')
        }
        if (!payload?.to) return sendError(res, 400, '"to" status is required')
        const before = currentStatus(sessionDir, id)
        const transition: StatusTransition = {
          ts: new Date().toISOString(),
          noteId: id,
          from: before,
          to: payload.to,
          by: payload.by ?? 'system',
          ...(payload.reason ? { reason: payload.reason } : {}),
        }
        appendStatus(sessionDir, transition)
        bus.broadcast({
          type: 'status-changed',
          noteId: id,
          from: before,
          to: payload.to,
          ...(payload.reason ? { reason: payload.reason } : {}),
        })

        // 'accepted' is a no-op apply now: the LLM already wrote the
        // files during the spawn (direct-edit architecture). We just
        // move to 'applied' and clean up transient note files. The
        // reply note's proposedDiff stays on disk in case the user
        // wants to re-inspect later.
        if (payload.to === 'accepted') {
          const followUp: StatusTransition = {
            ts: new Date().toISOString(),
            noteId: id,
            from: 'accepted',
            to: 'applied',
            by: 'system',
          }
          appendStatus(sessionDir, followUp)
          bus.broadcast({
            type: 'status-changed',
            noteId: id,
            from: 'accepted',
            to: 'applied',
          })
          const cleanedUp = cleanupResolvedTask(notesRoot, sessionId, id)
          return sendJson(res, 200, { transition, apply: { ok: true }, cleanedUp })
        }
        // 'rejected' reverts the LLM's working-tree changes: git
        // checkout HEAD -- for tracked edits, rm for newly-created
        // files. The proposedDiff on the reply note tells us which
        // files to act on.
        if (payload.to === 'rejected') {
          const revert = revertProposedChanges(notesRoot, sessionId, id)
          if (revert.reason) {
            // Attach revert outcome to the rejection event so the HUD
            // can show what actually happened.
            const followUp: StatusTransition = {
              ts: new Date().toISOString(),
              noteId: id,
              from: 'rejected',
              to: revert.ok ? 'rejected' : 'failed',
              by: 'system',
              reason: revert.reason,
            }
            appendStatus(sessionDir, followUp)
            bus.broadcast({
              type: 'status-changed',
              noteId: id,
              from: 'rejected',
              to: followUp.to,
              reason: revert.reason,
            })
          }
          return sendJson(res, 200, { transition, revert })
        }
        return sendJson(res, 200, { transition })
      }
      return sendError(res, 405, 'method not allowed')
    }

    if (path === `${ROUTE_PREFIX}/queue` && method === 'GET') {
      const qs = parseQuery(url)
      const sessionId =
        qs.get('sessionId') ?? resolveCurrentSession(notesRoot, sessionOpts).sessionId
      let sessionDir: string
      try {
        sessionDir = resolveSessionDir(notesRoot, sessionId)
      } catch {
        return sendError(res, 400, 'invalid sessionId')
      }
      const statusFilter = qs.getAll('status') as NoteStatus[]
      const queue = listQueue(sessionDir, statusFilter.length > 0 ? { status: statusFilter } : {})
      return sendJson(res, 200, { sessionId, queue })
    }

    // /_llui/notes/:id and /_llui/notes/:id/screenshot
    const noteIdMatch = /^\/_llui\/notes\/([^/]+)(\/screenshot)?$/.exec(path)
    if (noteIdMatch) {
      const id = noteIdMatch[1]!
      const isScreenshot = noteIdMatch[2] === '/screenshot'
      const qs = parseQuery(url)
      const sessionId =
        qs.get('sessionId') ?? resolveCurrentSession(notesRoot, sessionOpts).sessionId

      if (isScreenshot) {
        if (method !== 'GET') return sendError(res, 405, 'method not allowed')
        const bytes = readScreenshot(notesRoot, sessionId, id)
        if (!bytes) return sendError(res, 404, 'screenshot not found')
        res.statusCode = 200
        res.setHeader('content-type', 'image/png')
        res.end(bytes)
        return
      }

      if (method === 'GET') {
        try {
          const note = readNote(notesRoot, sessionId, id)
          // `?format=json` returns the parsed SerializedNote (with
          // frontmatter + prose + body). Used by the in-app browse view
          // so it doesn't have to re-parse YAML/markdown client-side.
          if (parseQuery(url).get('format') === 'json') {
            return sendJson(res, 200, note)
          }
          const md = serializeNote(note)
          return sendText(res, 200, 'text/markdown; charset=utf-8', md)
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'unknown'
          return sendError(res, 404, msg)
        }
      }

      if (method === 'PATCH') {
        if (!requireJson(req, res)) return
        const body = await readBody(req)
        let payload: { prose?: unknown }
        try {
          payload = body.json() as { prose?: unknown }
        } catch {
          return sendError(res, 400, 'invalid JSON body')
        }
        if (typeof payload?.prose !== 'string') {
          return sendError(res, 400, 'body must include { prose: string }')
        }
        try {
          const updated = updateNoteProse(notesRoot, sessionId, id, payload.prose)
          bus.broadcast({ type: 'note-updated', id, sessionId })
          return sendJson(res, 200, { id, sessionId, prose: updated.prose })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'unknown'
          return sendError(res, 404, msg)
        }
      }

      if (method === 'DELETE') {
        const removed = deleteNote(notesRoot, sessionId, id)
        if (removed.length === 0) return sendError(res, 404, 'note not found')
        bus.broadcast({ type: 'note-deleted', id, sessionId })
        return sendJson(res, 200, { id, sessionId, removed })
      }

      return sendError(res, 405, 'method not allowed')
    }

    if (path === `${ROUTE_PREFIX}/sessions` && method === 'GET') {
      return sendJson(res, 200, { sessions: listSessions(notesRoot) })
    }

    // Ingest an export bundle (zip of the on-disk layout) from a browser
    // capture-only HUD. Idempotent + namespaced; see notes/import.ts.
    if (path === `${ROUTE_PREFIX}/import` && method === 'POST') {
      const body = await readBody(req)
      if (body.raw.length === 0) return sendError(res, 400, 'import: empty request body')
      let result
      try {
        result = importBundle(notesRoot, new Uint8Array(body.raw))
      } catch (err) {
        return sendError(res, 400, err instanceof Error ? err.message : String(err))
      }
      // Imported sessions are new folders; nudge listeners to refresh.
      for (const sessionId of result.importedSessions) {
        bus.broadcast({ type: 'session-rotated', sessionId })
      }
      return sendJson(res, 200, result)
    }

    if (path === `${ROUTE_PREFIX}/session/current` && method === 'GET') {
      const session = resolveCurrentSession(notesRoot, sessionOpts)
      return sendJson(res, 200, {
        sessionId: session.sessionId,
        startedAt: session.startedAt,
        notesDir: session.notesDir,
      })
    }

    if (path === `${ROUTE_PREFIX}/session/rotate` && method === 'POST') {
      const rotated = rotateSession(notesRoot, sessionOpts)
      bus.broadcast({ type: 'session-rotated', sessionId: rotated.sessionId })
      return sendJson(res, 200, {
        sessionId: rotated.sessionId,
        previousSessionId: rotated.previousSessionId,
        notesDir: rotated.notesDir,
      })
    }

    if (path === `${ROUTE_PREFIX}/capture-request` && method === 'POST') {
      if (!requireJson(req, res)) return
      const body = await readBody(req)
      let payload: CaptureRequestPayload
      try {
        payload = body.json() as CaptureRequestPayload
      } catch {
        return sendError(res, 400, 'invalid JSON body')
      }
      const hudConnected = bus.countByRole('hud') > 0
      const submitted = registry.submit(payload ?? {}, {
        timeoutMs: payload?.timeoutMs ?? captureTimeoutMs,
        hudConnected,
      })
      // Push the SSE event so the HUD sees it.
      if (hudConnected) {
        bus.broadcast({
          type: 'capture-request',
          requestId: submitted.requestId,
          payload: submitted.payload,
        })
      }
      const response = await submitted.promise
      if (response.status !== 'fulfilled') {
        bus.broadcast({
          type: 'capture-request-cancelled',
          requestId: submitted.requestId,
        })
      }
      return sendJson(res, 200, response)
    }

    sendError(res, 404, `unknown route: ${method} ${path}`)
  }

  function handleSse(req: IncomingMessage, res: ServerResponse, role: SseRole): void {
    res.statusCode = 200
    res.setHeader('content-type', 'text/event-stream')
    res.setHeader('cache-control', 'no-cache, no-transform')
    res.setHeader('connection', 'keep-alive')
    // Some proxies buffer responses without an explicit flush header.
    res.setHeader('x-accel-buffering', 'no')

    // Initial comment forces the headers to flush in browsers that wait
    // for first byte before fulfilling the EventSource open.
    res.write(': llui-notes\n\n')

    const send = (event: ServerEvent): void => {
      res.write(`data: ${JSON.stringify(event)}\n\n`)
    }
    const unsubscribe = bus.subscribe(role, send)

    const heartbeat = setInterval(() => {
      res.write(': hb\n\n')
    }, heartbeatMs)

    const cleanup = (): void => {
      clearInterval(heartbeat)
      unsubscribe()
    }
    req.on('close', cleanup)
    res.on('close', cleanup)
  }
}

/** Re-export the joined path of the notes-root setting under a session
 *  for callers that want to compose paths from outside.  */
export function sessionDir(notesRoot: string, sessionId: string): string {
  // Containment-safe: throws if `sessionId` escapes the notes root.
  return resolveSessionDir(notesRoot, sessionId)
}

/**
 * Find the most recent reply note for a task and `git apply` its
 * proposedDiff against the project working tree. The proposal
 * (`docs/proposals/devmode-annotate/05-task-mode.md`) calls for
 * git-apply against the working tree; commits stay the developer's
 * responsibility.
 */
/**
 * Revert the LLM's working-tree changes for a rejected task. For
 * each file in the reply's proposedDiff:
 *  - If tracked at HEAD: `git checkout HEAD -- <file>`
 *  - Otherwise (newly created): rm
 *
 * Reports per-file failures in `reason` without aborting the whole
 * revert. The project root is `process.cwd()` (same as where the
 * router spawned claude).
 */
function revertProposedChanges(
  notesRoot: string,
  sessionId: string,
  taskNoteId: string,
): { ok: boolean; reason?: string; reverted?: string[] } {
  const list = listNotes(notesRoot, { sessionId, kind: 'reply' })
  let chosen: ProposedDiff | null = null
  for (const summary of list.notes.slice().reverse()) {
    try {
      const note = readNote(notesRoot, sessionId, summary.id)
      const fm = note.frontmatter as typeof note.frontmatter & { proposedDiff?: ProposedDiff }
      if (fm.replyTo !== taskNoteId) continue
      if (!fm.proposedDiff) continue
      chosen = fm.proposedDiff
      break
    } catch {
      continue
    }
  }
  if (!chosen || chosen.files.length === 0) {
    return { ok: true, reverted: [] }
  }

  const projectRoot = process.cwd()
  const isTracked = (path: string): boolean => {
    try {
      execFileSync('git', ['ls-files', '--error-unmatch', '--', path], {
        cwd: projectRoot,
        stdio: ['ignore', 'ignore', 'ignore'],
      })
      return true
    } catch {
      return false
    }
  }
  const reverted: string[] = []
  const failures: string[] = []
  const rootResolved = resolve(projectRoot)
  for (const file of chosen.files) {
    // Containment: a note's proposedDiff is untrusted input. An absolute
    // path or one that climbs out with `..` must never reach `git checkout`
    // or `unlinkSync` — that would revert/delete arbitrary files anywhere on
    // disk. Reject anything that doesn't resolve to a path inside the
    // project root.
    const safe = containWithinRoot(rootResolved, file.path)
    if (!safe) {
      failures.push(`${file.path}: path escapes project root`)
      continue
    }
    try {
      if (isTracked(file.path)) {
        execFileSync('git', ['checkout', 'HEAD', '--', file.path], {
          cwd: projectRoot,
          stdio: ['ignore', 'ignore', 'pipe'],
        })
      } else if (existsSync(safe)) {
        unlinkSync(safe)
      }
      reverted.push(file.path)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      failures.push(`${file.path}: ${msg.split('\n')[0]}`)
    }
  }
  if (failures.length > 0) {
    return {
      ok: false,
      reverted,
      reason: `revert: ${failures.length} of ${chosen.files.length} files failed (${failures.join('; ').slice(0, 200)})`,
    }
  }
  return { ok: true, reverted, reason: `reverted ${reverted.length} file(s)` }
}

// The patch-based apply path was removed in favour of direct-edit
// semantics: the router lets the LLM edit files in place, captures
// the resulting `git diff` as the proposedDiff, and on Accept just
// transitions to `applied` (no patch application needed).

/** Coerce a string to Author or null. */
export function asAuthor(v: unknown): Author | null {
  return v === 'human' || v === 'llm' ? v : null
}
