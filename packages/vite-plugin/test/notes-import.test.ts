import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import { NOTE_SCHEMA_VERSION } from '@llui/notes-format/note-format'
import { serializeNote } from '@llui/notes-format/note-serialize'
import { importBundle, listNotes, listSessions } from '../src/notes/index.js'
import type { NoteFrontmatter } from '../src/notes/types.js'

let notesRoot: string

beforeEach(() => {
  notesRoot = mkdtempSync(join(tmpdir(), 'llui-notes-import-'))
})
afterEach(() => {
  rmSync(notesRoot, { recursive: true, force: true })
})

const SESSION = 'session-2026-06-07-0904'

function fm(id: string, over: Partial<NoteFrontmatter> = {}): NoteFrontmatter {
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
    ...over,
  }
}

interface BundleSpec {
  schemaVersion?: number
  contentHash?: string
  extraFiles?: Record<string, Uint8Array>
}

function makeBundle(spec: BundleSpec = {}): Uint8Array {
  const noteMd = serializeNote({
    frontmatter: fm('001'),
    prose: 'broken button',
    body: {},
  })
  const taskMd = serializeNote({
    frontmatter: fm('002', { intent: 'task' }),
    prose: 'please fix',
    body: {},
  })
  const status = JSON.stringify({
    ts: '2026-06-07T09:05:00.000Z',
    noteId: '002',
    from: null,
    to: 'open',
    by: 'human',
  })
  const manifest = {
    schemaVersion: spec.schemaVersion ?? NOTE_SCHEMA_VERSION,
    exportedAt: '2026-06-07T09:10:00.000Z',
    sessions: [SESSION],
    noteCount: 2,
    contentHash: spec.contentHash ?? 'a'.repeat(64),
    exportedBy: { kind: 'human', label: 'Reporter' },
  }
  return zipSync({
    'bundle.json': strToU8(JSON.stringify(manifest)),
    [`${SESSION}/001-human-text-broken-button.md`]: strToU8(noteMd),
    [`${SESSION}/002-human-text-please-fix.md`]: strToU8(taskMd),
    [`${SESSION}/status.jsonl`]: strToU8(status),
    ...(spec.extraFiles ?? {}),
  })
}

describe('importBundle', () => {
  it('ingests a bundle into a namespaced session folder; existing flow reads it', () => {
    const res = importBundle(notesRoot, makeBundle())
    expect(res.notesImported).toBe(2)
    expect(res.notesSkipped).toBe(0)
    expect(res.bundleKey).toBe('aaaaaaaa')
    const target = `${SESSION}-import-aaaaaaaa`
    expect(res.importedSessions).toEqual([target])

    // The existing server readers see the imported session + notes.
    const sessions = listSessions(notesRoot).map((s) => s.id)
    expect(sessions).toContain(target)
    const notes = listNotes(notesRoot, { sessionId: target }).notes
    expect(notes.map((n) => n.id)).toEqual(['001', '002'])

    // status.jsonl + provenance sidecar landed.
    const files = readdirSync(join(notesRoot, target))
    expect(files).toContain('status.jsonl')
    expect(files).toContain('import.json')
    const sidecar = JSON.parse(readFileSync(join(notesRoot, target, 'import.json'), 'utf8'))
    expect(sidecar.originalSessionId).toBe(SESSION)
    expect(sidecar.exportedBy).toEqual({ kind: 'human', label: 'Reporter' })
  })

  it('is idempotent: re-importing the same bundle writes nothing new', () => {
    importBundle(notesRoot, makeBundle())
    const second = importBundle(notesRoot, makeBundle())
    expect(second.notesImported).toBe(0)
    expect(second.notesSkipped).toBe(2)
    // Still exactly one target folder, two notes.
    expect(listNotes(notesRoot, { sessionId: `${SESSION}-import-aaaaaaaa` }).total).toBe(2)
  })

  it('namespaces by content hash so colliding session ids never merge', () => {
    importBundle(notesRoot, makeBundle({ contentHash: 'a'.repeat(64) }))
    importBundle(notesRoot, makeBundle({ contentHash: 'b'.repeat(64) }))
    const sessions = listSessions(notesRoot).map((s) => s.id)
    expect(sessions).toContain(`${SESSION}-import-aaaaaaaa`)
    expect(sessions).toContain(`${SESSION}-import-bbbbbbbb`)
  })

  it('rejects a schema-version mismatch', () => {
    expect(() => importBundle(notesRoot, makeBundle({ schemaVersion: 999 }))).toThrow(
      /schema version mismatch/,
    )
  })

  it('rejects a bundle without bundle.json', () => {
    const bad = zipSync({ 'random.txt': strToU8('nope') })
    expect(() => importBundle(notesRoot, bad)).toThrow(/bundle\.json missing/)
  })

  it('rejects entries that escape the session via path traversal (atomically)', () => {
    const evil = makeBundle({ extraFiles: { '../escape.md': strToU8('x') } })
    expect(() => importBundle(notesRoot, evil)).toThrow(/unknown session|unsafe/)
    expect(existsSync(join(notesRoot, '..', 'escape.md'))).toBe(false)
    // Two-pass validation aborts before any write — no partial import folder.
    expect(existsSync(join(notesRoot, `${SESSION}-import-aaaaaaaa`))).toBe(false)
  })

  it('rejects a single over-large decompressed entry (zip bomb) before inflating it', () => {
    // A highly compressible 4 MB entry. With a tiny per-entry cap the filter
    // aborts on the central-directory size, before fflate inflates the payload.
    const bomb = makeBundle({
      extraFiles: { [`${SESSION}/big.bin`]: new Uint8Array(4 * 1024 * 1024) },
    })
    expect(() =>
      importBundle(notesRoot, bomb, { maxEntryBytes: 1024, maxTotalBytes: 1024 * 1024 }),
    ).toThrow(/per-entry limit|exceeding/)
  })

  it('rejects a bundle whose total decompressed size exceeds the bound', () => {
    // Several entries, each under the per-entry cap but over the total cap.
    const bomb = makeBundle({
      extraFiles: {
        [`${SESSION}/a.bin`]: new Uint8Array(256 * 1024),
        [`${SESSION}/b.bin`]: new Uint8Array(256 * 1024),
        [`${SESSION}/c.bin`]: new Uint8Array(256 * 1024),
      },
    })
    expect(() =>
      importBundle(notesRoot, bomb, { maxEntryBytes: 512 * 1024, maxTotalBytes: 400 * 1024 }),
    ).toThrow(/total limit|zip bomb/)
  })

  it('accepts a normal bundle under the default caps', () => {
    // Sanity: the guard doesn't reject a legitimate small bundle.
    const res = importBundle(notesRoot, makeBundle())
    expect(res.notesImported).toBe(2)
  })
})
