import { afterEach, describe, expect, it, vi } from 'vitest'
import { httpStore } from '../src/stores/http-store.js'
import type { CreateNoteRequest } from '../src/note-types.js'

const BASE = 'https://notes.example.com/api'

// jsdom ships no EventSource. A minimal stub that records construction and
// close, so the SSE half of `dispose()` is observable (the same shape as
// `FakeES` in notes-store.test.ts / `StubEventSource` in live-feedback.test.ts).
class FakeEventSource {
  static instances: FakeEventSource[] = []
  closed = 0
  listeners = new Map<string, (e: MessageEvent) => void>()
  constructor(public url: string) {
    FakeEventSource.instances.push(this)
  }
  addEventListener(type: string, cb: (e: MessageEvent) => void): void {
    this.listeners.set(type, cb)
  }
  removeEventListener(type: string): void {
    this.listeners.delete(type)
  }
  close(): void {
    this.closed++
  }
}

function stubEventSource(): typeof FakeEventSource {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource)
  return FakeEventSource
}

interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

function recorder(responses: Record<string, unknown> = {}): {
  calls: Call[]
  fetch: typeof fetch
} {
  const calls: Call[] = []
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: (init?.headers as Record<string, string>) ?? {},
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    })
    const key = Object.keys(responses).find((k) => url.includes(k))
    return {
      ok: true,
      status: 200,
      json: async () => (key ? responses[key] : {}),
    } as Response
  }) as unknown as typeof fetch
  return { calls, fetch: fetchImpl }
}

describe('httpStore', () => {
  it('routes to the configured baseUrl and injects auth headers on every request', async () => {
    const { calls, fetch } = recorder({
      '/notes': { id: 'n1', filename: 'f', path: 'p', sessionId: 's1' },
    })
    const store = httpStore({ baseUrl: BASE, headers: { Authorization: 'Bearer T' }, fetch })
    const req = { body: 'hi', frontmatter: {}, noteBody: {} } as unknown as CreateNoteRequest
    await store.createNote(req)
    await store.listSessions()

    expect(calls[0]).toMatchObject({
      url: `${BASE}/notes`,
      method: 'POST',
      body: req,
    })
    expect(calls[0]!.headers['content-type']).toBe('application/json')
    expect(calls[0]!.headers.Authorization).toBe('Bearer T')
    // GET also carries the auth header (no content-type since no body)
    expect(calls[1]!.url).toBe(`${BASE}/sessions`)
    expect(calls[1]!.headers.Authorization).toBe('Bearer T')
    expect(calls[1]!.headers['content-type']).toBeUndefined()
  })

  it('supports a per-request headers function (token refresh)', async () => {
    let n = 0
    const { calls, fetch } = recorder()
    const store = httpStore({
      baseUrl: BASE,
      headers: () => ({ Authorization: `Bearer T${++n}` }),
      fetch,
    })
    await store.listSessions()
    await store.listSessions()
    expect(calls[0]!.headers.Authorization).toBe('Bearer T1')
    expect(calls[1]!.headers.Authorization).toBe('Bearer T2')
  })

  it('maps the wire protocol like the dev server (status, queue, screenshot url)', async () => {
    const { calls, fetch } = recorder({
      '/notes/n1/status': { current: 'open', history: [] },
      '/queue': { queue: [] },
    })
    const store = httpStore({ baseUrl: BASE, fetch })
    expect((await store.getStatus('n1', 's1')).current).toBe('open')
    await store.postStatus('n1', 's1', { to: 'accepted', by: 'human' })
    expect(store.screenshotUrl('n1', 'shot.png')).toBe(`${BASE}/notes/n1/screenshot?ts=shot.png`)
    expect(calls[0]!.url).toBe(`${BASE}/notes/n1/status?sessionId=s1`)
    expect(calls[1]).toMatchObject({
      url: `${BASE}/notes/n1/status?sessionId=s1`,
      method: 'POST',
      body: { to: 'accepted', by: 'human' },
    })
  })

  it('readNote returns null on a non-ok response', async () => {
    const fetchImpl = (async () =>
      ({ ok: false, status: 404 }) as Response) as unknown as typeof fetch
    const store = httpStore({ baseUrl: BASE, fetch: fetchImpl })
    expect(await store.readNote('nope', 's1')).toBeNull()
  })

  it('works without headers (no auth)', async () => {
    const { calls, fetch } = recorder({ '/sessions': { sessions: [{ id: 's1', noteCount: 0 }] } })
    const store = httpStore({ baseUrl: BASE, fetch })
    expect(await store.listSessions()).toHaveLength(1)
    expect(calls[0]!.headers.Authorization).toBeUndefined()
  })
})

// #114 — the SSE half of `dispose()`. The URL-cache half is covered by
// store-url-lifecycle.test.ts; without these, deleting the close loop in
// `http-store.ts`'s `dispose()` leaves the whole suite green.
describe('httpStore dispose()', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('closes an EventSource whose unsubscribe was never called', () => {
    const ES = stubEventSource()
    const { fetch } = recorder()
    const store = httpStore({ baseUrl: BASE, fetch })
    store.subscribeEvents({ role: 'hud', onEvent: () => {} })
    store.subscribeEvents({ role: 'viewer', onEvent: () => {} })
    expect(ES.instances).toHaveLength(2)
    expect(ES.instances.map((s) => s.closed)).toEqual([0, 0])

    store.dispose()

    expect(ES.instances.map((s) => s.closed)).toEqual([1, 1])
  })

  it('clears its live-source set, so a second dispose() does not re-close', () => {
    const ES = stubEventSource()
    const { fetch } = recorder()
    const store = httpStore({ baseUrl: BASE, fetch })
    store.subscribeEvents({ role: 'hud', onEvent: () => {} })
    store.dispose()
    expect(ES.instances[0]!.closed).toBe(1)

    // Idempotent, and the set is empty rather than merely re-closed: a second
    // dispose() touches nothing.
    store.dispose()
    expect(ES.instances[0]!.closed).toBe(1)
  })

  it('does not double-close a source whose unsubscribe already ran', () => {
    const ES = stubEventSource()
    const { fetch } = recorder()
    const store = httpStore({ baseUrl: BASE, fetch })
    const off = store.subscribeEvents({ role: 'hud', onEvent: () => {} })
    off()
    expect(ES.instances[0]!.closed).toBe(1)
    store.dispose()
    expect(ES.instances[0]!.closed).toBe(1)
  })

  it('stays usable after dispose(): a later subscribe opens a fresh source', () => {
    const ES = stubEventSource()
    const { fetch } = recorder()
    const store = httpStore({ baseUrl: BASE, fetch })
    store.subscribeEvents({ role: 'hud', onEvent: () => {} })
    store.dispose()
    store.subscribeEvents({ role: 'hud', onEvent: () => {} })
    expect(ES.instances).toHaveLength(2)
    expect(ES.instances[1]!.closed).toBe(0)
    // …and the fresh one is tracked, so the next dispose() reaches it.
    store.dispose()
    expect(ES.instances[1]!.closed).toBe(1)
  })
})
