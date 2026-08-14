import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRouter, route, param } from '../src/index'
import { connectRouter } from '../src/connect'
import type { ConnectOptions } from '../src/connect'
import { mountApp, component, text } from '@llui/dom'

// Issue #110 — three gaps sharing the hash-mode/guard seam:
//   1. a hash-mode click on the CURRENT route preventDefault'd and then did
//      nothing at all — a dead click;
//   2. a hash-mode link was inert without a mounted listener(), so it also
//      never ran guards at click time;
//   3. push()/replace() honoured a guard REDIRECT but dispatched nothing, so
//      `state.route` (set by the reducer that emitted the URL-only effect) and
//      the URL disagreed permanently.

type Route = { page: 'home' } | { page: 'admin' } | { page: 'article'; slug: string }

const defs = () => [
  route<Route>([], () => ({ page: 'home' })),
  route<Route>(['admin'], () => ({ page: 'admin' })),
  route<Route>(['article', param('slug')], ({ slug }) => ({ page: 'article', slug: slug! })),
]

const hashRouter = () => createRouter<Route>(defs())
const historyRouter = () => createRouter<Route>(defs(), { mode: 'history' })

const settle = () => new Promise((r) => setTimeout(r, 10))

/** Mount a link with NO listener() — the point of half these tests. */
function mountLink(
  routing: ReturnType<typeof connectRouter<Route>>,
  send: (msg: unknown) => void,
  to: Route,
) {
  const container = document.createElement('div')
  const App = component({
    name: 'T',
    init: (): [null, never[]] => [null, []],
    update: (s: null): [null, never[]] => [s, []],
    view: () => [routing.link(send, to, {}, [text('go')])],
  })
  const handle = mountApp(container, App)
  return { anchor: container.querySelector('a')!, dispose: () => handle.dispose() }
}

function click(anchor: HTMLAnchorElement): MouseEvent {
  const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
  anchor.dispatchEvent(ev)
  return ev
}

function run(
  routing: ReturnType<typeof connectRouter<Route>>,
  effect: ReturnType<ReturnType<typeof connectRouter<Route>>['push']>,
  send: (msg: unknown) => void,
) {
  routing.handleEffect({ effect, send, signal: new AbortController().signal })
}

describe('#110.1 a same-route hash click dispatches', () => {
  beforeEach(async () => {
    location.hash = ''
    await settle()
  })

  it('dispatches even though the URL does not change', async () => {
    location.hash = '#/admin'
    await settle()
    const routing = connectRouter(hashRouter())
    const send = vi.fn()
    const { anchor, dispose } = mountLink(routing, send, { page: 'admin' })

    const ev = click(anchor)

    // The contract: link() intercepts and dispatches in BOTH modes. A click on
    // the current route is a request to re-enter it, not a no-op.
    expect(ev.defaultPrevented).toBe(true)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({ type: 'navigate', route: { page: 'admin' } })

    dispose()
  })
})

describe('#110.2 a hash link works without a mounted listener()', () => {
  beforeEach(async () => {
    location.hash = ''
    await settle()
  })

  it('writes the URL and dispatches with no listener in the tree', async () => {
    const routing = connectRouter(hashRouter())
    const send = vi.fn()
    const { anchor, dispose } = mountLink(routing, send, { page: 'article', slug: 'x' })

    click(anchor)

    expect(location.hash).toBe('#/article/x')
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({
      type: 'navigate',
      route: { page: 'article', slug: 'x' },
    })

    dispose()
    await settle()
  })

  it('runs guards at click time and leaves no junk entry when blocked', async () => {
    const options: ConnectOptions<Route> = { beforeEnter: (to) => to.page !== 'admin' && undefined }
    const routing = connectRouter(hashRouter(), options)
    const send = vi.fn()
    const { anchor, dispose } = mountLink(routing, send, { page: 'admin' })

    const hashBefore = location.hash
    const lengthBefore = history.length
    click(anchor)

    expect(send).not.toHaveBeenCalled()
    expect(location.hash).toBe(hashBefore)
    expect(history.length).toBe(lengthBefore)

    dispose()
  })

  it('dispatches the redirect target when a guard rewrites the click', async () => {
    const routing = connectRouter(hashRouter(), {
      beforeEnter: (to) => (to.page === 'admin' ? ({ page: 'home' } as const) : undefined),
    })
    const send = vi.fn()
    const { anchor, dispose } = mountLink(routing, send, { page: 'admin' })

    click(anchor)

    expect(send).toHaveBeenCalledWith({ type: 'navigate', route: { page: 'home' } })
    expect(location.hash === '' || location.hash === '#/').toBe(true)

    dispose()
    await settle()
  })
})

describe('#110.3 a guard redirect on push()/replace() dispatches', () => {
  beforeEach(() => {
    history.replaceState(null, '', '/')
  })

  it('push(): the URL and the dispatched route agree after a redirect', () => {
    const router = historyRouter()
    const routing = connectRouter(router, {
      beforeEnter: (to) =>
        to.page === 'admin' ? ({ page: 'article', slug: 'x' } as const) : undefined,
    })
    const send = vi.fn()

    run(routing, routing.push({ page: 'admin' }), send)

    expect(location.pathname).toBe('/article/x')
    expect(send).toHaveBeenCalledTimes(1)
    const msg = send.mock.calls[0]![0] as { type: string; route: Route }
    expect(msg).toEqual({ type: 'navigate', route: { page: 'article', slug: 'x' } })
    // The whole point: state.route (driven by this message) and the URL agree.
    expect(router.href(msg.route)).toBe(location.pathname)
  })

  it('replace(): the URL and the dispatched route agree after a redirect', () => {
    const router = historyRouter()
    const routing = connectRouter(router, {
      beforeEnter: (to) =>
        to.page === 'admin' ? ({ page: 'article', slug: 'y' } as const) : undefined,
    })
    const send = vi.fn()

    run(routing, routing.replace({ page: 'admin' }), send)

    expect(location.pathname).toBe('/article/y')
    expect(send).toHaveBeenCalledWith({
      type: 'navigate',
      route: { page: 'article', slug: 'y' },
    })
  })

  it('keeps push()/replace() URL-only when no guard redirects', () => {
    const routing = connectRouter(historyRouter())
    const send = vi.fn()

    run(routing, routing.push({ page: 'admin' }), send)
    run(routing, routing.replace({ page: 'article', slug: 'z' }), send)

    // The documented contract: the caller's reducer already set state.route.
    expect(send).not.toHaveBeenCalled()
  })

  it('stays silent when a guard BLOCKS a push', () => {
    const routing = connectRouter(historyRouter(), { beforeEnter: () => false })
    const send = vi.fn()

    run(routing, routing.push({ page: 'admin' }), send)

    expect(send).not.toHaveBeenCalled()
    expect(location.pathname).toBe('/')
  })

  it('redirects and dispatches in hash mode too', async () => {
    location.hash = ''
    await settle()
    const routing = connectRouter(hashRouter(), {
      beforeEnter: (to) =>
        to.page === 'admin' ? ({ page: 'article', slug: 'q' } as const) : undefined,
    })
    const send = vi.fn()

    run(routing, routing.push({ page: 'admin' }), send)

    expect(location.hash).toBe('#/article/q')
    expect(send).toHaveBeenCalledWith({
      type: 'navigate',
      route: { page: 'article', slug: 'q' },
    })
    await settle()
  })
})
