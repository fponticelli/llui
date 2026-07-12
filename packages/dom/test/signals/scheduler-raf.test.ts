import { describe, it, expect, vi, afterEach } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import { component, div, text, button } from '../../src/signals/authoring'

// Opt-in frame-scheduled commits (`scheduler: 'raf'`) — the streaming/burst
// fast path for consumers that accept DOM-lags-state-by-a-frame: reducers and
// effects stay SYNCHRONOUS (state/getState advance immediately, the sync
// contract holds for data), but the DOM commit + subscriber notification
// coalesce to one reconcile per animation frame (microtask fallback where rAF
// doesn't exist: SSR/jsdom/headless agent). Measured endpoint: the batch-1k
// ticker op (5.9ms vs 14.1 unbatched — vanilla parity).

type S = { n: number; label: string }
type Msg = { type: 'inc' } | { type: 'label'; v: string } | { type: 'ping' }
type Eff = { type: 'fx'; n: number }

function makeApp(onFx?: (n: number) => void) {
  return component<S, Msg, Eff>({
    name: 'sched',
    init: () => [{ n: 0, label: 'a' }, []],
    update: (s, m) => {
      if (m.type === 'inc') return [{ ...s, n: s.n + 1 }, [{ type: 'fx', n: s.n + 1 }]]
      if (m.type === 'label') return [{ ...s, label: m.v }, []]
      return [s, []]
    },
    onEffect: (e) => {
      onFx?.(e.n)
    },
    view: ({ state }) => [div({ class: 'out' }, [text(state.at('n').map((n) => String(n)))])],
  })
}

function fakeRaf() {
  const frames: Array<() => void> = []
  const cancelled: number[] = []
  vi.stubGlobal('requestAnimationFrame', (cb: () => void): number => {
    frames.push(cb)
    return frames.length
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number): void => {
    cancelled.push(id)
    frames[id - 1] = () => {}
  })
  const runFrame = (): void => {
    const fs = frames.splice(0)
    for (const f of fs) f()
  }
  return { frames, cancelled, runFrame }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("scheduler: 'raf'", () => {
  it('state advances synchronously; DOM + subscribers coalesce to ONE commit at the frame', () => {
    const raf = fakeRaf()
    const container = document.createElement('div')
    const h = mountSignalComponent(container, makeApp(), { scheduler: 'raf' })
    const out = (): string => container.querySelector('.out')!.textContent ?? ''
    let notified = 0
    h.subscribe(() => notified++)

    expect(out()).toBe('0') // initial mount commits synchronously
    for (let i = 0; i < 5; i++) h.send({ type: 'inc' })
    expect((h.getState() as S).n).toBe(5) // sync data contract holds
    expect(out()).toBe('0') // DOM lags until the frame
    expect(notified).toBe(0)

    raf.runFrame()
    expect(out()).toBe('5') // one coalesced commit
    expect(notified).toBe(1)
  })

  it('effects fire synchronously per send, before the frame', () => {
    const raf = fakeRaf()
    const fx: number[] = []
    const container = document.createElement('div')
    const h = mountSignalComponent(
      container,
      makeApp((n) => fx.push(n)),
      { scheduler: 'raf' },
    )
    h.send({ type: 'inc' })
    h.send({ type: 'inc' })
    expect(fx).toEqual([1, 2]) // before any frame ran
    raf.runFrame()
    expect(fx).toEqual([1, 2])
  })

  it('flush() commits synchronously and the cancelled frame does not double-commit', () => {
    const raf = fakeRaf()
    const container = document.createElement('div')
    const h = mountSignalComponent(container, makeApp(), { scheduler: 'raf' })
    const out = (): string => container.querySelector('.out')!.textContent ?? ''
    let notified = 0
    h.subscribe(() => notified++)

    h.send({ type: 'inc' })
    expect(out()).toBe('0')
    h.flush()
    expect(out()).toBe('1')
    expect(notified).toBe(1)
    raf.runFrame() // whatever frame survives must be a no-op
    expect(notified).toBe(1)
  })

  it('a send from a subscriber during the flush settles within the SAME frame', () => {
    const raf = fakeRaf()
    const container = document.createElement('div')
    const h = mountSignalComponent(container, makeApp(), { scheduler: 'raf' })
    const out = (): string => container.querySelector('.out')!.textContent ?? ''
    let once = true
    h.subscribe(() => {
      if (once) {
        once = false
        h.send({ type: 'label', v: 'b' }) // commit-induced message (the blur case)
      }
    })
    h.send({ type: 'inc' })
    raf.runFrame()
    expect(out()).toBe('1')
    expect((h.getState() as S).label).toBe('b') // settled synchronously in the flush
    expect(raf.frames.length).toBe(0) // no cascading frame
  })

  it('falls back to a microtask when requestAnimationFrame is unavailable', async () => {
    vi.stubGlobal('requestAnimationFrame', undefined)
    const container = document.createElement('div')
    const h = mountSignalComponent(container, makeApp(), { scheduler: 'raf' })
    const out = (): string => container.querySelector('.out')!.textContent ?? ''
    h.send({ type: 'inc' })
    expect(out()).toBe('0')
    await Promise.resolve()
    expect(out()).toBe('1')
  })

  it('dispose() cancels the pending frame (no commit after unmount)', () => {
    const raf = fakeRaf()
    const container = document.createElement('div')
    const h = mountSignalComponent(container, makeApp(), { scheduler: 'raf' })
    let notified = 0
    h.subscribe(() => notified++)
    h.send({ type: 'inc' })
    h.dispose()
    raf.runFrame()
    expect(notified).toBe(0)
  })

  it('flush() from inside an onEffect (during a drain) does not reenter drain (finding 7)', () => {
    const raf = fakeRaf()
    const container = document.createElement('div')
    // onEffect for the FIRST effect flushes; the effect handler runs while the
    // outer drain is active. Saving/restoring `draining` across the flush keeps the
    // outer drain intact — a subsequent send stays queued (not a nested drain), so
    // each message is processed exactly once.
    const processed: string[] = []
    let flushed = false
    let handle: { flush(): void; send(m: Msg): void } | null = null
    const app = component<S, Msg, Eff>({
      name: 'sched-flush',
      init: () => [{ n: 0, label: 'a' }, []],
      update: (s, m) => {
        processed.push(m.type)
        if (m.type === 'inc') return [{ ...s, n: s.n + 1 }, [{ type: 'fx', n: s.n + 1 }]]
        if (m.type === 'label') return [{ ...s, label: m.v }, []]
        return [s, []]
      },
      onEffect: (_e) => {
        if (!flushed) {
          flushed = true
          handle!.send({ type: 'label', v: 'b' })
          handle!.flush() // re-entrant flush during the active drain
        }
      },
      view: ({ state }) => [div({ class: 'out' }, [text(state.at('n').map((n) => String(n)))])],
    })
    handle = mountSignalComponent(container, app, { scheduler: 'raf' }) as unknown as typeof handle
    handle!.send({ type: 'inc' })
    // Each message ran exactly once, correct order — no reentrancy double-processing.
    expect(processed).toEqual(['inc', 'label'])
    expect((handle as unknown as { getState(): S }).getState().n).toBe(1)
    expect((handle as unknown as { getState(): S }).getState().label).toBe('b')
    expect(container.querySelector('.out')!.textContent).toBe('1') // flush committed
    raf.runFrame() // any surviving frame is a harmless no-op
    ;(handle as unknown as { dispose(): void }).dispose()
  })

  it("default ('sync') mode is untouched: commit per send, flush() a no-op", () => {
    const raf = fakeRaf()
    const container = document.createElement('div')
    const h = mountSignalComponent(container, makeApp())
    const out = (): string => container.querySelector('.out')!.textContent ?? ''
    h.send({ type: 'inc' })
    expect(out()).toBe('1') // synchronous as ever
    expect(raf.frames.length).toBe(0)
    h.flush() // no-op
    expect(out()).toBe('1')
  })
})
