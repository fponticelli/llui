import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { indexedDbStore } from '../src/stores/indexed-db-store.js'
import { exportBundle, bundleFilename } from '../src/export-bundle.js'
import { parseNote } from '../src/note-serialize.js'
import { NOTE_SCHEMA_VERSION } from '../src/note-format.js'
import type { CreateNoteRequest, NoteFrontmatter } from '../src/note-types.js'

const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

let dbSeq = 0
function freshStore(now?: () => Date) {
  dbSeq += 1
  return indexedDbStore({ dbName: `export-db-${dbSeq}`, ...(now ? { now } : {}) })
}

function frontmatter(over: Partial<NoteFrontmatter> = {}): CreateNoteRequest['frontmatter'] {
  return {
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

beforeEach(() => {
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:fake/url'),
    revokeObjectURL: vi.fn(),
  })
})
afterEach(() => vi.unstubAllGlobals())

const FIXED = new Date(Date.UTC(2026, 5, 7, 9, 4))

async function seed() {
  const store = freshStore(() => FIXED)
  await store.createNote({ body: 'plain note', frontmatter: frontmatter(), noteBody: {} })
  await store.createNote({
    body: 'shot note',
    frontmatter: frontmatter({ author: 'llm', kind: 'capture' }),
    noteBody: {},
    screenshot: PNG_1PX,
  })
  const task = await store.createNote({
    body: 'fix the thing',
    frontmatter: frontmatter({ intent: 'task' }),
    noteBody: {},
  })
  await store.postStatus(task.id, task.sessionId, { to: 'claimed', by: 'human' })
  await store.postStatus(task.id, task.sessionId, { to: 'proposed', by: 'llm', reason: 'ready' })
  return { store, sessionId: task.sessionId }
}

describe('exportBundle', () => {
  it('produces a manifest with schema version, sessions, count, and hash', async () => {
    const { store, sessionId } = await seed()
    const { manifest } = await exportBundle(store, {
      now: () => FIXED,
      exportedBy: { kind: 'human', label: 'Tester' },
      app: { version: '1.2.3', releaseChannel: 'prod' },
    })
    expect(manifest.schemaVersion).toBe(NOTE_SCHEMA_VERSION)
    expect(manifest.exportedAt).toBe(FIXED.toISOString())
    expect(manifest.sessions).toEqual([sessionId])
    expect(manifest.noteCount).toBe(3)
    expect(manifest.contentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(manifest.exportedBy).toEqual({ kind: 'human', label: 'Tester' })
    expect(manifest.app).toEqual({ version: '1.2.3', releaseChannel: 'prod' })
  })

  it('zips the canonical on-disk layout (.md + .png + status.jsonl + bundle.json)', async () => {
    const { store, sessionId } = await seed()
    const { bytes } = await exportBundle(store, { now: () => FIXED })
    const files = unzipSync(bytes)
    const paths = Object.keys(files).sort()

    expect(paths).toContain('bundle.json')
    expect(paths).toContain(`${sessionId}/001-human-text-plain-note.md`)
    expect(paths).toContain(`${sessionId}/002-llm-capture-shot-note.md`)
    expect(paths).toContain(`${sessionId}/002-llm-capture-shot-note.png`)
    expect(paths).toContain(`${sessionId}/003-human-text-fix-thing.md`)
    expect(paths).toContain(`${sessionId}/status.jsonl`)

    // The .md round-trips through parseNote
    const md = strFromU8(files[`${sessionId}/001-human-text-plain-note.md`]!)
    const parsed = parseNote(md)
    expect(parsed.prose).toBe('plain note')
    expect(parsed.frontmatter.id).toBe('001')

    // status.jsonl has one transition per line
    const lines = strFromU8(files[`${sessionId}/status.jsonl`]!).trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[1]!).to).toBe('proposed')

    // png is the decoded 1px image bytes (PNG signature)
    const png = files[`${sessionId}/002-llm-capture-shot-note.png`]!
    expect([...png.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
  })

  it('is deterministic: same notebook → same contentHash (idempotent import basis)', async () => {
    const { store } = await seed()
    const a = await exportBundle(store, { now: () => FIXED })
    const b = await exportBundle(store, { now: () => new Date(Date.UTC(2030, 0, 1)) })
    // exportedAt differs but the content hash (over files only) is stable
    expect(a.manifest.contentHash).toBe(b.manifest.contentHash)
  })

  it('omits exportedBy/app when not supplied; bundleFilename uses the hash', async () => {
    const { store } = await seed()
    const { manifest } = await exportBundle(store, { now: () => FIXED })
    expect(manifest.exportedBy).toBeUndefined()
    expect(manifest.app).toBeUndefined()
    expect(bundleFilename(manifest)).toBe(`llui-notes-${manifest.contentHash.slice(0, 12)}.zip`)
  })
})
