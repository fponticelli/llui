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

const HUD_STATE_KEY = 'llui-devmode-annotate.hud-state'

/** Seed the compose draft via the persisted-state restore path so the embedded
 * markdown editor mounts with prose in it — the WYSIWYG field has no `.value` to
 * poke directly. Call BEFORE `mountAnnotateHud`. */
function seedProse(text: string): void {
  localStorage.setItem(HUD_STATE_KEY, JSON.stringify({ draftProse: text }))
}

beforeEach(() => {
  document.body.innerHTML = ''
  localStorage.clear()
  StubEventSource.instances = []
  ;(globalThis as { EventSource?: unknown }).EventSource = StubEventSource
})

afterEach(() => {
  document.body.innerHTML = ''
  localStorage.clear()
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
  return root.querySelector('[data-llui-status]') as HTMLElement
}

function clickSolve(): void {
  const root = document.getElementById('llui-devmode-annotate-root')!
  const btn = root.querySelector('[data-llui-solve]') as HTMLButtonElement
  btn.click()
}

/**
 * Poll a synchronous predicate until it returns true, draining microtasks
 * + macrotasks between attempts. `setTimeout(r, 5)` is not a sufficient
 * "wait for submit to settle" — the submit chain has multiple awaits
 * (POST → JSON → .then() → followup GET /status → JSON), so on a busy
 * event loop the chain isn't always done within a fixed 5ms window and
 * the next assertion races a not-yet-registered `trackedTasks` entry.
 * Bounded by a generous overall timeout so a genuine hang still fails
 * the test deterministically rather than spinning forever.
 */
async function waitFor(
  predicate: () => boolean,
  { timeoutMs = 200, intervalMs = 5 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor: predicate did not become truthy within ${timeoutMs}ms`)
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}

function findBadge(kind: 'working' | 'ready'): HTMLElement | null {
  const root = document.getElementById('llui-devmode-annotate-root')
  return root?.querySelector(`[data-llui-badge="${kind}"]`) as HTMLElement | null
}

/**
 * Wait until the "working" badge reports exactly `expected` in-flight
 * tasks. The badge is updated synchronously inside the submit's `.then()`
 * after `trackedTasks.set` runs, so once the badge text matches we know
 * the corresponding task is registered and the SSE handler will pick it
 * up by noteId. Removes the timing race that `await setTimeout(r, 5)`
 * exposed in CI.
 */
async function waitForWorkingCount(expected: number): Promise<void> {
  await waitFor(() => {
    const badge = findBadge('working')
    return !!badge && badge.textContent === `🤖 ${expected} working`
  })
}

describe('live status feedback during Solve', () => {
  it('action buttons stay ENABLED after Solve so the user can capture more tasks', async () => {
    mockFetch('042')
    seedProse('fix the button')
    mountAnnotateHud({ origin: 'http://localhost' })
    const root = document.getElementById('llui-devmode-annotate-root')!
    const solveBtn = root.querySelector('[data-llui-solve]') as HTMLButtonElement
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
    seedProse('fix it')
    mountAnnotateHud({ origin: 'http://localhost' })
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
    seedProse('a')
    mountAnnotateHud({ origin: 'http://localhost' })
    clickSolve()
    await new Promise((r) => setTimeout(r, 5))
    const sse = StubEventSource.instances[0]!
    const baseline = getStatusLine().textContent
    sse.fire({ type: 'status-changed', noteId: '999', to: 'applied' })
    expect(getStatusLine().textContent).toBe(baseline) // unchanged
  })

  it('shows distinct "working" and "ready" counters as tasks progress', async () => {
    let n = 1
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      // Catch-up GETs hit /status — return empty so they don't bump n.
      if (typeof url === 'string' && url.includes('/status')) {
        return new Response(JSON.stringify({ current: null, history: [] }), {
          status: 200,
        })
      }
      // Only POSTs (the submit() call) should mint a note id. GETs to
      // `/_llui/sessions` / `/_llui/notes` etc. — fired by the HUD's
      // debounced `browse.refresh()` triggered from SSE listeners —
      // would otherwise increment `n` and shift the id sequence,
      // causing the SSE assertion below to race against a not-yet-
      // tracked id. A 100ms `setTimeout` from a *prior* test's
      // browse.refresh can also fire into THIS test's fetch stub, so
      // the same guard protects against cross-test pollution.
      if (init?.method !== 'POST') {
        return new Response(JSON.stringify({ sessions: [], notes: [], queue: [] }), { status: 200 })
      }
      const id = String(n++).padStart(3, '0')
      return new Response(
        JSON.stringify({ id, filename: `${id}-x.md`, path: '/x', sessionId: 's' }),
        { status: 201 },
      )
    }) as unknown as typeof fetch

    const handle = mountAnnotateHud({ origin: 'http://localhost' })
    const root = document.getElementById('llui-devmode-annotate-root')!

    handle.setProse('task 1')
    clickSolve()
    await waitForWorkingCount(1)
    handle.setProse('task 2')
    clickSolve()
    await waitForWorkingCount(2)
    handle.setProse('task 3')
    clickSolve()
    await waitForWorkingCount(3)

    const findBadge = (kind: 'working' | 'ready'): HTMLElement =>
      root.querySelector(`[data-llui-badge="${kind}"]`) as HTMLElement
    expect(findBadge('working').textContent).toBe('🤖 3 working')

    const sse = StubEventSource.instances[0]!
    // Two tasks land in 'proposed' — they move from working → ready
    sse.fire({ type: 'status-changed', noteId: '001', to: 'proposed', reason: 'fix 1' })
    sse.fire({ type: 'status-changed', noteId: '002', to: 'proposed', reason: 'fix 2' })
    expect(findBadge('working').textContent).toBe('🤖 1 working')
    expect(findBadge('ready').textContent).toBe('✓ 2 ready')

    // Accept one — it moves through accepted → applied → removed
    sse.fire({ type: 'status-changed', noteId: '001', to: 'applied' })
    expect(findBadge('ready').textContent).toBe('✓ 1 ready')

    // Last working task also lands as proposed then applied
    sse.fire({ type: 'status-changed', noteId: '003', to: 'proposed', reason: 'fix 3' })
    expect(findBadge('working').style.display).toBe('none')
    expect(findBadge('ready').textContent).toBe('✓ 2 ready')
  })

  it('proposed-state toast carries an Accept button that POSTs to /:id/status', async () => {
    const calls: Array<[string, RequestInit | undefined]> = []
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push([url, init])
      if (typeof url === 'string' && url.includes('/status')) {
        return new Response(JSON.stringify({ current: null, history: [] }), { status: 200 })
      }
      return new Response(
        JSON.stringify({ id: '050', filename: '050.md', path: '/x', sessionId: 's' }),
        { status: 201 },
      )
    }) as unknown as typeof fetch

    const handle = mountAnnotateHud({ origin: 'http://localhost' })
    handle.setProse('fix this')
    clickSolve()
    await new Promise((r) => setTimeout(r, 5))

    const sse = StubEventSource.instances[0]!
    sse.fire({
      type: 'status-changed',
      noteId: '050',
      to: 'proposed',
      reason: 'rename foo to bar',
    })

    // Toast appears with an Accept button.
    const toast = document.querySelector('[data-llui-toast="info"]') as HTMLElement
    expect(toast).not.toBeNull()
    const acceptBtn = Array.from(toast.querySelectorAll('button')).find(
      (b) => b.textContent === 'Accept',
    )!
    expect(acceptBtn).not.toBeUndefined()

    // Clicking Accept POSTs to /_llui/notes/050/status with to:accepted
    const callsBefore = calls.length
    acceptBtn.click()
    await new Promise((r) => setTimeout(r, 5))
    const newCalls = calls.slice(callsBefore)
    const acceptCall = newCalls.find(
      ([url, init]) =>
        typeof url === 'string' &&
        url.includes('/_llui/notes/050/status') &&
        init?.method === 'POST',
    )
    expect(acceptCall).not.toBeUndefined()
    const body = JSON.parse((acceptCall![1] as RequestInit).body as string) as {
      to: string
    }
    expect(body.to).toBe('accepted')
  })

  it('fires a toast notification when a task hits a terminal state', async () => {
    mockFetch('010')
    const handle = mountAnnotateHud({ origin: 'http://localhost' })
    handle.setProse('fix this')
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
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.includes('/status')) {
        return new Response(JSON.stringify({ current: null, history: [] }), {
          status: 200,
        })
      }
      // Same id-mint protection as "shows distinct working and ready
      // counters" — see the long-form comment there.
      if (init?.method !== 'POST') {
        return new Response(JSON.stringify({ sessions: [], notes: [], queue: [] }), { status: 200 })
      }
      const id = String(n++).padStart(3, '0')
      return new Response(
        JSON.stringify({ id, filename: `${id}.md`, path: '/x', sessionId: 's' }),
        { status: 201 },
      )
    }) as unknown as typeof fetch
    const handle = mountAnnotateHud({ origin: 'http://localhost' })

    handle.setProse('task A')
    clickSolve()
    await waitForWorkingCount(1)
    handle.setProse('task B')
    clickSolve()
    await waitForWorkingCount(2)

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

    // Now task B finishes — status line updates. Wrap in waitFor: under
    // heavy concurrent test load the click-handler -> POST -> .then ->
    // followup fetch chain has > 1 await hop; even after
    // waitForWorkingCount(2) confirms `trackedTasks` has '002', the
    // statusLine write inside `handleStatusUpdate` runs synchronously
    // from the SSE callback, but JSDOM-on-busy-CPU occasionally schedules
    // the SSE listener invocation behind a stray microtask of the
    // followup fetch's resumption. waitFor absorbs the millisecond.
    sse.fire({ type: 'status-changed', noteId: '002', to: 'proposed', reason: 'fix B' })
    expect(getStatusLine().textContent).toContain('fix B')
  })

  it("'Save note' does NOT track status (intent=note isn't in the queue)", async () => {
    mockFetch('008')
    const handle = mountAnnotateHud({ origin: 'http://localhost' })
    const root = document.getElementById('llui-devmode-annotate-root')!
    const saveBtn = Array.from(root.querySelectorAll('button')).find(
      (b) => b.textContent === 'Save note',
    )!
    handle.setProse('fyi')
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
