// Middleware tests for the task-mode endpoints (P6):
// POST /_llui/notes/:id/status, GET /_llui/notes/:id/status, GET /_llui/queue.
//
// The diff-apply path uses `git apply` against process.cwd() — we
// exercise the happy path (no diff present → simple status transition)
// and the explicit-apply path (no matching reply → fallback 'failed'),
// avoiding any real working-tree mutation.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createCaptureRegistry } from '../src/notes/capture-registry.js'
import { createEventBus } from '../src/notes/event-bus.js'
import { createNotesMiddleware } from '../src/notes/middleware.js'
import { createNote } from '../src/notes/store.js'
import type { NoteFrontmatter, ServerEvent } from '../src/notes/types.js'

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

interface Fixture {
  notesRoot: string
  server: Server
  base: string
  bus: ReturnType<typeof createEventBus>
}

function startFixture(): Promise<Fixture> {
  const notesRoot = mkdtempSync(join(tmpdir(), 'llui-mw-status-'))
  const bus = createEventBus()
  const registry = createCaptureRegistry()
  const handler = createNotesMiddleware({ notesRoot, bus, registry })
  const server = createServer((req, res) => {
    handler(req, res, () => {
      res.statusCode = 404
      res.end('not in /_llui')
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      resolve({ notesRoot, server, base: `http://127.0.0.1:${addr.port}`, bus })
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

describe('POST /_llui/notes/:id/status', () => {
  it('appends a status transition and broadcasts status-changed', async () => {
    const note = createNote(f.notesRoot, {
      body: 'fix this',
      frontmatter: { ...fmBase, intent: 'task' },
      noteBody: {},
    })
    const events: ServerEvent[] = []
    f.bus.subscribe('viewer', (e) => events.push(e))

    const res = await fetch(`${f.base}/_llui/notes/${note.id}/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'open', by: 'human' }),
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { transition: { to: string } }
    expect(json.transition.to).toBe('open')
    expect(events.find((e) => e.type === 'status-changed')).toBeDefined()
  })

  it('GET returns current + history', async () => {
    const note = createNote(f.notesRoot, {
      body: 'a',
      frontmatter: { ...fmBase, intent: 'task' },
      noteBody: {},
    })
    await fetch(`${f.base}/_llui/notes/${note.id}/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'open', by: 'human' }),
    })
    await fetch(`${f.base}/_llui/notes/${note.id}/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'claimed', by: 'llm' }),
    })
    const res = await fetch(`${f.base}/_llui/notes/${note.id}/status`)
    const json = (await res.json()) as {
      current: string
      history: Array<{ to: string }>
    }
    expect(json.current).toBe('claimed')
    expect(json.history.map((h) => h.to)).toEqual(['open', 'claimed'])
  })

  it('rejects missing "to" with 400', async () => {
    const res = await fetch(`${f.base}/_llui/notes/001/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it("'accepted' with no matching reply ends in 'failed' (no diff to apply)", async () => {
    const note = createNote(f.notesRoot, {
      body: 'orphan task',
      frontmatter: { ...fmBase, intent: 'task' },
      noteBody: {},
    })
    const res = await fetch(`${f.base}/_llui/notes/${note.id}/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'accepted', by: 'human' }),
    })
    const json = (await res.json()) as { apply: { ok: boolean; reason: string } }
    expect(json.apply.ok).toBe(false)
    expect(json.apply.reason).toMatch(/no reply/i)
    // verify the follow-up 'failed' transition landed
    const status = await fetch(`${f.base}/_llui/notes/${note.id}/status`).then(
      (r) => r.json() as Promise<{ current: string }>,
    )
    expect(status.current).toBe('failed')
  })
})

describe('GET /_llui/queue', () => {
  it('lists notes with their current status', async () => {
    const a = createNote(f.notesRoot, {
      body: 'task a',
      frontmatter: { ...fmBase, intent: 'task' },
      noteBody: {},
    })
    const b = createNote(f.notesRoot, {
      body: 'task b',
      frontmatter: { ...fmBase, intent: 'task' },
      noteBody: {},
    })
    await fetch(`${f.base}/_llui/notes/${a.id}/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'open', by: 'human' }),
    })
    await fetch(`${f.base}/_llui/notes/${b.id}/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'claimed', by: 'llm' }),
    })
    const res = await fetch(`${f.base}/_llui/queue`)
    const json = (await res.json()) as { queue: Array<{ noteId: string; status: string }> }
    expect(json.queue).toHaveLength(2)
    const byId = new Map(json.queue.map((q) => [q.noteId, q.status]))
    expect(byId.get(a.id)).toBe('open')
    expect(byId.get(b.id)).toBe('claimed')
  })

  it('filters by status query param', async () => {
    const a = createNote(f.notesRoot, {
      body: 'a',
      frontmatter: { ...fmBase, intent: 'task' },
      noteBody: {},
    })
    const b = createNote(f.notesRoot, {
      body: 'b',
      frontmatter: { ...fmBase, intent: 'task' },
      noteBody: {},
    })
    await fetch(`${f.base}/_llui/notes/${a.id}/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'open', by: 'human' }),
    })
    await fetch(`${f.base}/_llui/notes/${b.id}/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'rejected', by: 'human' }),
    })
    const res = await fetch(`${f.base}/_llui/queue?status=rejected`)
    const json = (await res.json()) as { queue: Array<{ noteId: string }> }
    expect(json.queue).toHaveLength(1)
    expect(json.queue[0]!.noteId).toBe(b.id)
  })
})
