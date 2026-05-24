// HTTP middleware for the devmode-annotate notebook. Mounts a single
// handler at /_llui/ and dispatches internally to the endpoints described
// in 02-middleware.md.
//
// Transport-agnostic: takes a `notesRoot` + an `EventBus` + a
// `CaptureRegistry` and returns a Connect-style `(req, res, next)`
// handler. The Vite plugin wires it via `server.middlewares.use('/_llui',
// handler)`; tests mount it on a plain node http.Server.

import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'

import type { CaptureRegistry } from './capture-registry.js'
import type { EventBus } from './event-bus.js'
import { createNote, listNotes, listSessions, readNote, readScreenshot } from './store.js'
import { rotateSession, resolveCurrentSession } from './session.js'
import { serializeNote } from './frontmatter.js'
import type {
  Author,
  CaptureRequestPayload,
  CreateNoteRequest,
  ListNotesQuery,
  NoteKind,
  ServerEvent,
  SseRole,
} from './types.js'

export interface NotesMiddlewareConfig {
  notesRoot: string
  bus: EventBus
  registry: CaptureRegistry
  defaultCaptureTimeoutMs?: number
  /** Heartbeat interval for SSE keepalive in ms. Default 15000. */
  sseHeartbeatMs?: number
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
      const result = createNote(notesRoot, payload)
      bus.broadcast({
        type: 'note-created',
        id: result.id,
        filename: result.filename,
        author: payload.frontmatter.author,
      })
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

    // /_llui/notes/:id and /_llui/notes/:id/screenshot
    const noteIdMatch = /^\/_llui\/notes\/([^/]+)(\/screenshot)?$/.exec(path)
    if (noteIdMatch) {
      const id = noteIdMatch[1]!
      const isScreenshot = noteIdMatch[2] === '/screenshot'
      const qs = parseQuery(url)
      const sessionId = qs.get('sessionId') ?? resolveCurrentSession(notesRoot).sessionId

      if (method !== 'GET') return sendError(res, 405, 'method not allowed')

      if (isScreenshot) {
        const bytes = readScreenshot(notesRoot, sessionId, id)
        if (!bytes) return sendError(res, 404, 'screenshot not found')
        res.statusCode = 200
        res.setHeader('content-type', 'image/png')
        res.end(bytes)
        return
      }

      try {
        const note = readNote(notesRoot, sessionId, id)
        const md = serializeNote(note)
        return sendText(res, 200, 'text/markdown; charset=utf-8', md)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown'
        return sendError(res, 404, msg)
      }
    }

    if (path === `${ROUTE_PREFIX}/sessions` && method === 'GET') {
      return sendJson(res, 200, { sessions: listSessions(notesRoot) })
    }

    if (path === `${ROUTE_PREFIX}/session/current` && method === 'GET') {
      const session = resolveCurrentSession(notesRoot)
      return sendJson(res, 200, {
        sessionId: session.sessionId,
        startedAt: session.startedAt,
        notesDir: session.notesDir,
      })
    }

    if (path === `${ROUTE_PREFIX}/session/rotate` && method === 'POST') {
      const rotated = rotateSession(notesRoot)
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

/** Coerce a string to Author or null. */
export function asAuthor(v: unknown): Author | null {
  return v === 'human' || v === 'llm' ? v : null
}
