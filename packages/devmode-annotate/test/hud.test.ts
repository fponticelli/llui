/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mountAnnotateHud, type NotesStore } from '../src/index.js'
import type { CreateNoteRequest } from '../src/note-types.js'

// jsdom doesn't define import.meta.env; vitest's vite plugin sets DEV
// to true in the test environment, so the HUD mounts.

describe('mountAnnotateHud', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('mounts a root element with the floating button', () => {
    mountAnnotateHud()
    const root = document.getElementById('llui-devmode-annotate-root')
    expect(root).not.toBeNull()
    expect(root!.querySelectorAll('button').length).toBeGreaterThanOrEqual(1)
  })

  it('opens the modal when the floating button is clicked', () => {
    const handle = mountAnnotateHud()
    handle.close() // ensure starting state
    const root = document.getElementById('llui-devmode-annotate-root')!
    const floating = root.querySelector('button')!
    floating.click()
    // The prose field is the embedded markdown editor (a contenteditable).
    expect(root.querySelector('[data-llui-editor]')).not.toBeNull()
    // jsdom doesn't compute display; we check the inline style on the modal container instead
    const modal = root.querySelector('[data-llui-modal]') as HTMLElement
    expect(modal.style.display).toBe('block')
  })

  it('close() hides the modal', () => {
    const handle = mountAnnotateHud()
    handle.open()
    handle.close()
    const modal = document.querySelector(
      '#llui-devmode-annotate-root [data-llui-modal]',
    ) as HTMLElement
    expect(modal.style.display).toBe('none')
  })

  it('idempotent: a second mount returns the same handle', () => {
    const a = mountAnnotateHud()
    const b = mountAnnotateHud()
    expect(a).toBe(b)
  })

  it('submit() POSTs to /_llui/notes with the current page metadata', async () => {
    const calls: Array<[string, RequestInit]> = []
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push([url, init])
      return new Response(
        JSON.stringify({
          id: '001',
          filename: '001-human-text-hello.md',
          path: '/tmp/x',
          sessionId: 'session-x',
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof fetch

    const handle = mountAnnotateHud({ origin: 'http://localhost:5173' })
    const result = await handle.submit('hello world')

    expect(calls).toHaveLength(1)
    const [url, init] = calls[0]!
    expect(url).toBe('http://localhost:5173/_llui/notes')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string) as {
      body: string
      frontmatter: { author: string; kind: string; url: string; viewport: { w: number } }
    }
    expect(body.body).toBe('hello world')
    expect(body.frontmatter.author).toBe('human')
    expect(body.frontmatter.kind).toBe('text')
    // jsdom defaults to http://localhost/ or :3000/; we don't pin the port,
    // just confirm the URL was captured from location.href.
    expect(body.frontmatter.url).toMatch(/^http:\/\/localhost/)
    expect(typeof body.frontmatter.viewport.w).toBe('number')
    expect(result.id).toBe('001')
  })

  it('submit() rejects when the dev server returns non-2xx', async () => {
    globalThis.fetch = (async () =>
      new Response('boom', { status: 500 })) as unknown as typeof fetch
    const handle = mountAnnotateHud({ origin: 'http://localhost:5173' })
    await expect(handle.submit('x')).rejects.toThrow(/500/)
  })

  it('picks up window.__llui versions when present', async () => {
    ;(window as Window & { __llui?: { runtime: string; compiler: string } }).__llui = {
      runtime: '0.5.0',
      compiler: '0.6.0',
    }
    const captured: Array<{ frontmatter: { llui: { runtime: string; compiler: string } } }> = []
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      captured.push(JSON.parse(init.body as string))
      return new Response(
        JSON.stringify({ id: '001', filename: 'x.md', path: '/x', sessionId: 's' }),
        { status: 201 },
      )
    }) as unknown as typeof fetch

    const handle = mountAnnotateHud({ origin: 'http://localhost:5173' })
    await handle.submit('y')
    expect(captured[0]!.frontmatter.llui.runtime).toBe('0.5.0')
    expect(captured[0]!.frontmatter.llui.compiler).toBe('0.6.0')

    // Cleanup
    delete (window as Window & { __llui?: unknown }).__llui
  })

  it('destroy() removes the root and detaches the key listener', () => {
    const handle = mountAnnotateHud()
    handle.destroy()
    expect(document.getElementById('llui-devmode-annotate-root')).toBeNull()
  })

  it('honors an injected store: submit() routes through it, not fetch', async () => {
    let fetchHit = false
    globalThis.fetch = (async () => {
      fetchHit = true
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch

    const created: CreateNoteRequest[] = []
    const noop = (): void => {}
    const store: NotesStore = {
      createNote: async (req) => {
        created.push(req)
        return { id: '001', filename: 'x.md', path: '/x', sessionId: 's1' }
      },
      listSessions: async () => [],
      currentSession: async () => ({ sessionId: 's1', startedAt: '', notesDir: '' }),
      listNotes: async () => ({ sessionId: 's1', notes: [], total: 0 }),
      readNote: async () => null,
      getStatus: async () => ({ current: null, history: [] }),
      getQueue: async () => ({ queue: [] }),
      deleteNote: async () => {},
      updateNote: async () => {},
      postStatus: async () => {},
      screenshotUrl: () => '',
      subscribeEvents: () => noop,
    }

    const handle = mountAnnotateHud({ store, subscribeEvents: false })
    const res = await handle.submit('hello from a custom store')
    expect(res.id).toBe('001')
    expect(created).toHaveLength(1)
    expect(created[0]!.body).toBe('hello from a custom store')
    expect(fetchHit).toBe(false)
  })

  it('applies per-channel redaction before persisting', async () => {
    const created: CreateNoteRequest[] = []
    const noop = (): void => {}
    const store: NotesStore = {
      createNote: async (req) => {
        created.push(req)
        return { id: '001', filename: 'x.md', path: '/x', sessionId: 's1' }
      },
      listSessions: async () => [],
      currentSession: async () => ({ sessionId: 's1', startedAt: '', notesDir: '' }),
      listNotes: async () => ({ sessionId: 's1', notes: [], total: 0 }),
      readNote: async () => null,
      getStatus: async () => ({ current: null, history: [] }),
      getQueue: async () => ({ queue: [] }),
      deleteNote: async () => {},
      updateNote: async () => {},
      postStatus: async () => {},
      screenshotUrl: () => '',
      subscribeEvents: () => noop,
    }

    const handle = mountAnnotateHud({
      store,
      subscribeEvents: false,
      redact: {
        state: () => ({ stateSnapshot: { redacted: true } }),
        screenshot: () => null, // drop screenshots entirely
      },
    })
    // Provide a screenshot so the redaction path runs; it should be dropped.
    await handle.submit('sensitive page', { screenshot: 'QUJD' })

    expect(created).toHaveLength(1)
    expect(created[0]!.noteBody).toEqual({ stateSnapshot: { redacted: true } })
    expect(created[0]!.screenshot).toBeUndefined()
    expect(created[0]!.frontmatter.screenshot).toBeNull()
  })
})
