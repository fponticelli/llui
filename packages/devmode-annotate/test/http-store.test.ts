import { describe, expect, it } from 'vitest'
import { httpStore } from '../src/stores/http-store.js'
import type { CreateNoteRequest } from '../src/note-types.js'

const BASE = 'https://notes.example.com/api'

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
