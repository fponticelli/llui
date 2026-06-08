import { afterEach, describe, expect, it, vi } from 'vitest'
import { devServerStore } from '../src/stores/dev-server-store.js'
import type { CreateNoteRequest } from '../src/note-types.js'

const ORIGIN = 'http://localhost:5173'

interface Call {
  url: string
  method: string
  body: unknown
}

function mockFetch(responses: Record<string, unknown>): { calls: Call[] } {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(init.body as string) : undefined,
      })
      // match by pathname+search so query order doesn't matter
      const key = Object.keys(responses).find((k) => url.includes(k))
      const payload = key ? responses[key] : {}
      return {
        ok: true,
        status: 200,
        json: async () => payload,
      } as Response
    }),
  )
  return { calls }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('devServerStore — request mapping (dev parity)', () => {
  it('createNote → POST /_llui/notes with the request as JSON body', async () => {
    const { calls } = mockFetch({
      '/_llui/notes': { id: 'n1', filename: 'f', path: 'p', sessionId: 's1' },
    })
    const store = devServerStore(ORIGIN)
    const req = { body: 'hi', frontmatter: {}, noteBody: {} } as unknown as CreateNoteRequest
    const res = await store.createNote(req)
    expect(res).toEqual({ id: 'n1', filename: 'f', path: 'p', sessionId: 's1' })
    expect(calls[0]).toMatchObject({
      url: `${ORIGIN}/_llui/notes`,
      method: 'POST',
      body: req,
    })
  })

  it('listSessions → GET /_llui/sessions, unwraps .sessions', async () => {
    mockFetch({ '/_llui/sessions': { sessions: [{ id: 's1', noteCount: 2 }] } })
    const store = devServerStore(ORIGIN)
    expect(await store.listSessions()).toEqual([{ id: 's1', noteCount: 2 }])
  })

  it('currentSession → GET /_llui/session/current', async () => {
    const { calls } = mockFetch({
      '/_llui/session/current': { sessionId: 's1', startedAt: 't', notesDir: 'd' },
    })
    const store = devServerStore(ORIGIN)
    expect((await store.currentSession()).sessionId).toBe('s1')
    expect(calls[0]!.url).toBe(`${ORIGIN}/_llui/session/current`)
  })

  it('listNotes → GET /_llui/notes?sessionId= (encoded)', async () => {
    const { calls } = mockFetch({ '/_llui/notes': { sessionId: 's 1', notes: [], total: 0 } })
    const store = devServerStore(ORIGIN)
    await store.listNotes({ sessionId: 's 1' })
    expect(calls[0]!.url).toBe(`${ORIGIN}/_llui/notes?sessionId=s%201`)
    expect(calls[0]!.method).toBe('GET')
  })

  it('readNote → GET /_llui/notes/:id?...&format=json; null on !ok', async () => {
    const { calls } = mockFetch({
      '/_llui/notes/n1': { frontmatter: { kind: 'text', author: 'human' }, prose: 'x' },
    })
    const store = devServerStore(ORIGIN)
    const note = await store.readNote('n1', 's1')
    expect(note?.prose).toBe('x')
    expect(calls[0]!.url).toBe(`${ORIGIN}/_llui/notes/n1?sessionId=s1&format=json`)
  })

  it('readNote → null when the server responds !ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404 }) as Response),
    )
    const store = devServerStore(ORIGIN)
    expect(await store.readNote('nope', 's1')).toBeNull()
  })

  it('getStatus → GET /_llui/notes/:id/status', async () => {
    const { calls } = mockFetch({
      '/_llui/notes/n1/status': { current: 'open', history: [] },
    })
    const store = devServerStore(ORIGIN)
    expect((await store.getStatus('n1', 's1')).current).toBe('open')
    expect(calls[0]!.url).toBe(`${ORIGIN}/_llui/notes/n1/status?sessionId=s1`)
  })

  it('getQueue → GET /_llui/queue', async () => {
    const { calls } = mockFetch({ '/_llui/queue': { queue: [{ noteId: 'n1', status: 'open' }] } })
    const store = devServerStore(ORIGIN)
    expect((await store.getQueue('s1')).queue).toHaveLength(1)
    expect(calls[0]!.url).toBe(`${ORIGIN}/_llui/queue?sessionId=s1`)
  })

  it('deleteNote → DELETE /_llui/notes/:id; throws on !ok', async () => {
    const { calls } = mockFetch({ '/_llui/notes/n1': {} })
    const store = devServerStore(ORIGIN)
    await store.deleteNote('n1', 's1')
    expect(calls[0]).toMatchObject({
      url: `${ORIGIN}/_llui/notes/n1?sessionId=s1`,
      method: 'DELETE',
    })
  })

  it('updateNote → PATCH /_llui/notes/:id with the patch body', async () => {
    const { calls } = mockFetch({ '/_llui/notes/n1': {} })
    const store = devServerStore(ORIGIN)
    await store.updateNote('n1', 's1', { prose: 'edited' })
    expect(calls[0]).toMatchObject({
      url: `${ORIGIN}/_llui/notes/n1?sessionId=s1`,
      method: 'PATCH',
      body: { prose: 'edited' },
    })
  })

  it('postStatus → POST /_llui/notes/:id/status with {to,by}', async () => {
    const { calls } = mockFetch({ '/_llui/notes/n1/status': {} })
    const store = devServerStore(ORIGIN)
    await store.postStatus('n1', 's1', { to: 'accepted', by: 'human' })
    expect(calls[0]).toMatchObject({
      url: `${ORIGIN}/_llui/notes/n1/status?sessionId=s1`,
      method: 'POST',
      body: { to: 'accepted', by: 'human' },
    })
  })

  it('screenshotUrl → the /_llui screenshot URL with encoded ref', () => {
    const store = devServerStore(ORIGIN)
    expect(store.screenshotUrl('n1', 'shot 1.png')).toBe(
      `${ORIGIN}/_llui/notes/n1/screenshot?ts=shot%201.png`,
    )
  })

  it('rejects on a failed POST (createNote)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500 }) as Response),
    )
    const store = devServerStore(ORIGIN)
    await expect(
      store.createNote({ body: '', frontmatter: {}, noteBody: {} } as unknown as CreateNoteRequest),
    ).rejects.toThrow(/→ 500/)
  })
})

describe('devServerStore — events', () => {
  it('subscribeEvents returns a noop unsubscribe when EventSource is absent', () => {
    vi.stubGlobal('EventSource', undefined)
    const store = devServerStore(ORIGIN)
    const off = store.subscribeEvents({ role: 'hud', onEvent: () => {} })
    expect(typeof off).toBe('function')
    expect(() => off()).not.toThrow()
  })

  it('subscribeEvents parses JSON messages into ServerEvents and unsubscribes', () => {
    const listeners: Record<string, (e: MessageEvent) => void> = {}
    let closed = false
    class FakeES {
      url: string
      constructor(url: string) {
        this.url = url
      }
      addEventListener(type: string, cb: (e: MessageEvent) => void): void {
        listeners[type] = cb
      }
      removeEventListener(): void {}
      close(): void {
        closed = true
      }
    }
    vi.stubGlobal('EventSource', FakeES as unknown as typeof EventSource)
    const store = devServerStore(ORIGIN)
    const seen: unknown[] = []
    const off = store.subscribeEvents({ role: 'hud', onEvent: (ev) => seen.push(ev) })
    listeners.message?.({
      data: JSON.stringify({ type: 'note-created', id: 'n1' }),
    } as MessageEvent)
    listeners.message?.({ data: 'not json' } as MessageEvent)
    expect(seen).toEqual([{ type: 'note-created', id: 'n1' }])
    off()
    expect(closed).toBe(true)
  })
})
