import { beforeEach, describe, expect, it, vi } from 'vitest'
import { connectRouter, type ConnectedRouter, type RouterEffect } from '../src/connect'
import { createRouter, route, type RouteLocation } from '../src/index'

const registry = {
  home: route('/'),
  article: route('/article/:slug'),
  admin: route('/admin'),
}

type Registry = typeof registry
type Location = RouteLocation<Registry>

function makeRouter(mode: 'hash' | 'history' = 'history') {
  return createRouter(registry, { mode })
}

function run<NavigateMessage, UnmatchedMessage>(
  routing: ConnectedRouter<Registry, NavigateMessage, UnmatchedMessage>,
  effect: RouterEffect,
  send = vi.fn(),
) {
  routing.handleEffect({ effect, send, signal: new AbortController().signal })
  return send
}

describe('connectedRouter.navigate', () => {
  beforeEach(() => {
    history.replaceState(null, '', '/')
  })

  describe('effect descriptor', () => {
    it('returns a normalized named location and a generated path', () => {
      const routing = connectRouter(makeRouter())

      expect(routing.navigate('article', { slug: 'hello' })).toEqual({
        type: '__router',
        action: 'navigate',
        path: '/article/hello',
        location: { name: 'article', params: { slug: 'hello' } },
      })
    })

    it('formats through the same registry route as push', () => {
      const routing = connectRouter(makeRouter())

      expect(routing.navigate('home').path).toBe('/')
      expect(routing.push('home').path).toBe('/')
    })
  })

  describe('dispatch via the effect runner send', () => {
    it('updates the URL via pushState and dispatches the named location', () => {
      const routing = connectRouter(makeRouter())
      const pushSpy = vi.spyOn(history, 'pushState')
      const send = run(routing, routing.navigate('article', { slug: 'x' }))

      expect(pushSpy).toHaveBeenCalledWith(expect.any(Object), '', '/article/x')
      expect(send).toHaveBeenCalledOnce()
      expect(send).toHaveBeenCalledWith({
        type: 'navigate',
        location: { name: 'article', params: { slug: 'x' } },
      })

      pushSpy.mockRestore()
    })

    it('does not depend on listener() being mounted', () => {
      const routing = connectRouter(makeRouter())
      const pushSpy = vi.spyOn(history, 'pushState')
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const send = run(routing, routing.navigate('article', { slug: 'x' }))

      expect(pushSpy).toHaveBeenCalledWith(expect.any(Object), '', '/article/x')
      expect(send).toHaveBeenCalledWith({
        type: 'navigate',
        location: { name: 'article', params: { slug: 'x' } },
      })
      expect(warnSpy).not.toHaveBeenCalled()

      pushSpy.mockRestore()
      warnSpy.mockRestore()
    })

    it('uses a custom message factory', () => {
      const routing = connectRouter(makeRouter(), {
        navigateMsg: (location) => ({ type: 'Router/LocationChanged', location }),
      })
      const send = run(routing, routing.navigate('admin'))

      expect(send).toHaveBeenCalledWith({
        type: 'Router/LocationChanged',
        location: { name: 'admin', params: {} },
      })
    })

    it('dispatches the redirect target when beforeEnter rewrites it', () => {
      const router = makeRouter()
      const routing = connectRouter(router, {
        beforeEnter: (to) => (to.name === 'admin' ? router.location('home') : undefined),
      })
      const pushSpy = vi.spyOn(history, 'pushState')
      const send = run(routing, routing.navigate('admin'))

      expect(pushSpy).toHaveBeenCalledWith(expect.any(Object), '', '/')
      expect(send).toHaveBeenCalledWith({
        type: 'navigate',
        location: { name: 'home', params: {} },
      })

      pushSpy.mockRestore()
    })

    it('does not push or dispatch when a guard blocks', () => {
      const routing = connectRouter(makeRouter(), { beforeEnter: () => false })
      const pushSpy = vi.spyOn(history, 'pushState')
      const send = run(routing, routing.navigate('admin'))

      expect(pushSpy).not.toHaveBeenCalled()
      expect(send).not.toHaveBeenCalled()

      pushSpy.mockRestore()
    })

    it('passes the exact normalized location to guards and dispatch', () => {
      const seen: Location[] = []
      const routing = connectRouter(makeRouter(), {
        beforeEnter: (to) => {
          seen.push(to)
        },
      })
      const send = run(routing, routing.navigate('article', { slug: 'x' }))

      expect(seen).toEqual([{ name: 'article', params: { slug: 'x' } }])
      expect(send).toHaveBeenCalledWith({
        type: 'navigate',
        location: { name: 'article', params: { slug: 'x' } },
      })
    })

    it('makes navigation to the current canonical location a full no-op', () => {
      history.replaceState(null, '', '/admin')
      const beforeEnter = vi.fn()
      const routing = connectRouter(makeRouter(), { beforeEnter })
      const pushSpy = vi.spyOn(history, 'pushState')
      const send = run(routing, routing.navigate('admin'))

      expect(beforeEnter).not.toHaveBeenCalled()
      expect(pushSpy).not.toHaveBeenCalled()
      expect(send).not.toHaveBeenCalled()

      pushSpy.mockRestore()
    })
  })

  describe('hash mode', () => {
    it('updates location.hash and dispatches the named location', () => {
      const routing = connectRouter(makeRouter('hash'))
      const effect = routing.navigate('article', { slug: 'x' })

      expect(effect.path).toBe('#/article/x')
      const send = run(routing, effect)

      expect(location.hash).toBe('#/article/x')
      expect(send).toHaveBeenCalledWith({
        type: 'navigate',
        location: { name: 'article', params: { slug: 'x' } },
      })
    })
  })
})
