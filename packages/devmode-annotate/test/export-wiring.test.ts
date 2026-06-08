/// <reference lib="dom" />
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountAnnotateHud } from '../src/index.js'
import { indexedDbStore } from '../src/stores/indexed-db-store.js'
import { devServerStore } from '../src/stores/dev-server-store.js'
import type { CreateNoteRequest, NoteFrontmatter } from '../src/note-types.js'

const HUD_ID = 'llui-devmode-annotate-root'

let dbSeq = 0
function freshIdb() {
  dbSeq += 1
  return indexedDbStore({ dbName: `export-wiring-${dbSeq}` })
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
  } satisfies Omit<NoteFrontmatter, 'id' | 'ts'>
}

let downloads: Array<{ filename: string; size: number }>

beforeEach(() => {
  document.body.innerHTML = ''
  downloads = []
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:fake/url'),
    revokeObjectURL: vi.fn(),
  })
  // Capture the download instead of letting jsdom attempt navigation.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push({ filename: this.download, size: 0 })
  })
})

afterEach(() => {
  document.getElementById(HUD_ID)?.remove()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('export wiring', () => {
  it('handle.exportBundle() exports from an IndexedDB store and triggers a download', async () => {
    const store = freshIdb()
    await store.createNote({ body: 'a captured bug', frontmatter: frontmatter(), noteBody: {} })

    const handle = mountAnnotateHud({ store, subscribeEvents: false })
    const manifest = await handle.exportBundle()

    expect(manifest).not.toBeNull()
    expect(manifest!.noteCount).toBe(1)
    expect(downloads).toHaveLength(1)
    expect(downloads[0]!.filename).toMatch(/^llui-notes-[0-9a-f]{12}\.zip$/)
  })

  it('handle.exportBundle() returns null for a non-exportable store (dev server)', async () => {
    const handle = mountAnnotateHud({
      store: devServerStore('http://localhost'),
      subscribeEvents: false,
    })
    expect(await handle.exportBundle()).toBeNull()
    expect(downloads).toHaveLength(0)
  })

  it('shows the export button in the browse toolbar only when the store can export', () => {
    mountAnnotateHud({ store: freshIdb(), subscribeEvents: false })
    expect(document.querySelector('[data-llui-export]')).not.toBeNull()
  })

  it('hides the export button for a non-exportable store', () => {
    mountAnnotateHud({ store: devServerStore('http://localhost'), subscribeEvents: false })
    expect(document.querySelector('[data-llui-export]')).toBeNull()
  })
})
