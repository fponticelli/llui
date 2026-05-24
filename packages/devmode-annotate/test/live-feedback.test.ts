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
  it('keeps the action buttons disabled until a terminal status arrives', async () => {
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

    expect(solveBtn.disabled).toBe(true)
    // Optimistic: by the time the POST returns, the router has already
    // claimed synchronously on the bus, so the HUD shows 'claimed'
    // immediately — never the fleeting 'queued' state.
    expect(getStatusLine().textContent).toContain('claude is working')

    const sse = StubEventSource.instances[0]!
    // A late 'claimed' SSE event (e.g. arriving after the optimistic
    // render) is a no-op — the label already says 'working'.
    sse.fire({ type: 'status-changed', noteId: '042', to: 'claimed' })
    expect(getStatusLine().textContent).toContain('claude is working')
    expect(solveBtn.disabled).toBe(true) // still in flight

    // Router fires proposed
    sse.fire({ type: 'status-changed', noteId: '042', to: 'proposed' })
    expect(getStatusLine().textContent).toContain('proposed')
    expect(solveBtn.disabled).toBe(true) // still not terminal (user needs to accept)

    // User accepts; middleware appends 'applied'
    sse.fire({ type: 'status-changed', noteId: '042', to: 'applied' })
    expect(getStatusLine().textContent).toContain('applied')
    expect(solveBtn.disabled).toBe(false) // terminal — buttons re-enabled
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
