import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import { NOTE_SCHEMA_VERSION } from '@llui/devmode-annotate/note-format'
import { serializeNote } from '@llui/devmode-annotate/note-serialize'
import { createCaptureRegistry } from '../src/notes/capture-registry.js'
import { createEventBus } from '../src/notes/event-bus.js'
import { createNotesMiddleware } from '../src/notes/middleware.js'
import type { NoteFrontmatter, ServerEvent } from '../src/notes/types.js'

let notesRoot: string
let server: Server
let base: string
let bus: ReturnType<typeof createEventBus>

beforeEach(async () => {
  notesRoot = mkdtempSync(join(tmpdir(), 'llui-import-route-'))
  bus = createEventBus()
  const registry = createCaptureRegistry()
  const handler = createNotesMiddleware({ notesRoot, bus, registry })
  server = createServer((req, res) => handler(req, res, () => ((res.statusCode = 404), res.end())))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(() => {
  server.close()
  rmSync(notesRoot, { recursive: true, force: true })
})

const SESSION = 'session-2026-06-07-0904'

function fm(id: string): NoteFrontmatter {
  return {
    id,
    ts: '2026-06-07T09:04:00.000Z',
    author: 'human',
    kind: 'text',
    captureLevel: 'standard',
    url: 'http://localhost/',
    route: null,
    routeParams: {},
    viewport: { w: 800, h: 600, dpr: 1 },
    componentPath: null,
    componentMeta: null,
    annotations: [],
    screenshot: null,
    agentSchemas: [],
    llui: { runtime: '0.1.0', compiler: '0.1.0' },
  }
}

function bundle(): Uint8Array {
  const md = serializeNote({ frontmatter: fm('001'), prose: 'imported via http', body: {} })
  const manifest = {
    schemaVersion: NOTE_SCHEMA_VERSION,
    exportedAt: '2026-06-07T09:10:00.000Z',
    sessions: [SESSION],
    noteCount: 1,
    contentHash: 'c'.repeat(64),
  }
  return zipSync({
    'bundle.json': strToU8(JSON.stringify(manifest)),
    [`${SESSION}/001-human-text-imported-via-http.md`]: strToU8(md),
  })
}

describe('POST /_llui/import', () => {
  it('ingests a bundle and exposes it through the notes API', async () => {
    const events: ServerEvent[] = []
    bus.subscribe('mcp', (e) => events.push(e))

    const res = await fetch(`${base}/_llui/import`, {
      method: 'POST',
      body: new Blob([new Uint8Array(bundle())]),
    })
    expect(res.status).toBe(200)
    const result = (await res.json()) as { notesImported: number; importedSessions: string[] }
    expect(result.notesImported).toBe(1)
    const target = result.importedSessions[0]!
    expect(target).toBe(`${SESSION}-import-cccccccc`)

    // The imported session is now listable + readable via the existing API.
    const list = await fetch(`${base}/_llui/notes?sessionId=${encodeURIComponent(target)}`)
    const { notes } = (await list.json()) as { notes: Array<{ id: string }> }
    expect(notes.map((n) => n.id)).toEqual(['001'])

    // Listeners were nudged to refresh.
    expect(events.some((e) => e.type === 'session-rotated')).toBe(true)
  })

  it('rejects an empty body', async () => {
    const res = await fetch(`${base}/_llui/import`, { method: 'POST' })
    expect(res.status).toBe(400)
  })

  it('rejects a malformed bundle', async () => {
    const bad = zipSync({ 'nope.txt': strToU8('x') })
    const res = await fetch(`${base}/_llui/import`, {
      method: 'POST',
      body: new Blob([new Uint8Array(bad)]),
    })
    expect(res.status).toBe(400)
  })
})
