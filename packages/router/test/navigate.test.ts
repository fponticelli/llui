import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRouter, route, param } from '../src/index'
import { connectRouter } from '../src/connect'

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

  // navigate() dispatches through the `send` the effect runner hands every
  // effect — NOT through a listener-captured closure. So it works from any
  // effect, with or without listener() mounted (the regression this replaced).
  describe('dispatch via the effect runner send', () => {
    it('updates URL via pushState AND dispatches the navigate message', () => {
      const routing = connectRouter(makeRouter())
      const send = vi.fn()
      const pushSpy = vi.spyOn(history, 'pushState')

      routing.handleEffect({
        effect: routing.navigate({ page: 'article', slug: 'x' }),
        send,
        signal: new AbortController().signal,
      })

      expect(pushSpy).toHaveBeenCalledWith(null, '', '/article/x')
      expect(send).toHaveBeenCalledTimes(1)
      expect(send).toHaveBeenCalledWith({
        type: 'navigate',
        route: { page: 'article', slug: 'x' },
      })

      pushSpy.mockRestore()
    })

    it('dispatches even when no listener() is mounted (regression)', () => {
      // Previously navigate() before listener() mount silently dropped the
      // message (URL changed, state.route never updated) and only warned.
      const routing = connectRouter(makeRouter())
      const send = vi.fn()
      const pushSpy = vi.spyOn(history, 'pushState')
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      routing.handleEffect({
        effect: routing.navigate({ page: 'article', slug: 'x' }),
        send,
        signal: new AbortController().signal,
      })

      expect(pushSpy).toHaveBeenCalledWith(null, '', '/article/x')
      expect(send).toHaveBeenCalledWith({
        type: 'navigate',
        route: { page: 'article', slug: 'x' },
      })
      // No warning — there is no listener dependency anymore.
      expect(warnSpy).not.toHaveBeenCalled()

      pushSpy.mockRestore()
      warnSpy.mockRestore()
    })

    it('uses a custom message factory from connectRouter navigateMsg', () => {
      const routing = connectRouter(makeRouter(), {
        navigateMsg: (route) => ({ type: 'Router/RouteChanged', route }),
      })
      const send = vi.fn()

      routing.handleEffect({
        effect: routing.navigate({ page: 'admin' }),
        send,
        signal: new AbortController().signal,
      })

      expect(send).toHaveBeenCalledWith({
        type: 'Router/RouteChanged',
        route: { page: 'admin' },
      })
    })

    it('dispatches the redirect target when a beforeEnter guard rewrites it', () => {
      const routing = connectRouter(makeRouter(), {
        beforeEnter: (to) => {
          if (to.page === 'admin') return { page: 'home' } as const
        },
      })
      const send = vi.fn()
      const pushSpy = vi.spyOn(history, 'pushState')

      routing.handleEffect({
        effect: routing.navigate({ page: 'admin' }),
        send,
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
    })

    it('does not push or dispatch when a guard blocks the navigation', () => {
      const routing = connectRouter(makeRouter(), { beforeEnter: () => false })
      const send = vi.fn()
      const pushSpy = vi.spyOn(history, 'pushState')

      routing.handleEffect({
        effect: routing.navigate({ page: 'admin' }),
        send,
        signal: new AbortController().signal,
      })

      expect(pushSpy).not.toHaveBeenCalled()
      expect(send).not.toHaveBeenCalled()

      pushSpy.mockRestore()
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

      // Hash mode emits #/article/x
      const effect = routing.navigate({ page: 'article', slug: 'x' })
      expect(effect.path).toBe('#/article/x')

      routing.handleEffect({
        effect,
        send,
        signal: new AbortController().signal,
      })

      expect(send).toHaveBeenCalledWith({
        type: 'navigate',
        route: { page: 'article', slug: 'x' },
      })
    })
  })
})
