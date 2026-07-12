import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRouter, route, param } from '../src/index'
import { connectRouter } from '../src/connect'
import { mountApp, component, text } from '@llui/dom'

type Route = { page: 'home' } | { page: 'admin' } | { page: 'article'; slug: string }

function hashRouter() {
  return createRouter<Route>([
    route([], () => ({ page: 'home' })),
    route(['admin'], () => ({ page: 'admin' })),
    route(['article', param('slug')], ({ slug }) => ({ page: 'article', slug })),
  ])
}

function historyRouter() {
  return createRouter<Route>(
    [
      route([], () => ({ page: 'home' })),
      route(['admin'], () => ({ page: 'admin' })),
      route(['article', param('slug')], ({ slug }) => ({ page: 'article', slug })),
    ],
    { mode: 'history' },
  )
}

/** Mount a listener and return { send, dispose }. */
function mountListener(routing: ReturnType<typeof connectRouter<Route>>) {
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
      effect: routing.navigate({ page: 'article', slug: 'x' }),
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
      effect: routing.push({ page: 'admin' }),
      send: send as unknown as (m: unknown) => void,
      signal: new AbortController().signal,
    })

    expect(send).not.toHaveBeenCalled()
    expect(location.hash).toBe('#/admin')
    fireHashchange()
    expect(send).not.toHaveBeenCalled()

    dispose()
  })

  it('replace() is URL-only — the echo hashchange does not dispatch (2b)', () => {
    const routing = connectRouter(hashRouter())
    const { send, dispose } = mountListener(routing)

    routing.handleEffect({
      effect: routing.replace({ page: 'admin' }),
      send: send as unknown as (m: unknown) => void,
      signal: new AbortController().signal,
    })

    expect(send).not.toHaveBeenCalled()
    fireHashchange()
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
      route: { page: 'article', slug: 'y' },
    })

    dispose()
  })
})

describe('history mode blocked popstate restores via history.go, never pushState (finding 2c)', () => {
  beforeEach(() => {
    history.replaceState(null, '', '/')
  })

  it('reverses a blocked back-navigation with history.go(delta) and does not pushState', () => {
    // Seed: we are at index 1 on "/".
    history.replaceState({ __llui_idx: 1 }, '', '/')
    const routing = connectRouter(historyRouter(), { beforeEnter: () => false })
    const { dispose } = mountListener(routing)

    const goSpy = vi.spyOn(history, 'go').mockImplementation(() => {})
    const pushSpy = vi.spyOn(history, 'pushState')

    // Simulate the browser back button landing on /admin (index 0).
    history.replaceState({ __llui_idx: 0 }, '', '/admin')
    window.dispatchEvent(new PopStateEvent('popstate', { state: { __llui_idx: 0 } }))

    // Blocked → restore forward one entry (1 - 0 = 1). No stray pushState.
    expect(goSpy).toHaveBeenCalledWith(1)
    expect(pushSpy).not.toHaveBeenCalled()

    goSpy.mockRestore()
    pushSpy.mockRestore()
    dispose()
  })

  it('does not restore repeatedly — a second blocked popstate never grows history via pushState', () => {
    history.replaceState({ __llui_idx: 2 }, '', '/')
    const routing = connectRouter(historyRouter(), { beforeEnter: () => false })
    const { dispose } = mountListener(routing)

    const goSpy = vi.spyOn(history, 'go').mockImplementation(() => {})
    const pushSpy = vi.spyOn(history, 'pushState')

    history.replaceState({ __llui_idx: 1 }, '', '/admin')
    window.dispatchEvent(new PopStateEvent('popstate', { state: { __llui_idx: 1 } }))
    history.replaceState({ __llui_idx: 0 }, '', '/admin')
    window.dispatchEvent(new PopStateEvent('popstate', { state: { __llui_idx: 0 } }))

    expect(pushSpy).not.toHaveBeenCalled()
    // history.go was used for the restores (not pushState).
    expect(goSpy).toHaveBeenCalled()

    goSpy.mockRestore()
    pushSpy.mockRestore()
    dispose()
  })
})
