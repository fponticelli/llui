import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { indexedDbStore } from '../src/stores/indexed-db-store.js'
import type { CreateNoteRequest, NoteFrontmatter, ServerEvent } from '../src/note-types.js'

// A 1×1 transparent PNG, base64 (no data: prefix) — matches what the HUD
// sends in CreateNoteRequest.screenshot.
const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

let dbSeq = 0
function freshStore(now?: () => Date) {
  dbSeq += 1
  return indexedDbStore({ dbName: `test-db-${dbSeq}`, ...(now ? { now } : {}) })
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

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('indexedDbStore', () => {
  it('createNote assigns sequential ids + canonical filenames per session', async () => {
    const store = freshStore()
    const a = await store.createNote({
      body: 'first note here',
      frontmatter: frontmatter(),
      noteBody: {},
    })
    const b = await store.createNote({
      body: 'second note here',
      frontmatter: frontmatter(),
      noteBody: {},
    })
    expect(a.id).toBe('001')
    expect(a.filename).toBe('001-human-text-first-note-here.md')
    expect(b.id).toBe('002')
    expect(a.sessionId).toBe(b.sessionId)
    expect(a.sessionId).toMatch(/^session-/)
  })

  it('listNotes returns summaries in id order; readNote returns the full note', async () => {
    const store = freshStore()
    await store.createNote({ body: 'alpha', frontmatter: frontmatter(), noteBody: {} })
    await store.createNote({
      body: 'bravo',
      frontmatter: frontmatter({ author: 'llm', kind: 'capture' }),
      noteBody: { repro: [{ type: 'click', t: 0, selector: '#x' }] },
    })
    const { sessionId, notes, total } = await store.listNotes({})
    expect(total).toBe(2)
    expect(notes.map((n) => n.id)).toEqual(['001', '002'])
    expect(notes[1]!.author).toBe('llm')
    const full = await store.readNote('002', sessionId)
    expect(full?.prose).toBe('bravo')
    expect(full?.body?.repro).toHaveLength(1)
  })

  it('listNotes filters by author and kind', async () => {
    const store = freshStore()
    await store.createNote({ body: 'h', frontmatter: frontmatter(), noteBody: {} })
    await store.createNote({
      body: 'l',
      frontmatter: frontmatter({ author: 'llm', kind: 'capture' }),
      noteBody: {},
    })
    expect((await store.listNotes({ author: 'llm' })).notes.map((n) => n.id)).toEqual(['002'])
    expect((await store.listNotes({ kind: 'capture' })).notes.map((n) => n.id)).toEqual(['002'])
  })

  it('stores a screenshot as a blob and serves it via screenshotUrl after read', async () => {
    const store = freshStore()
    const res = await store.createNote({
      body: 'with shot',
      frontmatter: frontmatter(),
      noteBody: {},
      screenshot: PNG_1PX,
    })
    // hasScreenshot surfaces in the summary
    const { notes, sessionId } = await store.listNotes({})
    expect(notes[0]!.hasScreenshot).toBe(true)
    // frontmatter.screenshot rewritten to the canonical png filename
    const full = await store.readNote(res.id, sessionId)
    expect(full?.frontmatter.screenshot).toBe(res.filename.replace(/\.md$/, '.png'))
    // object URL is available synchronously after the read populated the cache
    expect(store.screenshotUrl(res.id, full!.frontmatter.screenshot ?? '')).toBe('blob:fake/url')
  })

  it('updateNote patches prose; deleteNote removes the note', async () => {
    const store = freshStore()
    const { id, sessionId } = await store.createNote({
      body: 'original',
      frontmatter: frontmatter(),
      noteBody: {},
    })
    await store.updateNote(id, sessionId, { prose: 'edited' })
    expect((await store.readNote(id, sessionId))?.prose).toBe('edited')
    await store.deleteNote(id, sessionId)
    expect(await store.readNote(id, sessionId)).toBeNull()
    expect((await store.listNotes({ sessionId })).total).toBe(0)
  })

  it('postStatus appends transitions; getStatus + getQueue replay them', async () => {
    const store = freshStore()
    const { id, sessionId } = await store.createNote({
      body: 'task please',
      frontmatter: frontmatter({ intent: 'task' }),
      noteBody: {},
    })
    await store.postStatus(id, sessionId, { to: 'claimed', by: 'human' })
    await store.postStatus(id, sessionId, { to: 'proposed', by: 'llm', reason: 'fix ready' })
    const status = await store.getStatus(id, sessionId)
    expect(status.current).toBe('proposed')
    expect(status.history).toHaveLength(2)
    expect(status.history[0]!.from).toBeNull()
    expect(status.history[1]!.from).toBe('claimed')
    const { queue } = await store.getQueue(sessionId)
    expect(queue).toEqual([{ noteId: id, status: 'proposed' }])
  })

  it('listSessions reports note counts', async () => {
    const store = freshStore()
    await store.createNote({ body: 'one', frontmatter: frontmatter(), noteBody: {} })
    await store.createNote({ body: 'two', frontmatter: frontmatter(), noteBody: {} })
    const sessions = await store.listSessions()
    expect(sessions).toHaveLength(1)
    expect(sessions[0]!.noteCount).toBe(2)
  })

  it('emits in-process events to subscribers on writes', async () => {
    const store = freshStore()
    const seen: ServerEvent[] = []
    const off = store.subscribeEvents({ role: 'hud', onEvent: (e) => seen.push(e) })
    const { id, sessionId } = await store.createNote({
      body: 'evented',
      frontmatter: frontmatter(),
      noteBody: {},
    })
    await store.postStatus(id, sessionId, { to: 'open', by: 'human' })
    await store.deleteNote(id, sessionId)
    off()
    await store.createNote({ body: 'after unsub', frontmatter: frontmatter(), noteBody: {} })
    expect(seen.map((e) => e.type)).toEqual(['note-created', 'status-changed', 'note-deleted'])
  })

  it('createNote allocates unique ids under concurrency (no silent overwrite)', async () => {
    const store = freshStore()
    const N = 25
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        store.createNote({
          body: `concurrent note number ${i}`,
          frontmatter: frontmatter(),
          noteBody: {},
        }),
      ),
    )
    const ids = results.map((r) => r.id)
    // Every allocation is unique — no two racing writes share an id.
    expect(new Set(ids).size).toBe(N)
    // And every note is actually persisted (not clobbered by a colliding put).
    const { total, notes } = await store.listNotes({})
    expect(total).toBe(N)
    expect(new Set(notes.map((n) => n.id)).size).toBe(N)
  })

  it('deleteNote also removes the note’s status transitions (no orphan resurrection)', async () => {
    const store = freshStore()
    const { id, sessionId } = await store.createNote({
      body: 'task to delete',
      frontmatter: frontmatter({ intent: 'task' }),
      noteBody: {},
    })
    await store.postStatus(id, sessionId, { to: 'claimed', by: 'human' })
    await store.postStatus(id, sessionId, { to: 'proposed', by: 'llm', reason: 'x' })
    // A second task whose transitions must survive the delete.
    const other = await store.createNote({
      body: 'survivor task',
      frontmatter: frontmatter({ intent: 'task' }),
      noteBody: {},
    })
    await store.postStatus(other.id, sessionId, { to: 'claimed', by: 'human' })

    await store.deleteNote(id, sessionId)

    // Status history for the deleted note is gone.
    const status = await store.getStatus(id, sessionId)
    expect(status.history).toHaveLength(0)
    expect(status.current).toBeNull()

    // The queue no longer resurrects the deleted note; the survivor stays.
    const { queue } = await store.getQueue(sessionId)
    expect(queue.find((e) => e.noteId === id)).toBeUndefined()
    expect(queue.find((e) => e.noteId === other.id)).toBeDefined()

    // Export omits the deleted note's transitions entirely.
    const [session] = await store.exportSessions([sessionId])
    const lines = session!.statusJsonl
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { noteId: string })
    expect(lines.some((t) => t.noteId === id)).toBe(false)
    expect(lines.some((t) => t.noteId === other.id)).toBe(true)
  })

  it('uses defaultSessionName from the injected clock', async () => {
    const fixed = new Date(Date.UTC(2026, 5, 7, 9, 4))
    const store = freshStore(() => fixed)
    const { sessionId } = await store.createNote({
      body: 'clocked',
      frontmatter: frontmatter(),
      noteBody: {},
    })
    expect(sessionId).toBe('session-2026-06-07-0904')
  })
})
