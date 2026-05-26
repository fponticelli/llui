// HTTP middleware for the devmode-annotate notebook. Mounts a single
// handler at /_llui/ and dispatches internally to the endpoints described
// in 02-middleware.md.
//
// Transport-agnostic: takes a `notesRoot` + an `EventBus` + a
// `CaptureRegistry` and returns a Connect-style `(req, res, next)`
// handler. The Vite plugin wires it via `server.middlewares.use('/_llui',
// handler)`; tests mount it on a plain node http.Server.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { CaptureRegistry } from './capture-registry.js'
import type { EventBus } from './event-bus.js'
import {
  cleanupResolvedTask,
  createNote,
  deleteNote,
  listNotes,
  listSessions,
  readNote,
  readScreenshot,
  updateNoteProse,
  type NoteFormatConfig,
} from './store.js'
import { rotateSession, resolveCurrentSession } from './session.js'
import { serializeNote } from './frontmatter.js'
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

export function createNotesMiddleware(config: NotesMiddlewareConfig): MiddlewareHandler {
  const { notesRoot, bus, registry } = config
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
    // SSE — must respond with text/event-stream and keep open.
    if (path === `${ROUTE_PREFIX}/events`) {
      if (method !== 'GET') return sendError(res, 405, 'method not allowed')
      const qs = parseQuery(url)
      const role = (qs.get('role') ?? 'viewer') as SseRole
      handleSse(req, res, role)
      return
    }

    if (path === `${ROUTE_PREFIX}/notes` && method === 'POST') {
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
        const sd = join(notesRoot, result.sessionId)
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
      const sessionDir = join(notesRoot, sessionId)

      if (method === 'GET') {
        const history = readStatusHistory(sessionDir, id)
        const current = currentStatus(sessionDir, id)
        return sendJson(res, 200, { noteId: id, sessionId, current, history })
      }
      if (method === 'POST') {
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

        // 'accepted' triggers an automatic git apply of the most recent
        // reply note's proposedDiff. On success → 'applied'; on patch
        // failure → 'failed' with the apply error in `reason`.
        if (payload.to === 'accepted') {
          const apply = applyProposedDiffForTask(notesRoot, sessionId, id)
          const followUp: StatusTransition = {
            ts: new Date().toISOString(),
            noteId: id,
            from: 'accepted',
            to: apply.ok ? 'applied' : 'failed',
            by: 'system',
            ...(apply.reason ? { reason: apply.reason } : {}),
          }
          appendStatus(sessionDir, followUp)
          bus.broadcast({
            type: 'status-changed',
            noteId: id,
            from: 'accepted',
            to: followUp.to,
            ...(apply.reason ? { reason: apply.reason } : {}),
          })
          // Successful applies clean up the task's transient files —
          // the task note, its reply notes, and screenshots. The
          // status.jsonl audit trail is preserved.
          let cleanedUp: string[] = []
          if (apply.ok) {
            cleanedUp = cleanupResolvedTask(notesRoot, sessionId, id)
          }
          return sendJson(res, 200, { transition, apply, cleanedUp })
        }
        return sendJson(res, 200, { transition })
      }
      return sendError(res, 405, 'method not allowed')
    }

    if (path === `${ROUTE_PREFIX}/queue` && method === 'GET') {
      const qs = parseQuery(url)
      const sessionId =
        qs.get('sessionId') ?? resolveCurrentSession(notesRoot, sessionOpts).sessionId
      const sessionDir = join(notesRoot, sessionId)
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
  return join(notesRoot, sessionId)
}

interface ApplyResult {
  ok: boolean
  reason?: string
  appliedFiles?: string[]
}

/**
 * Find the most recent reply note for a task and `git apply` its
 * proposedDiff against the project working tree. The proposal
 * (`docs/proposals/devmode-annotate/05-task-mode.md`) calls for
 * git-apply against the working tree; commits stay the developer's
 * responsibility.
 */
/**
 * Normalize a single-file unified diff produced by the LLM:
 *  - CRLF → LF (the model occasionally emits CRLF in templated output)
 *  - Strip a stray UTF-8 BOM from the front
 *  - Guarantee a trailing newline (concatenating patches together
 *    without trailing newlines produces "corrupt patch at line N"
 *    when the last line of patch[i] runs into the diff header of
 *    patch[i+1]).
 */
function normalizePatchText(patch: string): string {
  let s = patch
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1)
  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (!s.endsWith('\n')) s += '\n'
  return s
}

/**
 * Pretty-print a patch with line numbers for the console log. When
 * git reports "corrupt patch at line N" we underline the offending
 * line so the developer can spot it at a glance.
 */
function annotatePatchForLog(patch: string, errorMessage: string): string {
  const m = /corrupt patch at line (\d+)/.exec(errorMessage)
  const bad = m ? parseInt(m[1]!, 10) : -1
  const lines = patch.split('\n')
  const width = String(lines.length).length
  return lines
    .map((line, i) => {
      const lineNum = i + 1
      const pad = String(lineNum).padStart(width, ' ')
      const marker = lineNum === bad ? '>>' : '  '
      return `${marker} ${pad} │ ${line}`
    })
    .join('\n')
}

function applyProposedDiffForTask(
  notesRoot: string,
  sessionId: string,
  taskNoteId: string,
): ApplyResult {
  // Find replies to this task. Iterate the session's notes; pick the
  // newest one with kind='reply', replyTo===taskNoteId, proposedDiff
  // populated.
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
  if (!chosen) {
    return { ok: false, reason: 'no reply with proposedDiff found for this task' }
  }

  // Write a temp .patch file with the concatenated patches and feed
  // it to `git apply`. The project root is the parent of `notesRoot`'s
  // `.llui/notes` ancestor — pragmatically, we use process.cwd() since
  // the middleware is mounted by Vite which runs at the project root.
  //
  // Each file's patch is normalized first: CRLF → LF (the LLM may
  // emit CRLF in templated output) + a guaranteed trailing newline.
  // Without these, git refuses with "corrupt patch at line N".
  const tmp = mkdtempSync(join(tmpdir(), 'llui-apply-'))
  const patchFile = join(tmp, 'change.patch')
  const combined = chosen.files.map((f) => normalizePatchText(f.patch)).join('')
  writeFileSync(patchFile, combined, 'utf8')
  /** Run git apply with a given arg list; rethrow on failure so the
   *  caller can fall back / report the error. */
  const tryApply = (extraFlags: string[]): void => {
    execFileSync('git', ['apply', '--whitespace=nowarn', ...extraFlags, patchFile], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  }
  /** Extract a useful, single-line reason from an execFileSync error.
   *  `err.stderr` (Buffer) holds the actual git diagnostic; `err.message`
   *  is the generic "Command failed: ..." wrapper. */
  const reasonFromErr = (err: unknown): { firstLine: string; full: string } => {
    const e = err as { stderr?: Buffer | string; stdout?: Buffer | string; message?: string }
    const stderrText =
      e.stderr instanceof Buffer
        ? e.stderr.toString('utf8')
        : typeof e.stderr === 'string'
          ? e.stderr
          : ''
    const stdoutText =
      e.stdout instanceof Buffer
        ? e.stdout.toString('utf8')
        : typeof e.stdout === 'string'
          ? e.stdout
          : ''
    const full = (stderrText || stdoutText || e.message || String(err)).trim()
    const firstLine = full.split('\n').find((l) => l.trim().length > 0) ?? full
    return { firstLine, full }
  }

  // First pass: straight apply. Handles the common case where the
  // source matches what the LLM was looking at.
  try {
    tryApply([])
    rmSync(tmp, { recursive: true, force: true })
    return { ok: true, appliedFiles: chosen.files.map((f) => f.path) }
  } catch (err1) {
    // Second pass: --3way fallback. Lets git use the index to perform
    // a 3-way merge when the source has drifted slightly since the
    // LLM produced the patch. Conflicts left as <<<<<<< markers in
    // the working tree — better than a flat rejection.
    try {
      tryApply(['--3way'])
      rmSync(tmp, { recursive: true, force: true })
      return { ok: true, appliedFiles: chosen.files.map((f) => f.path) }
    } catch (err2) {
      // Both passes failed. Keep the patch around for inspection and
      // surface the 3-way error (it's typically more informative
      // about which hunks couldn't merge).
      const r1 = reasonFromErr(err1)
      const r2 = reasonFromErr(err2)
      // Save the failing patch next to the task note so the
      // developer can inspect it without hunting through /tmp. The
      // file lives alongside the session's notes and stays after
      // restart.
      const savedPath = join(notesRoot, sessionId, `${taskNoteId}.patch.failed`)
      try {
        writeFileSync(savedPath, combined, 'utf8')
      } catch {
        // Best-effort; the toast reason still carries enough info.
      }
      const errLineMessage = r1.full || r2.full
      console.warn('[llui:apply] straight git apply failed:\n' + r1.full)
      console.warn('[llui:apply] --3way fallback failed:\n' + r2.full)
      console.warn('[llui:apply] patch saved to:', savedPath)
      console.warn(
        '[llui:apply] patch contents (>> marks the offending line):\n' +
          annotatePatchForLog(combined, errLineMessage),
      )
      rmSync(tmp, { recursive: true, force: true })
      // Prefer the 3-way line; fall back to the straight-apply line.
      const firstLine = r2.firstLine || r1.firstLine
      return {
        ok: false,
        reason: `git apply failed: ${firstLine} (patch saved to ${savedPath})`,
      }
    }
  }
}

/** Coerce a string to Author or null. */
export function asAuthor(v: unknown): Author | null {
  return v === 'human' || v === 'llm' ? v : null
}
