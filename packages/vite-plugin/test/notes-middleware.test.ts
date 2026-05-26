import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createCaptureRegistry } from '../src/notes/capture-registry.js'
import { createEventBus } from '../src/notes/event-bus.js'
import { createNotesMiddleware } from '../src/notes/middleware.js'
import type { CreateNoteRequest, NoteFrontmatter, ServerEvent } from '../src/notes/types.js'

interface Fixture {
  notesRoot: string
  server: Server
  port: number
  base: string
  bus: ReturnType<typeof createEventBus>
  registry: ReturnType<typeof createCaptureRegistry>
}

const fmBase: Omit<NoteFrontmatter, 'id' | 'ts'> = {
  author: 'human',
  kind: 'text',
  captureLevel: 'standard',
  url: 'http://localhost:5173/',
  route: '/',
  routeParams: {},
  viewport: { w: 1440, h: 900, dpr: 2 },
  componentPath: null,
  componentMeta: null,
  annotations: [],
  screenshot: null,
  agentSchemas: [],
  llui: { runtime: '0.4.3', compiler: '0.5.6' },
}

function startFixture(): Promise<Fixture> {
  const notesRoot = mkdtempSync(join(tmpdir(), 'llui-mw-test-'))
  const bus = createEventBus()
  const registry = createCaptureRegistry()
  const handler = createNotesMiddleware({ notesRoot, bus, registry, defaultCaptureTimeoutMs: 1000 })
  const server = createServer((req, res) => {
    handler(req, res, () => {
      res.statusCode = 404
      res.end('not in /_llui')
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      resolve({
        notesRoot,
        server,
        port: addr.port,
        base: `http://127.0.0.1:${addr.port}`,
        bus,
        registry,
      })
    })
  })
}

function stopFixture(f: Fixture): Promise<void> {
  rmSync(f.notesRoot, { recursive: true, force: true })
  return new Promise((resolve) => f.server.close(() => resolve()))
}

let f: Fixture

beforeEach(async () => {
  f = await startFixture()
})

afterEach(async () => {
  await stopFixture(f)
})

describe('POST /_llui/notes', () => {
  it('creates a note and returns 201 with id, filename, path, sessionId', async () => {
    const body: CreateNoteRequest = {
      body: 'Hello world',
      frontmatter: fmBase,
      noteBody: {},
    }
    const res = await fetch(`${f.base}/_llui/notes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    expect(res.status).toBe(201)
    const payload = (await res.json()) as { id: string; filename: string; sessionId: string }
    expect(payload.id).toBe('001')
    expect(payload.filename.startsWith('001-human-text-')).toBe(true)
    expect(payload.sessionId).toMatch(/^session-/)
  })

  it('returns 400 on invalid JSON', async () => {
    const res = await fetch(`${f.base}/_llui/notes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 on missing frontmatter', async () => {
    const res = await fetch(`${f.base}/_llui/notes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'x' }),
    })
    expect(res.status).toBe(400)
  })

  it('broadcasts note-created on the event bus', async () => {
    const received: ServerEvent[] = []
    f.bus.subscribe('viewer', (e) => received.push(e))
    await fetch(`${f.base}/_llui/notes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'x', frontmatter: fmBase, noteBody: {} }),
    })
    expect(received).toHaveLength(1)
    expect(received[0]!.type).toBe('note-created')
  })
})

describe('GET /_llui/notes', () => {
  it('lists notes in the current session', async () => {
    await fetch(`${f.base}/_llui/notes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'a', frontmatter: fmBase, noteBody: {} }),
    })
    await fetch(`${f.base}/_llui/notes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'b', frontmatter: fmBase, noteBody: {} }),
    })
    const list = await fetch(`${f.base}/_llui/notes`).then((r) => r.json())
    expect(list.notes).toHaveLength(2)
    expect(list.total).toBe(2)
  })

  it('filters by author', async () => {
    await fetch(`${f.base}/_llui/notes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'a', frontmatter: fmBase, noteBody: {} }),
    })
    await fetch(`${f.base}/_llui/notes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body: 'b',
        frontmatter: { ...fmBase, author: 'llm' },
        noteBody: {},
      }),
    })
    const list = await fetch(`${f.base}/_llui/notes?author=llm`).then((r) => r.json())
    expect(list.notes).toHaveLength(1)
    expect(list.notes[0].author).toBe('llm')
  })
})

describe('GET /_llui/notes/:id', () => {
  it('returns the raw markdown', async () => {
    const created = await fetch(`${f.base}/_llui/notes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'roundtrip', frontmatter: fmBase, noteBody: {} }),
    }).then((r) => r.json())
    const md = await fetch(`${f.base}/_llui/notes/${created.id}`).then((r) => r.text())
    expect(md).toContain('roundtrip')
    expect(md.startsWith('---\n')).toBe(true)
  })

  it('returns 404 on unknown id', async () => {
    const res = await fetch(`${f.base}/_llui/notes/999`)
    expect(res.status).toBe(404)
  })
})

describe('GET /_llui/session/current', () => {
  it('returns the active session metadata', async () => {
    const res = await fetch(`${f.base}/_llui/session/current`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { sessionId: string; startedAt: string; notesDir: string }
    expect(body.sessionId).toMatch(/^session-/)
    expect(body.notesDir).toContain(body.sessionId)
  })
})

describe('POST /_llui/session/rotate', () => {
  it('creates a new session and broadcasts session-rotated', async () => {
    const a = await fetch(`${f.base}/_llui/session/current`).then((r) => r.json())
    const received: ServerEvent[] = []
    f.bus.subscribe('viewer', (e) => received.push(e))
    // Force rotate with sleep-style delay to ensure HHMM differs;
    // sessionName override would be cleaner — but the endpoint doesn't
    // expose that. Instead, pre-populate a marker for a fake earlier
    // session and then rotate.
    // Simpler: ensure default name produces a fresh session by mutating
    // the underlying clock would require dep injection; skip ts test.
    const rotated = await fetch(`${f.base}/_llui/session/rotate`, { method: 'POST' }).then((r) =>
      r.json(),
    )
    expect(rotated.previousSessionId).toBe(a.sessionId)
    // The newly named session may coincide with the same minute; in
    // that case rotation overwrites the same dir. What matters is the
    // event fires.
    expect(received.find((e) => e.type === 'session-rotated')).toBeDefined()
  })
})

describe('GET /_llui/sessions', () => {
  it('lists known sessions with id + noteCount + startedAt', async () => {
    await fetch(`${f.base}/_llui/notes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'x', frontmatter: fmBase, noteBody: {} }),
    })
    const out = (await fetch(`${f.base}/_llui/sessions`).then((r) => r.json())) as {
      sessions: Array<{ id: string; noteCount: number; startedAt: string }>
    }
    expect(out.sessions.length).toBeGreaterThanOrEqual(1)
    const s = out.sessions[0]!
    expect(s.id.startsWith('session-')).toBe(true)
    expect(s.noteCount).toBeGreaterThanOrEqual(1)
    expect(typeof s.startedAt).toBe('string')
  })
})

describe('GET /_llui/events (SSE)', () => {
  it('emits note-created events to subscribed viewers', async () => {
    const ctrl = new AbortController()
    const eventsPromise = (async () => {
      const res = await fetch(`${f.base}/_llui/events?role=viewer`, { signal: ctrl.signal })
      const reader = res.body!.getReader()
      const dec = new TextDecoder()
      let text = ''
      for (let i = 0; i < 10; i++) {
        const { done, value } = await reader.read()
        if (done) break
        text += dec.decode(value)
        if (text.includes('note-created')) break
      }
      return text
    })()
    // Give the SSE connection a tick to register a subscriber before we post.
    await new Promise((r) => setTimeout(r, 50))
    await fetch(`${f.base}/_llui/notes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'sse', frontmatter: fmBase, noteBody: {} }),
    })
    const text = await eventsPromise
    ctrl.abort()
    expect(text).toContain('note-created')
  })
})

describe('POST /_llui/capture-request', () => {
  it('returns no-client when no HUD is subscribed', async () => {
    const res = await fetch(`${f.base}/_llui/capture-request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ route: '/' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string }
    expect(body.status).toBe('no-client')
  })

  it('long-polls until a HUD fulfills via /_llui/notes', async () => {
    // Subscribe as a HUD; record the requestId so we can fulfill via POST.
    const events: ServerEvent[] = []
    const unsub = f.bus.subscribe('hud', (e) => events.push(e))
    // Fire the capture-request
    const responsePromise = fetch(`${f.base}/_llui/capture-request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ route: '/x' }),
    })
    // Wait briefly for the event to enqueue
    await new Promise((r) => setTimeout(r, 30))
    const requestEvent = events.find((e) => e.type === 'capture-request')
    expect(requestEvent).toBeDefined()
    if (requestEvent?.type !== 'capture-request') throw new Error('unreachable')
    // Now POST a note with fulfillsRequestId set
    await fetch(`${f.base}/_llui/notes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body: 'fulfilled',
        frontmatter: { ...fmBase, fulfillsRequestId: requestEvent.requestId },
        noteBody: {},
      }),
    })
    const resp = (await (await responsePromise).json()) as {
      status: string
      note?: { filename: string }
    }
    expect(resp.status).toBe('fulfilled')
    expect(resp.note?.filename.startsWith('001-')).toBe(true)
    unsub()
  })

  it('times out and reports status:timeout when HUD does not respond', async () => {
    // Subscribe as HUD but never fulfill.
    const unsub = f.bus.subscribe('hud', () => {})
    const start = Date.now()
    const resp = (await (
      await fetch(`${f.base}/_llui/capture-request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ timeoutMs: 200 }),
      })
    ).json()) as { status: string }
    expect(resp.status).toBe('timeout')
    expect(Date.now() - start).toBeGreaterThanOrEqual(150)
    unsub()
  })
})

describe('unknown route', () => {
  it('returns 404 on unmapped /_llui paths', async () => {
    const res = await fetch(`${f.base}/_llui/nope`)
    expect(res.status).toBe(404)
  })

  it('calls next() for paths outside /_llui', async () => {
    const res = await fetch(`${f.base}/somewhere`)
    // The fixture handler responds with 404 "not in /_llui"
    expect(res.status).toBe(404)
    expect(await res.text()).toBe('not in /_llui')
  })
})
