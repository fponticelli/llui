import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRouter, route, param } from '../src/index'
import { connectRouter } from '../src/connect'
import { mountApp, component } from '@llui/dom/signals'

type Route = { page: 'home' } | { page: 'article'; slug: string } | { page: 'admin' }

function makeRouter() {
  return createRouter<Route>(
    [
      route([], () => ({ page: 'home' })),
      route(['article', param('slug')], ({ slug }) => ({ page: 'article', slug })),
      route(['admin'], () => ({ page: 'admin' })),
    ],
    { mode: 'history' },
  )
}

/**
 * Mount a component whose view inserts the listener nodes — necessary
 * to fire onMount, which is what stores send/factory in the
 * connectRouter closure. Returns a dispose() to clean up.
 */
function mountListener<M>(
  routing: ReturnType<typeof connectRouter<Route>>,
  send: (msg: M) => void,
  factory?: (route: Route) => M,
) {
  const container = document.createElement('div')
  const App = component<null, { type: 'noop' }, never>({
    name: 'TestShell',
    init: () => [null, []],
    update: (s) => [s, []],
    view: () => routing.listener(send, factory),
  })
  return mountApp(container, App)
}

describe('connectedRouter.navigate', () => {
  beforeEach(() => {
    history.replaceState(null, '', '/')
  })

  describe('effect descriptor', () => {
    it('returns a __router effect tagged with action: navigate', () => {
      const routing = connectRouter(makeRouter())
      expect(routing.navigate({ page: 'article', slug: 'hello' })).toEqual({
        type: '__router',
        action: 'navigate',
        path: '/article/hello',
      })
    })

    it('formats the path through router.href, like push', () => {
      const routing = connectRouter(makeRouter())
      expect(routing.navigate({ page: 'home' }).path).toBe('/')
      expect(routing.push({ page: 'home' }).path).toBe('/')
    })
  })

  describe('with listener mounted', () => {
    it('updates URL via pushState AND dispatches the navigate message', () => {
      const routing = connectRouter(makeRouter())
      const send = vi.fn()
      const handle = mountListener(routing, send)
      const pushSpy = vi.spyOn(history, 'pushState')

      routing.handleEffect({
        effect: routing.navigate({ page: 'article', slug: 'x' }),
        send: vi.fn(),
        signal: new AbortController().signal,
      })

      expect(pushSpy).toHaveBeenCalledWith(null, '', '/article/x')
      expect(send).toHaveBeenCalledTimes(1)
      expect(send).toHaveBeenCalledWith({
        type: 'navigate',
        route: { page: 'article', slug: 'x' },
      })

      pushSpy.mockRestore()
      handle.dispose()
    })

    it('uses a custom message factory when listener was given one', () => {
      const routing = connectRouter(makeRouter())
      const send = vi.fn()
      const handle = mountListener<{ type: 'Router/RouteChanged'; route: Route }>(
        routing,
        send,
        (r) => ({ type: 'Router/RouteChanged', route: r }),
      )

      routing.handleEffect({
        effect: routing.navigate({ page: 'admin' }),
        send: vi.fn(),
        signal: new AbortController().signal,
      })

      expect(send).toHaveBeenCalledWith({
        type: 'Router/RouteChanged',
        route: { page: 'admin' },
      })

      handle.dispose()
    })

    it('dispatches the redirect target when a beforeEnter guard rewrites it', () => {
      const router = makeRouter()
      const routing = connectRouter(router, {
        beforeEnter: (to) => {
          if (to.page === 'admin') return { page: 'home' } as const
        },
      })
      const send = vi.fn()
      const handle = mountListener(routing, send)
      const pushSpy = vi.spyOn(history, 'pushState')

      routing.handleEffect({
        effect: routing.navigate({ page: 'admin' }),
        send: vi.fn(),
        signal: new AbortController().signal,
      })

      // URL goes to /, the redirect target — not /admin
      expect(pushSpy).toHaveBeenCalledWith(null, '', '/')
      // Message reflects the redirect target, not the requested route
      expect(send).toHaveBeenCalledWith({
        type: 'navigate',
        route: { page: 'home' },
      })

      pushSpy.mockRestore()
      handle.dispose()
    })

    it('does not push or dispatch when a guard blocks the navigation', () => {
      const router = makeRouter()
      const routing = connectRouter(router, { beforeEnter: () => false })
      const send = vi.fn()
      const handle = mountListener(routing, send)
      const pushSpy = vi.spyOn(history, 'pushState')

      routing.handleEffect({
        effect: routing.navigate({ page: 'admin' }),
        send: vi.fn(),
        signal: new AbortController().signal,
      })

      expect(pushSpy).not.toHaveBeenCalled()
      expect(send).not.toHaveBeenCalled()

      pushSpy.mockRestore()
      handle.dispose()
    })
  })

  describe('without listener mounted', () => {
    it('still updates the URL but logs a console.warn and does not dispatch', () => {
      const routing = connectRouter(makeRouter())
      const pushSpy = vi.spyOn(history, 'pushState')
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      routing.handleEffect({
        effect: routing.navigate({ page: 'article', slug: 'x' }),
        send: vi.fn(),
        signal: new AbortController().signal,
      })

      expect(pushSpy).toHaveBeenCalledWith(null, '', '/article/x')
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy.mock.calls[0][0]).toContain('listener() is not mounted')

      pushSpy.mockRestore()
      warnSpy.mockRestore()
    })

    it('warns again after the listener has been disposed', () => {
      const routing = connectRouter(makeRouter())
      const send = vi.fn()
      const handle = mountListener(routing, send)
      handle.dispose()

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      routing.handleEffect({
        effect: routing.navigate({ page: 'home' }),
        send: vi.fn(),
        signal: new AbortController().signal,
      })

      expect(send).not.toHaveBeenCalled()
      expect(warnSpy).toHaveBeenCalledTimes(1)
      warnSpy.mockRestore()
    })
  })

  describe('hash mode', () => {
    it('updates location.hash and dispatches the navigate message', () => {
      const hashRouter = createRouter<Route>([
        route([], () => ({ page: 'home' })),
        route(['article', param('slug')], ({ slug }) => ({ page: 'article', slug })),
        route(['admin'], () => ({ page: 'admin' })),
      ])
      const routing = connectRouter(hashRouter)
      const send = vi.fn()
      const handle = mountListener(routing, send)

      // Hash mode emits #/article/x
      const effect = routing.navigate({ page: 'article', slug: 'x' })
      expect(effect.path).toBe('#/article/x')

      routing.handleEffect({
        effect,
        send: vi.fn(),
        signal: new AbortController().signal,
      })

      // location.hash setter fires hashchange, but the synchronous
      // dispatch from navigate is what we care about here — the
      // listener's hashchange path is covered by other tests.
      expect(send).toHaveBeenCalledWith({
        type: 'navigate',
        route: { page: 'article', slug: 'x' },
      })

      handle.dispose()
    })
  })
})
