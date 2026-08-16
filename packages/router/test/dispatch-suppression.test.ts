import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRouter, route } from '../src/index'
import { connectRouter } from '../src/connect'
import { mountApp, component, text } from '@llui/dom'

const registry = {
  home: route('/'),
  admin: route('/admin'),
  article: route('/article/:slug'),
}
type Registry = typeof registry

function hashRouter() {
  return createRouter(registry)
}

function historyRouter() {
  return createRouter(registry, { mode: 'history' })
}

/** Mount a listener and return { send, dispose }. */
function mountListener(routing: ReturnType<typeof connectRouter<Registry>>) {
  const send = vi.fn()
  const container = document.createElement('div')
  const App = component({
    name: 'L',
    init: (): [null, never[]] => [null, []],
    update: (s: null): [null, never[]] => [s, []],
    view: () => [...routing.listener(send), text('')],
  })
  const handle = mountApp(container, App)
  return { send, dispose: () => handle.dispose() }
}

/** A stamp of the kind the router writes: an index AND the run it belongs to. */
const RUN = 'test-run'
function stamp(index: number): Record<string, unknown> {
  return { __llui_idx: index, __llui_run: RUN }
}

// jsdom fires the real hashchange asynchronously; these tests instead drive the
// echo synchronously (dispatchEvent) and dispose before the async echo lands, so
// each assertion is deterministic and free of cross-test timing leaks.
const fireHashchange = () => window.dispatchEvent(new HashChangeEvent('hashchange'))

describe('hash mode single dispatch (finding 2)', () => {
  beforeEach(async () => {
    location.hash = ''
    // Drain any pending async hashchange from the previous test.
    await new Promise((r) => setTimeout(r, 5))
  })

  it('navigate() dispatches exactly once — the echo hashchange is suppressed (2a)', () => {
    const routing = connectRouter(hashRouter())
    const { send, dispose } = mountListener(routing)

    routing.handleEffect({
      effect: routing.navigate('article', { slug: 'x' }),
      send: send as unknown as (m: unknown) => void,
      signal: new AbortController().signal,
    })

    // Synchronously dispatched once by the effect.
    expect(send).toHaveBeenCalledTimes(1)
    // The echo hashchange must be swallowed, not re-sent.
    fireHashchange()
    expect(send).toHaveBeenCalledTimes(1)

    dispose()
  })

  it('push() is URL-only — the echo hashchange does not dispatch (2b)', () => {
    const routing = connectRouter(hashRouter())
    const { send, dispose } = mountListener(routing)

    routing.handleEffect({
      effect: routing.push('admin'),
      send: send as unknown as (m: unknown) => void,
      signal: new AbortController().signal,
    })

    expect(send).not.toHaveBeenCalled()
    expect(location.hash).toBe('#/admin')
    fireHashchange()
    expect(send).not.toHaveBeenCalled()

    dispose()
  })

  it('replace() is URL-only — and produces no hashchange to suppress (2b, #164)', async () => {
    // This one CANNOT use `fireHashchange`, and the reason is the change #164
    // made. The replace effect writes with `replaceState`, whose URL-and-history
    // update steps fire no event at all — so a synthetic `hashchange` dispatched
    // after it is not standing in for an echo the browser queued, it is
    // asserting an event the platform will never deliver, and the listener is
    // right to treat one as a genuine navigation.
    //
    // The real property is therefore stronger than "the echo is swallowed":
    // there is no echo. Asserted by letting the event loop run, which is when a
    // queued one would have landed. Under the previous `location.replace`
    // mechanism jsdom DOES queue one here, and this settle is what would catch a
    // revert that forgot to re-arm the suppression with it.
    const routing = connectRouter(hashRouter())
    const { send, dispose } = mountListener(routing)

    routing.handleEffect({
      effect: routing.replace('admin'),
      send: send as unknown as (m: unknown) => void,
      signal: new AbortController().signal,
    })

    expect(send).not.toHaveBeenCalled()
    expect(location.hash).toBe('#/admin')
    await new Promise((r) => setTimeout(r, 10))
    expect(send).not.toHaveBeenCalled()

    dispose()
  })

  it('a genuine external hash change still dispatches (listener works)', () => {
    const routing = connectRouter(hashRouter())
    const { send, dispose } = mountListener(routing)

    // Simulate the user editing the URL bar — not one of our effects.
    location.hash = '#/article/y'
    fireHashchange()

    expect(send).toHaveBeenCalledWith({
      type: 'navigate',
      location: { name: 'article', params: { slug: 'y' } },
    })

    dispose()
  })
})

describe('history mode blocked popstate restores via history.go, never pushState (finding 2c)', () => {
  beforeEach(() => {
    history.replaceState(null, '', '/')
  })

  it('reverses a blocked back-navigation with history.go(delta) and does not pushState', () => {
    // Seed: we are at index 1 on "/", numbered in RUN. The run travels with the
    // index or the router has no position to measure against — a bare
    // `{ __llui_idx: n }` is what a build predating `__llui_run` wrote, and
    // those restarted their numbering across gaps they never recorded, so the
    // router refuses to subtract across one (#150 review; the legacy shape is
    // pinned in `legacy-stamps.test.ts`).
    history.replaceState(stamp(1), '', '/')
    const routing = connectRouter(historyRouter(), { beforeEnter: () => false })
    const { dispose } = mountListener(routing)

    const goSpy = vi.spyOn(history, 'go').mockImplementation(() => {})
    const pushSpy = vi.spyOn(history, 'pushState')

    // Simulate the browser back button landing on /admin (index 0).
    history.replaceState(stamp(0), '', '/admin')
    window.dispatchEvent(new PopStateEvent('popstate', { state: stamp(0) }))

    // Blocked → restore forward one entry (1 - 0 = 1). No stray pushState.
    expect(goSpy).toHaveBeenCalledWith(1)
    expect(pushSpy).not.toHaveBeenCalled()

    goSpy.mockRestore()
    pushSpy.mockRestore()
    dispose()
  })

  it('does not restore repeatedly — a second blocked popstate never grows history via pushState', () => {
    history.replaceState(stamp(2), '', '/')
    const routing = connectRouter(historyRouter(), { beforeEnter: () => false })
    const { dispose } = mountListener(routing)

    const goSpy = vi.spyOn(history, 'go').mockImplementation(() => {})
    const pushSpy = vi.spyOn(history, 'pushState')

    history.replaceState(stamp(1), '', '/admin')
    window.dispatchEvent(new PopStateEvent('popstate', { state: stamp(1) }))
    history.replaceState(stamp(0), '', '/admin')
    window.dispatchEvent(new PopStateEvent('popstate', { state: stamp(0) }))

    expect(pushSpy).not.toHaveBeenCalled()
    // history.go was used for the restores (not pushState).
    expect(goSpy).toHaveBeenCalled()

    goSpy.mockRestore()
    pushSpy.mockRestore()
    dispose()
  })
})
