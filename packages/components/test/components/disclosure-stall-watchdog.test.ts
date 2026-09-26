import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { component, div, mountApp, renderToString, text, type Mountable } from '@llui/dom'
import * as accordion from '../../src/components/accordion'

/**
 * #264 review item 4: the dev-mode stalled-exit warning used to be a
 * SEPARATE function (`watchForStalledDisclosureExit`) called eagerly from
 * `connect()` and scheduled with a recurring `setInterval` whose disposer
 * every call site discarded — a leak, a `vi.runAllTimers()` hang (a
 * `setInterval` reschedules itself forever), a false warning after
 * dispose, and a bare `catch {}` shaped specifically around this package's
 * OWN `rootSignal()` test double (see `test/_signal.ts`) throwing on
 * `peek()`. It is now folded into the SAME `exitCompletion` mount callback
 * that settles a programmatic close, armed as a one-shot `setTimeout` PER
 * closing transition, disposed by the exact same cleanup the mount's
 * MutationObserver already uses.
 *
 * One accepted trade-off, stated rather than hidden: since the warning now
 * runs only from `exitCompletion`'s OWN mount, a skin that never places
 * `parts.exitCompletion` AT ALL gets no warning any more (previously this
 * watched independent of placement). The registry's root skins now make
 * omitting `exitCompletion` a compile-time error (#264 review item 2), so
 * the remaining exposure is a hand-rolled skin — documented in
 * packages/components/README.md, and outside what a *runtime* diagnostic
 * with no lifetime to hang off can safely cover without the leak this item
 * exists to remove.
 */

interface State {
  accordion: accordion.AccordionState
}
type Msg = { type: 'accordion'; msg: accordion.AccordionMsg }

let app: ReturnType<typeof mountApp> | null = null
let warnSpy: ReturnType<typeof vi.spyOn> | null = null

beforeEach(() => {
  vi.useFakeTimers()
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  app?.dispose()
  app = null
  document.body.replaceChildren()
  warnSpy?.mockRestore()
  warnSpy = null
  vi.useRealTimers()
})

function mount(): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  app = mountApp(
    host,
    component<State, Msg>({
      name: 'DisclosureStallWatchdogFixture',
      init: () => [
        {
          accordion: accordion.init({
            items: ['details'],
            value: ['details'],
            animated: true,
          }),
        },
        [],
      ],
      update: (state, msg) => [
        { ...state, accordion: accordion.update(state.accordion, msg.msg)[0] },
        [],
      ],
      view: ({ state, send }): readonly Mountable[] => {
        const acc = accordion.connect(
          state.at('accordion'),
          (msg) => send({ type: 'accordion', msg }),
          { id: 'stall-accordion' },
        )
        const item = acc.item('details')
        return [
          div({ ...acc.root }, [
            div({ ...item.item }, [
              div({ ...item.trigger }, [text('details')]),
              div({ ...item.content }, [text('content')]),
            ]),
          ]),
          acc.exitCompletion,
        ]
      },
    }),
  )
  return host
}

const content = (host: HTMLElement): HTMLElement =>
  host.querySelector('[data-scope="accordion"][data-part="content"]') as HTMLElement

/**
 * Stub `getAnimations` to report a PERSISTENTLY running effect that never
 * finishes — a genuinely hung exit (a browser bug, a CSS animation that
 * never fires its end event). This is deliberately NOT "no motion at all":
 * a no-motion stub (`getAnimations` returning `[]`) is resolved IMMEDIATELY
 * by `exitCompletion`'s own `check()` the moment the MutationObserver sees
 * the `closing` transition — well before any stall timer is even armed —
 * so it can never reach the deadline with `exitCompletion` placed. Only an
 * effect that keeps reporting as running (so `completeIfUnanimated` keeps
 * declining, on both the initial check AND the timer's own re-check at the
 * deadline) reproduces an actual stall.
 */
function stubStuckAnimation(el: HTMLElement): void {
  const stuck = { playState: 'running', animationName: 'stuck-exit' } as unknown as Animation
  Object.defineProperty(el, 'getAnimations', { configurable: true, value: () => [stuck] })
}

describe('disclosure exit-stall watchdog (#264 review item 4)', () => {
  it('warns once the deadline passes on a genuine stall (exitCompletion placed)', async () => {
    const host = mount()
    const el = content(host)
    stubStuckAnimation(el)

    app?.send({ type: 'accordion', msg: { type: 'close', value: 'details' } })
    // `check()` (which arms the stall timer) re-runs from the
    // MutationObserver watching data-state, whose callback is
    // microtask-scheduled, never synchronous with the mutation — and
    // jsdom's MutationObserver queues through the global `queueMicrotask`,
    // which fake timers intercept too, so flushing needs the ASYNC advance
    // rather than a real `await Promise.resolve()`.
    await vi.advanceTimersByTimeAsync(0)

    expect(warnSpy).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1600)
    expect(warnSpy).toHaveBeenCalled()
    const message = (warnSpy?.mock.calls[0]?.[0] as string) ?? ''
    expect(message).toContain('exitCompletion')
  })

  it('dispose clears pending stall timers (count via fake timers)', async () => {
    const host = mount()
    const el = content(host)
    stubStuckAnimation(el)

    app?.send({ type: 'accordion', msg: { type: 'close', value: 'details' } })
    await vi.advanceTimersByTimeAsync(0)
    const pendingBeforeDispose = vi.getTimerCount()
    expect(pendingBeforeDispose).toBeGreaterThan(0)

    app?.dispose()
    app = null
    expect(vi.getTimerCount()).toBe(0)
  })

  it('no warning fires after dispose, even once the deadline would have passed', async () => {
    const host = mount()
    const el = content(host)
    stubStuckAnimation(el)

    app?.send({ type: 'accordion', msg: { type: 'close', value: 'details' } })
    await vi.advanceTimersByTimeAsync(0)
    app?.dispose()
    app = null

    await vi.advanceTimersByTimeAsync(5000)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('vi.runAllTimers() terminates with a genuinely stalled accordion mounted', async () => {
    const host = mount()
    const el = content(host)
    stubStuckAnimation(el)

    app?.send({ type: 'accordion', msg: { type: 'close', value: 'details' } })
    await vi.advanceTimersByTimeAsync(0)

    // A recurring setInterval-based watchdog reschedules itself forever and
    // hangs this call; the redesigned one-shot-per-transition timer lets the
    // fake-timer queue drain.
    await expect(vi.runAllTimersAsync()).resolves.not.toThrow()
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it('starts no timer during SSR (onMount never runs on the server)', () => {
    const before = vi.getTimerCount()
    const state = accordion.update(
      accordion.init({ items: ['details'], value: ['details'], animated: true }),
      { type: 'close', value: 'details' },
    )[0]
    renderToString(
      {
        init: () => state,
        update: (s) => s,
        view: ({ state: s, send }) => {
          const acc = accordion.connect(s, send, { id: 'ssr-accordion' })
          const item = acc.item('details')
          return [
            div({ ...acc.root }, [
              div({ ...item.item }, [
                div({ ...item.trigger }, [text('details')]),
                div({ ...item.content }, [text('content')]),
              ]),
            ]),
            acc.exitCompletion,
          ]
        },
      },
      state,
      document,
    )
    expect(vi.getTimerCount()).toBe(before)
  })
})
