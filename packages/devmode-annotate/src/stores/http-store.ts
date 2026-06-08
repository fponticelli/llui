// HTTP NotesStore core — the shared implementation behind both
// `devServerStore` (rooted at `${origin}/_llui`) and the public `httpStore`
// (any host backend + injected auth). One transport, two front doors:
// dev parity is preserved because devServerStore is just this with
// `baseUrl = ${origin}/_llui` and no extra headers.

import type {
  CreateNoteRequest,
  CreateNoteResponse,
  CurrentSessionResponse,
  ListNotesQuery,
  ListNotesResponse,
  ServerEvent,
} from '../note-types.js'
import type {
  EventSubscription,
  FullNote,
  NotesStore,
  NoteStatusResponse,
  NoteUpdate,
  QueueResponse,
  SessionSummary,
  StatusUpdate,
} from '../notes-store.js'

/** Static headers, or a (sync/async) function called per request so tokens
 *  can refresh. */
export type HeadersInput =
  | Record<string, string>
  | (() => Record<string, string> | Promise<Record<string, string>>)

export interface HttpNotesStoreOptions {
  /** Base URL the notebook endpoints live under, no trailing slash. Endpoints
   *  are `${baseUrl}/notes`, `${baseUrl}/sessions`, `${baseUrl}/events`, … */
  baseUrl: string
  /** Headers injected on every request (e.g. `Authorization`). */
  headers?: HeadersInput
  /** Override fetch (tests / custom transport). Defaults to global `fetch`. */
  fetchImpl?: typeof fetch
}

async function resolveHeaders(h?: HeadersInput): Promise<Record<string, string>> {
  if (!h) return {}
  return typeof h === 'function' ? h() : h
}

export function createHttpNotesStore(opts: HttpNotesStoreOptions): NotesStore {
  const { baseUrl } = opts
  const doFetch: typeof fetch = opts.fetchImpl ?? ((input, init) => fetch(input, init))
  const sid = (sessionId: string): string => encodeURIComponent(sessionId)

  const get = async (url: string): Promise<Response> =>
    doFetch(url, { headers: await resolveHeaders(opts.headers) })

  const send = async (url: string, method: string, body?: unknown): Promise<Response> => {
    const headers: Record<string, string> = { ...(await resolveHeaders(opts.headers)) }
    if (body !== undefined) headers['content-type'] = 'application/json'
    return doFetch(url, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
  }

  return {
    async createNote(req: CreateNoteRequest): Promise<CreateNoteResponse> {
      const url = `${baseUrl}/notes`
      const res = await send(url, 'POST', req)
      if (!res.ok) throw new Error(`devmode-annotate: POST ${url} → ${res.status}`)
      return (await res.json()) as CreateNoteResponse
    },

    async listSessions(): Promise<SessionSummary[]> {
      const res = await get(`${baseUrl}/sessions`)
      if (!res.ok) throw new Error(`GET ${baseUrl}/sessions → ${res.status}`)
      const payload = (await res.json()) as { sessions?: SessionSummary[] }
      return payload.sessions ?? []
    },

    async currentSession(): Promise<CurrentSessionResponse> {
      const res = await get(`${baseUrl}/session/current`)
      if (!res.ok) throw new Error(`GET ${baseUrl}/session/current → ${res.status}`)
      return (await res.json()) as CurrentSessionResponse
    },

    async listNotes(query: ListNotesQuery): Promise<ListNotesResponse> {
      const sessionId = query.sessionId ?? ''
      const res = await get(`${baseUrl}/notes?sessionId=${sid(sessionId)}`)
      if (!res.ok) throw new Error(`GET ${baseUrl}/notes → ${res.status}`)
      return (await res.json()) as ListNotesResponse
    },

    async readNote(id: string, sessionId: string): Promise<FullNote | null> {
      const res = await get(`${baseUrl}/notes/${id}?sessionId=${sid(sessionId)}&format=json`)
      if (!res.ok) return null
      return (await res.json()) as FullNote
    },

    async getStatus(id: string, sessionId: string): Promise<NoteStatusResponse> {
      const res = await get(`${baseUrl}/notes/${id}/status?sessionId=${sid(sessionId)}`)
      if (!res.ok) throw new Error(`GET ${baseUrl}/notes/${id}/status → ${res.status}`)
      return (await res.json()) as NoteStatusResponse
    },

    async getQueue(sessionId: string): Promise<QueueResponse> {
      const res = await get(`${baseUrl}/queue?sessionId=${sid(sessionId)}`)
      if (!res.ok) throw new Error(`GET ${baseUrl}/queue → ${res.status}`)
      return (await res.json()) as QueueResponse
    },

    async deleteNote(id: string, sessionId: string): Promise<void> {
      const res = await send(`${baseUrl}/notes/${id}?sessionId=${sid(sessionId)}`, 'DELETE')
      if (!res.ok) throw new Error(`DELETE ${baseUrl}/notes/${id} → ${res.status}`)
    },

    async updateNote(id: string, sessionId: string, update: NoteUpdate): Promise<void> {
      const res = await send(`${baseUrl}/notes/${id}?sessionId=${sid(sessionId)}`, 'PATCH', update)
      if (!res.ok) throw new Error(`PATCH ${baseUrl}/notes/${id} → ${res.status}`)
    },

    async postStatus(id: string, sessionId: string, update: StatusUpdate): Promise<void> {
      const res = await send(
        `${baseUrl}/notes/${id}/status?sessionId=${sid(sessionId)}`,
        'POST',
        update,
      )
      if (!res.ok) throw new Error(`POST ${baseUrl}/notes/${id}/status → ${res.status}`)
    },

    screenshotUrl(id: string, screenshotRef: string): string {
      return `${baseUrl}/notes/${id}/screenshot?ts=${encodeURIComponent(screenshotRef)}`
    },

    subscribeEvents(sub: EventSubscription): () => void {
      // Native EventSource can't carry custom auth headers; the events channel
      // relies on same-origin cookies (or no auth). It's optional — capture
      // works without it.
      if (typeof EventSource === 'undefined') return () => {}
      let source: EventSource | null = null
      try {
        source = new EventSource(`${baseUrl}/events?role=${sub.role}`)
      } catch (err) {
        sub.onError?.(err)
        return () => {}
      }
      const onMessage = (e: MessageEvent): void => {
        let parsed: ServerEvent
        try {
          parsed = JSON.parse(e.data as string) as ServerEvent
        } catch {
          return
        }
        sub.onEvent(parsed)
      }
      source.addEventListener('message', onMessage)
      // NOTE: we intentionally do NOT forward EventSource 'error' events to
      // `sub.onError`. The browser fires 'error' on every routine auto-
      // reconnect, so escalating them would spam logs for benign blips;
      // EventSource recovers on its own. `onError` is reserved for the
      // construction failure handled above.
      return () => {
        source?.removeEventListener('message', onMessage)
        source?.close()
      }
    },
  }
}

export interface HttpStoreOptions {
  /** Base URL the host's notebook backend lives under, no trailing slash. */
  baseUrl: string
  /** Headers injected on every request (e.g. an auth token). Never bake
   *  credentials into the bundle — supply them here at mount time. */
  headers?: HeadersInput
  /** Override fetch (tests / custom transport). */
  fetch?: typeof fetch
}

/**
 * A NotesStore that talks to a host-provided HTTP backend. Use in production
 * when a team wants centralized capture instead of manual export/import. The
 * backend must speak the notebook wire protocol (the same shapes the dev
 * server serves under `/_llui`).
 */
export function httpStore(opts: HttpStoreOptions): NotesStore {
  return createHttpNotesStore({
    baseUrl: opts.baseUrl,
    ...(opts.headers !== undefined ? { headers: opts.headers } : {}),
    ...(opts.fetch !== undefined ? { fetchImpl: opts.fetch } : {}),
  })
}
