/// <reference lib="dom" />
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountAnnotateHud } from '../src/index.js'
import { SCREENSHOT_URL_CACHE_LIMIT, indexedDbStore } from '../src/stores/indexed-db-store.js'
import type { CreateNoteRequest } from '../src/note-types.js'

// Issue #114 — the IndexedDB store pins one Blob object URL per browsed note
// for the lifetime of the session. Each entry holds a decoded PNG alive, and
// the only eviction was a re-read of the SAME id, so distinct notes
// accumulated without limit and a mount/destroy cycle stranded every one.

const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

/** Object-URL bookkeeping: every `createObjectURL` result stays in `live`
 *  until it is revoked, so `live.size` is exactly the leak count. */
function trackObjectUrls(): { live: Set<string>; created: () => number } {
  let seq = 0
  const live = new Set<string>()
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => {
      seq += 1
      const url = `blob:test/${seq}`
      live.add(url)
      return url
    }),
    revokeObjectURL: vi.fn((url: string) => {
      live.delete(url)
    }),
  })
  return { live, created: () => seq }
}

let dbSeq = 0
function freshStore(): ReturnType<typeof indexedDbStore> {
  dbSeq += 1
  return indexedDbStore({ dbName: `url-lifecycle-db-${dbSeq}` })
}

function frontmatter(): CreateNoteRequest['frontmatter'] {
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
  }
}

/** Write `n` notes that each carry a screenshot, then read every one back —
 *  the browse-a-note path that populates the URL cache. */
async function writeAndReadNotes(
  store: ReturnType<typeof indexedDbStore>,
  n: number,
): Promise<void> {
  const written: Array<{ id: string; sessionId: string }> = []
  for (let i = 0; i < n; i++) {
    written.push(
      await store.createNote({
        body: `note number ${i}`,
        frontmatter: frontmatter(),
        noteBody: {},
        screenshot: PNG_1PX,
      }),
    )
  }
  for (const { id, sessionId } of written) await store.readNote(id, sessionId)
}

describe('indexedDbStore object-URL lifetime', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the live object-URL count bounded across many distinct notes', async () => {
    const { live, created } = trackObjectUrls()
    const store = freshStore()
    const n = SCREENSHOT_URL_CACHE_LIMIT + 8
    await writeAndReadNotes(store, n)
    expect(created()).toBeGreaterThanOrEqual(n)
    expect(live.size).toBeLessThanOrEqual(SCREENSHOT_URL_CACHE_LIMIT)
    store.dispose()
  })

  it('dispose() revokes every URL the store created', async () => {
    const { live } = trackObjectUrls()
    const store = freshStore()
    await writeAndReadNotes(store, 5)
    expect(live.size).toBeGreaterThan(0)
    store.dispose()
    expect(live.size).toBe(0)
    // Idempotent, and the store stays usable — a later read re-creates the URL.
    expect(() => store.dispose()).not.toThrow()
    const { notes, sessionId } = await store.listNotes({})
    const first = notes[0]!
    await store.readNote(first.id, sessionId)
    expect(store.screenshotUrl(first.id, '')).not.toBe('')
    expect(live.size).toBe(1)
    store.dispose()
  })

  it('the most recently read note survives eviction (its <img> src stays valid)', async () => {
    const { live } = trackObjectUrls()
    const store = freshStore()
    await writeAndReadNotes(store, SCREENSHOT_URL_CACHE_LIMIT + 4)
    const { notes, sessionId } = await store.listNotes({})
    const last = notes[notes.length - 1]!
    await store.readNote(last.id, sessionId)
    const url = store.screenshotUrl(last.id, '')
    expect(url).not.toBe('')
    expect(live.has(url)).toBe(true)
    store.dispose()
  })
})

describe('HUD destroy() reclaims store resources', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  it('a mount/destroy cycle leaves zero live object URLs', async () => {
    const { live } = trackObjectUrls()
    const store = freshStore()
    await writeAndReadNotes(store, 3)
    expect(live.size).toBeGreaterThan(0)
    const handle = mountAnnotateHud({ store, subscribeEvents: false })
    handle.destroy()
    expect(live.size).toBe(0)
  })
})
