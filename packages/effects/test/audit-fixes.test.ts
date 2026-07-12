import { describe, it, expect, vi } from 'vitest'
import {
  handleEffects,
  http,
  cancel,
  debounce,
  interval,
  timeout,
  sequence,
  websocket,
  type Effect,
} from '../src/index'

type Send = (msg: Record<string, unknown>) => void

// Minimal ambient for Node's process (no @types/node in the check tsconfig).
declare const process: {
  on(event: 'unhandledRejection', cb: (reason: unknown) => void): void
  off(event: 'unhandledRejection', cb: (reason: unknown) => void): void
}

function mockResponse(body: unknown, opts?: { ok?: boolean; status?: number }) {
  const ok = opts?.ok ?? true
  return {
    ok,
    status: opts?.status ?? (ok ? 200 : 500),
    statusText: ok ? 'OK' : 'Error',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  }
}

// ── Finding #1: per-mount lifecycle isolation ───────────────────────────────
describe('per-mount registry isolation', () => {
  it('two concurrent mounts with the same interval key do not interfere', () => {
    vi.useFakeTimers()
    const handler = handleEffects<Effect, Record<string, unknown>>().else(() => {})

    const a = new AbortController()
    const b = new AbortController()
    const sendA = vi.fn<Send>()
    const sendB = vi.fn<Send>()

    // Same key 'tick' on TWO different mounts (distinct signals).
    handler({ effect: interval('tick', 50, { type: 'a' }), send: sendA, signal: a.signal })
    handler({ effect: interval('tick', 50, { type: 'b' }), send: sendB, signal: b.signal })

    vi.advanceTimersByTime(50)
    expect(sendA).toHaveBeenCalledTimes(1)
    expect(sendB).toHaveBeenCalledTimes(1)

    // Dispose mount A only.
    a.abort()
    vi.advanceTimersByTime(100)

    // A stopped; B keeps ticking, undisturbed by A's disposal.
    expect(sendA).toHaveBeenCalledTimes(1)
    expect(sendB).toHaveBeenCalledTimes(3)

    b.abort()
    vi.useRealTimers()
  })

  it('a second sequential mount of one definition still registers cleanup', () => {
    vi.useFakeTimers()
    const handler = handleEffects<Effect, Record<string, unknown>>().else(() => {})

    // Mount 1: start + dispose.
    const m1 = new AbortController()
    handler({ effect: interval('t', 50, { type: 'x' }), send: vi.fn<Send>(), signal: m1.signal })
    m1.abort()

    // Mount 2 (fresh signal): its interval must run AND be independently torn down
    // on unmount — the old `cleanupRegistered` latch starved later mounts.
    const m2 = new AbortController()
    const send2 = vi.fn<Send>()
    handler({ effect: interval('t', 50, { type: 'y' }), send: send2, signal: m2.signal })

    vi.advanceTimersByTime(50)
    expect(send2).toHaveBeenCalledTimes(1)

    m2.abort()
    vi.advanceTimersByTime(200)
    expect(send2).toHaveBeenCalledTimes(1) // stopped → cleanup fired
    vi.useRealTimers()
  })

  it('disposing mount A leaves mount B in-flight http alive', async () => {
    const opened: Array<{ url: string; signal: AbortSignal }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (url: string, opts: { signal: AbortSignal }) =>
          new Promise((resolve, reject) => {
            opened.push({ url, signal: opts.signal })
            opts.signal.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            )
          }),
      ),
    )

    const handler = handleEffects<Effect>().else(() => {})
    const a = new AbortController()
    const b = new AbortController()
    const sendB = vi.fn<Send>()

    handler({
      effect: http<{ type: string }>({
        url: '/a',
        onSuccess: () => ({ type: 'aOk' }),
        onError: () => ({ type: 'aErr' }),
      }),
      send: vi.fn<Send>(),
      signal: a.signal,
    })
    handler({
      effect: http<{ type: string; payload?: unknown }>({
        url: '/b',
        onSuccess: (d) => ({ type: 'bOk', payload: d }),
        onError: () => ({ type: 'bErr' }),
      }),
      send: sendB,
      signal: b.signal,
    })

    await vi.waitFor(() => expect(opened.length).toBe(2))

    // Dispose A → only A's fetch signal aborts.
    a.abort()
    expect(opened[0]!.signal.aborted).toBe(true)
    expect(opened[1]!.signal.aborted).toBe(false)

    vi.unstubAllGlobals()
  })
})

// ── Finding #2/#3: runHttp error classification + abort re-check ─────────────
describe('runHttp guarded region', () => {
  it('does not rebrand a downstream onSuccess/reducer throw as a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({ ok: 1 })))
    const rejections: unknown[] = []
    const onRej = (e: unknown): void => {
      rejections.push(e)
    }
    process.on('unhandledRejection', onRej)

    const onError = vi.fn()
    const handler = handleEffects<Effect>().else(() => {})
    handler({
      effect: http<{ type: string }>({
        url: '/x',
        onSuccess: () => {
          throw new Error('reducer boom')
        },
        onError,
      }),
      send: (m) => m,
      signal: new AbortController().signal,
    })

    await new Promise((r) => setTimeout(r, 20))
    // The throw must surface (as a rejection), NOT be caught + rebranded to onError.
    expect(onError).not.toHaveBeenCalled()
    expect(rejections.length).toBe(1)

    process.off('unhandledRejection', onRej)
    vi.unstubAllGlobals()
  })

  it('re-checks abort after the body await, before sending (success path)', async () => {
    const controller = new AbortController()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        // Abort DURING body parse — the post-await guard must catch it.
        json: async () => {
          controller.abort()
          return { data: 1 }
        },
      }),
    )
    const send = vi.fn<Send>()
    const handler = handleEffects<Effect>().else(() => {})
    handler({
      effect: http<{ type: string }>({
        url: '/x',
        onSuccess: () => ({ type: 'ok' }),
        onError: () => ({ type: 'e' }),
      }),
      send,
      signal: controller.signal,
    })

    await new Promise((r) => setTimeout(r, 20))
    expect(send).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

// ── Finding #4: sequence advances past a completes-without-dispatch step ─────
describe('sequence completes-without-dispatch policy', () => {
  it('runs the step after a bare cancel() (which never dispatches)', async () => {
    vi.useFakeTimers()
    const send = vi.fn<Send>()
    const signal = new AbortController().signal
    const handler = handleEffects<Effect, Record<string, unknown>>().else(() => {})

    handler({
      effect: sequence([cancel('nothing'), timeout(10, { type: 'after-cancel' })]),
      send,
      signal,
    })

    // Bare cancel completes without dispatch → step 2 (timeout) must be scheduled.
    vi.advanceTimersByTime(10)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({ type: 'after-cancel' })
    vi.useRealTimers()
  })
})

// ── Finding #5: debounce + cancel aborts the in-flight inner request ─────────
describe('debounce + cancel', () => {
  it('cancel(key) after the debounce fired aborts the in-flight http', async () => {
    vi.useFakeTimers()
    let inflightSignal: AbortSignal | null = null
    let aborted = false
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url: string, opts: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            inflightSignal = opts.signal
            opts.signal.addEventListener('abort', () => {
              aborted = true
              reject(new DOMException('Aborted', 'AbortError'))
            })
          }),
      ),
    )

    const send = vi.fn<Send>()
    const signal = new AbortController().signal
    const handler = handleEffects<Effect>().else(() => {})

    handler({
      effect: debounce(
        'search',
        100,
        http<{ type: string }>({
          url: '/api/search',
          onSuccess: () => ({ type: 'ok' }),
          onError: () => ({ type: 'err' }),
        }),
      ),
      send,
      signal,
    })

    // Fire the debounce → the inner http is now in flight.
    vi.advanceTimersByTime(100)
    expect(inflightSignal).not.toBeNull()
    expect(aborted).toBe(false)

    // cancel(key) must reach the in-flight request via the key-registered controller.
    handler({ effect: cancel('search'), send, signal })
    expect(aborted).toBe(true)

    vi.useRealTimers()
    vi.unstubAllGlobals()
  })
})

// ── Finding #6: websocket replacement race ──────────────────────────────────
describe('websocket replacement', () => {
  class FakeWS {
    static instances: FakeWS[] = []
    static readonly OPEN = 1
    url: string
    readyState = 0
    onopen: (() => void) | null = null
    onmessage: ((e: MessageEvent) => void) | null = null
    onclose: ((e: CloseEvent) => void) | null = null
    onerror: (() => void) | null = null
    constructor(url: string) {
      this.url = url
      FakeWS.instances.push(this)
    }
    send(_data: string): void {}
    close(): void {
      this.readyState = 3
      // Async close notification — the source of the replacement race.
      queueMicrotask(() => {
        if (this.onclose) this.onclose({ code: 1000, reason: '' } as CloseEvent)
      })
    }
  }

  it("the old socket's async onclose neither removes the replacement nor dispatches app onClose", async () => {
    FakeWS.instances = []
    vi.stubGlobal('WebSocket', FakeWS as unknown as typeof WebSocket)

    const send = vi.fn<Send>()
    const closes: number[] = []
    const handler = handleEffects<Effect>().else(() => {})
    const signal = new AbortController().signal

    const mk = (n: number) =>
      websocket<{ type: string }>({
        url: `wss://x/${n}`,
        key: 'conn',
        onMessage: () => ({ type: 'msg' }),
        onClose: () => {
          closes.push(n)
          return { type: 'closed' }
        },
      })

    handler({ effect: mk(1), send, signal })
    handler({ effect: mk(2), send, signal }) // replaces socket 1

    // Flush the old socket's async onclose.
    await new Promise((r) => setTimeout(r, 10))

    // Socket 1's onclose must have been detached → no app onClose for it.
    expect(closes).not.toContain(1)
    // Sending on the key must reach the replacement (socket 2), still registered.
    FakeWS.instances[1]!.readyState = 1 // OPEN
    const sent: string[] = []
    FakeWS.instances[1]!.send = ((d: string) => sent.push(d)) as never
    handler({ effect: { type: 'ws-send', key: 'conn', data: 'hi' } as Effect, send, signal })
    expect(sent).toEqual(['hi'])

    vi.unstubAllGlobals()
  })
})

// ── Finding #7: listeners removed when the timer fires ───────────────────────
describe('abort-listener hygiene', () => {
  it('a completed delay() removes its abort listener', () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener')
    const handler = handleEffects<Effect, Record<string, unknown>>().else(() => {})

    handler({
      effect: timeout(50, { type: 'done' }),
      send: vi.fn<Send>(),
      signal: controller.signal,
    })
    vi.advanceTimersByTime(50)

    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function))
    vi.useRealTimers()
  })
})
