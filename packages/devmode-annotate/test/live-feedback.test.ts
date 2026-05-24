/// <reference lib="dom" />
// Tests for the live status-feedback flow in the HUD: after clicking
// Solve, the modal stays open and the status line updates as the
// router emits status-changed events on the SSE bus.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mountAnnotateHud } from '../src/index.js'

// jsdom doesn't ship EventSource; we install a minimal stub that the
// HUD's `new EventSource(url)` constructs, and we expose the spy so
// tests can manually fire `message` events.
class StubEventSource {
  static instances: StubEventSource[] = []
  listeners: Array<(e: { data: string }) => void> = []
  closed = false
  constructor(public url: string) {
    StubEventSource.instances.push(this)
  }
  addEventListener(_type: 'message', listener: (e: { data: string }) => void): void {
    this.listeners.push(listener)
  }
  close(): void {
    this.closed = true
  }
  /** Test helper: fire a fake event. */
  fire(payload: Record<string, unknown>): void {
    for (const l of this.listeners) l({ data: JSON.stringify(payload) })
  }
}

beforeEach(() => {
  document.body.innerHTML = ''
  StubEventSource.instances = []
  ;(globalThis as { EventSource?: unknown }).EventSource = StubEventSource
})

afterEach(() => {
  document.body.innerHTML = ''
  delete (globalThis as { EventSource?: unknown }).EventSource
})

function mockFetch(noteId = '001'): Array<RequestInit> {
  const calls: Array<RequestInit> = []
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    calls.push(init)
    return new Response(
      JSON.stringify({
        id: noteId,
        filename: `${noteId}-human-text-x.md`,
        path: '/x',
        sessionId: 's',
      }),
      { status: 201 },
    )
  }) as unknown as typeof fetch
  return calls
}

function getStatusLine(): HTMLElement {
  const root = document.getElementById('llui-devmode-annotate-root')!
  // The status line is the sibling div after the textarea.
  const ta = root.querySelector('textarea')!
  let cur: Element | null = ta.nextElementSibling
  while (cur && cur.tagName !== 'DIV') cur = cur.nextElementSibling
  return cur as HTMLElement
}

function clickSolve(): void {
  const root = document.getElementById('llui-devmode-annotate-root')!
  const btn = Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Solve')!
  btn.click()
}

describe('live status feedback during Solve', () => {
  it('action buttons stay ENABLED after Solve so the user can capture more tasks', async () => {
    mockFetch('042')
    mountAnnotateHud({ origin: 'http://localhost' })
    const root = document.getElementById('llui-devmode-annotate-root')!
    const ta = root.querySelector('textarea')!
    const solveBtn = Array.from(root.querySelectorAll('button')).find(
      (b) => b.textContent === 'Solve',
    )!
    ta.value = 'fix the button'
    clickSolve()
    await new Promise((r) => setTimeout(r, 5))

    expect(solveBtn.disabled).toBe(false)
    expect(getStatusLine().textContent).toContain('claude is working')

    const sse = StubEventSource.instances[0]!
    sse.fire({ type: 'status-changed', noteId: '042', to: 'proposed' })
    expect(getStatusLine().textContent).toContain('proposed')
    expect(solveBtn.disabled).toBe(false)

    sse.fire({ type: 'status-changed', noteId: '042', to: 'applied' })
    expect(solveBtn.disabled).toBe(false)
  })

  it('shows the failure reason when status-changed: failed', async () => {
    mockFetch('007')
    mountAnnotateHud({ origin: 'http://localhost' })
    const ta = document.querySelector(
      '#llui-devmode-annotate-root textarea',
    )! as HTMLTextAreaElement
    ta.value = 'fix it'
    clickSolve()
    await new Promise((r) => setTimeout(r, 5))
    const sse = StubEventSource.instances[0]!
    sse.fire({
      type: 'status-changed',
      noteId: '007',
      to: 'failed',
      reason: 'claude exited 1: auth required',
    })
    expect(getStatusLine().textContent).toMatch(/failed.*auth required/)
  })

  it('ignores status-changed for other notes', async () => {
    mockFetch('100')
    mountAnnotateHud({ origin: 'http://localhost' })
    const ta = document.querySelector(
      '#llui-devmode-annotate-root textarea',
    )! as HTMLTextAreaElement
    ta.value = 'a'
    clickSolve()
    await new Promise((r) => setTimeout(r, 5))
    const sse = StubEventSource.instances[0]!
    const baseline = getStatusLine().textContent
    sse.fire({ type: 'status-changed', noteId: '999', to: 'applied' })
    expect(getStatusLine().textContent).toBe(baseline) // unchanged
  })

  it('shows a queue counter when multiple tasks are in flight', async () => {
    let n = 1
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      // Catch-up GETs hit /status — return empty so they don't bump n.
      if (typeof url === 'string' && url.includes('/status')) {
        return new Response(JSON.stringify({ current: null, history: [] }), {
          status: 200,
        })
      }
      void init
      const id = String(n++).padStart(3, '0')
      return new Response(
        JSON.stringify({ id, filename: `${id}-x.md`, path: '/x', sessionId: 's' }),
        { status: 201 },
      )
    }) as unknown as typeof fetch

    mountAnnotateHud({ origin: 'http://localhost' })
    const root = document.getElementById('llui-devmode-annotate-root')!
    const ta = root.querySelector('textarea')!

    ta.value = 'task 1'
    clickSolve()
    await new Promise((r) => setTimeout(r, 5))
    ta.value = 'task 2'
    clickSolve()
    await new Promise((r) => setTimeout(r, 5))
    ta.value = 'task 3'
    clickSolve()
    await new Promise((r) => setTimeout(r, 5))

    const badge = Array.from(root.querySelectorAll('span')).find((s) =>
      (s.textContent ?? '').includes('in queue'),
    )!
    expect(badge.textContent).toBe('3 in queue')

    const sse = StubEventSource.instances[0]!
    sse.fire({ type: 'status-changed', noteId: '001', to: 'applied' })
    sse.fire({ type: 'status-changed', noteId: '002', to: 'applied' })
    expect(badge.textContent).toBe('1 in queue')
    sse.fire({ type: 'status-changed', noteId: '003', to: 'applied' })
    expect(badge.style.display).toBe('none')
  })

  it('fires a toast notification when a task hits a terminal state', async () => {
    mockFetch('010')
    mountAnnotateHud({ origin: 'http://localhost' })
    const ta = document.querySelector(
      '#llui-devmode-annotate-root textarea',
    )! as HTMLTextAreaElement
    ta.value = 'fix this'
    clickSolve()
    await new Promise((r) => setTimeout(r, 5))

    // Sanity: no toast yet
    const toastsBefore = document.body.querySelectorAll('[data-llui-toast]')
    expect(toastsBefore.length).toBe(0)

    const sse = StubEventSource.instances[0]!
    sse.fire({ type: 'status-changed', noteId: '010', to: 'applied' })

    const toastsAfter = document.body.querySelectorAll('[data-llui-toast]')
    expect(toastsAfter.length).toBe(1)
    expect(toastsAfter[0]!.textContent).toMatch(/Note 010.*applied/)
  })

  it('status line follows the LATEST task; earlier tasks complete via toast', async () => {
    let n = 1
    globalThis.fetch = (async (url: string) => {
      if (typeof url === 'string' && url.includes('/status')) {
        return new Response(JSON.stringify({ current: null, history: [] }), {
          status: 200,
        })
      }
      const id = String(n++).padStart(3, '0')
      return new Response(
        JSON.stringify({ id, filename: `${id}.md`, path: '/x', sessionId: 's' }),
        { status: 201 },
      )
    }) as unknown as typeof fetch
    mountAnnotateHud({ origin: 'http://localhost' })
    const ta = document.querySelector(
      '#llui-devmode-annotate-root textarea',
    )! as HTMLTextAreaElement

    ta.value = 'task A'
    clickSolve()
    await new Promise((r) => setTimeout(r, 5))
    ta.value = 'task B'
    clickSolve()
    await new Promise((r) => setTimeout(r, 5))

    // Status line should show the LATEST (task B = id 002) at 'claimed'.
    expect(getStatusLine().textContent).toContain('claude is working')

    const sse = StubEventSource.instances[0]!
    // Older task A finishes — should fire a toast but NOT touch the
    // status line (which is tracking task B).
    sse.fire({ type: 'status-changed', noteId: '001', to: 'proposed', reason: 'fix A' })
    expect(getStatusLine().textContent).toContain('claude is working') // unchanged
    sse.fire({ type: 'status-changed', noteId: '001', to: 'applied' })
    const toasts = document.body.querySelectorAll('[data-llui-toast]')
    expect(toasts.length).toBeGreaterThan(0)

    // Now task B finishes — status line updates.
    sse.fire({ type: 'status-changed', noteId: '002', to: 'proposed', reason: 'fix B' })
    expect(getStatusLine().textContent).toContain('fix B')
  })

  it("'Save note' does NOT track status (intent=note isn't in the queue)", async () => {
    mockFetch('008')
    mountAnnotateHud({ origin: 'http://localhost' })
    const root = document.getElementById('llui-devmode-annotate-root')!
    const ta = root.querySelector('textarea')!
    const saveBtn = Array.from(root.querySelectorAll('button')).find(
      (b) => b.textContent === 'Save note',
    )!
    ta.value = 'fyi'
    saveBtn.click()
    await new Promise((r) => setTimeout(r, 5))
    expect(saveBtn.disabled).toBe(false) // re-enabled immediately for notes
    expect(getStatusLine().textContent).toMatch(/note saved/)

    // A status-changed for the same id should NOT touch the line.
    const sse = StubEventSource.instances[0]!
    sse.fire({ type: 'status-changed', noteId: '008', to: 'claimed' })
    expect(getStatusLine().textContent).toMatch(/note saved/)
  })
})
