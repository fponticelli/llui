import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRouter, route, param } from '../src/index'
import type { Router } from '../src/index'
import { connectRouter } from '../src/connect'

type Route =
  | { page: 'home' }
  | { page: 'admin' }
  | { page: 'login' }
  | { page: 'article'; slug: string }

function makeRouter() {
  return createRouter<Route>(
    [
      route([], () => ({ page: 'home' })),
      route(['admin'], () => ({ page: 'admin' })),
      route(['login'], () => ({ page: 'login' })),
      route(['article', param('slug')], ({ slug }) => ({ page: 'article', slug })),
    ],
    { mode: 'history' },
  )
}

describe('router guards', () => {
  // connectRouter now seeds currentRoute from the current location, so pin the
  // location to '/' → seeded route is { page: 'home' } deterministically.
  beforeEach(() => {
    history.replaceState(null, '', '/')
  })

  it('no guards configured — navigation works as before (backwards compat)', () => {
    const router = makeRouter()
    const routing = connectRouter(router)

    const pushSpy = vi.spyOn(history, 'pushState')
    routing.handleEffect({
      effect: routing.push({ page: 'admin' }),
      send: vi.fn(),
      signal: new AbortController().signal,
    })
    expect(pushSpy).toHaveBeenCalledWith(expect.any(Object), '', '/admin')
    pushSpy.mockRestore()
  })

  describe('beforeEnter', () => {
    it('allows navigation when returning void', () => {
      const router = makeRouter()
      const beforeEnter = vi.fn()
      const routing = connectRouter(router, { beforeEnter })

      const pushSpy = vi.spyOn(history, 'pushState')
      routing.handleEffect({
        effect: routing.push({ page: 'admin' }),
        send: vi.fn(),
        signal: new AbortController().signal,
      })
      // currentRoute is seeded from the current location (/), so `from` is home.
      expect(beforeEnter).toHaveBeenCalledWith({ page: 'admin' }, { page: 'home' })
      expect(pushSpy).toHaveBeenCalledWith(expect.any(Object), '', '/admin')
      pushSpy.mockRestore()
    })

    it('blocks navigation when returning false', () => {
      const router = makeRouter()
      const routing = connectRouter(router, {
        beforeEnter: () => false,
      })

      const pushSpy = vi.spyOn(history, 'pushState')
      routing.handleEffect({
        effect: routing.push({ page: 'admin' }),
        send: vi.fn(),
        signal: new AbortController().signal,
      })
      expect(pushSpy).not.toHaveBeenCalled()
      pushSpy.mockRestore()
    })

    it('redirects when returning a different route', () => {
      const router = makeRouter()
      const routing = connectRouter(router, {
        beforeEnter: (to) => {
          if (to.page === 'admin') return { page: 'login' as const }
          return undefined
        },
      })

      const pushSpy = vi.spyOn(history, 'pushState')
      routing.handleEffect({
        effect: routing.push({ page: 'admin' }),
        send: vi.fn(),
        signal: new AbortController().signal,
      })
      expect(pushSpy).toHaveBeenCalledWith(expect.any(Object), '', '/login')
      pushSpy.mockRestore()
    })
  })

  describe('beforeEnter with primitive routes', () => {
    // Regression: a redirect was previously only honored when the returned
    // route was `typeof === 'object'`, so a primitive (string/number) route
    // redirect was silently dropped and navigation proceeded to the original
    // target — an auth-guard bypass for any non-object Route type.
    function makeStringRouter(): Router<string> {
      const toPath = (r: string) => (r === 'home' ? '/' : `/${r}`)
      return {
        match: (input) => input.replace(/^\/+/, '') || 'home',
        toPath,
        href: toPath,
        mode: 'history',
        base: '',
        routes: [],
        fallback: 'home',
      }
    }

    it('redirects when a string route is returned', () => {
      const routing = connectRouter<string>(makeStringRouter(), {
        beforeEnter: (to) => (to === 'admin' ? 'login' : undefined),
      })

      const pushSpy = vi.spyOn(history, 'pushState')
      routing.handleEffect({
        effect: routing.push('admin'),
        send: vi.fn(),
        signal: new AbortController().signal,
      })
      // Must land on the redirect target, NOT the original /admin.
      expect(pushSpy).toHaveBeenCalledWith(expect.any(Object), '', '/login')
      pushSpy.mockRestore()
    })

    it('allows navigation when the guard returns undefined', () => {
      const routing = connectRouter<string>(makeStringRouter(), {
        beforeEnter: () => undefined,
      })

      const pushSpy = vi.spyOn(history, 'pushState')
      routing.handleEffect({
        effect: routing.push('admin'),
        send: vi.fn(),
        signal: new AbortController().signal,
      })
      expect(pushSpy).toHaveBeenCalledWith(expect.any(Object), '', '/admin')
      pushSpy.mockRestore()
    })
  })

  describe('beforeLeave', () => {
    it('blocks navigation when returning false', () => {
      const router = makeRouter()
      const routing = connectRouter(router, {
        beforeLeave: () => false,
      })

      // currentRoute is seeded from the location (home), so beforeLeave now
      // fires from the very first navigation and blocks it.
      const pushSpy = vi.spyOn(history, 'pushState')
      routing.handleEffect({
        effect: routing.push({ page: 'admin' }),
        send: vi.fn(),
        signal: new AbortController().signal,
      })
      expect(pushSpy).not.toHaveBeenCalled()
      pushSpy.mockRestore()
    })

    it('allows navigation when returning true', () => {
      const router = makeRouter()
      const routing = connectRouter(router, {
        beforeLeave: () => true,
      })

      const pushSpy = vi.spyOn(history, 'pushState')
      // Navigate to home first
      routing.handleEffect({
        effect: routing.push({ page: 'home' }),
        send: vi.fn(),
        signal: new AbortController().signal,
      })
      // Navigate away — should be allowed
      pushSpy.mockClear()
      routing.handleEffect({
        effect: routing.push({ page: 'admin' }),
        send: vi.fn(),
        signal: new AbortController().signal,
      })
      expect(pushSpy).toHaveBeenCalledWith(expect.any(Object), '', '/admin')
      pushSpy.mockRestore()
    })
  })

  describe('guard composition', () => {
    it('beforeLeave blocks before beforeEnter runs', () => {
      const router = makeRouter()
      const beforeEnter = vi.fn()
      const routing = connectRouter(router, {
        beforeLeave: () => false,
        beforeEnter,
      })

      const pushSpy = vi.spyOn(history, 'pushState')
      // First nav — no current route, so beforeLeave is skipped
      routing.handleEffect({
        effect: routing.push({ page: 'home' }),
        send: vi.fn(),
        signal: new AbortController().signal,
      })
      beforeEnter.mockClear()

      // Second nav — beforeLeave blocks, beforeEnter never called
      pushSpy.mockClear()
      routing.handleEffect({
        effect: routing.push({ page: 'admin' }),
        send: vi.fn(),
        signal: new AbortController().signal,
      })
      expect(pushSpy).not.toHaveBeenCalled()
      expect(beforeEnter).not.toHaveBeenCalled()
      pushSpy.mockRestore()
    })

    it('beforeLeave allows but beforeEnter blocks', () => {
      const router = makeRouter()
      const routing = connectRouter(router, {
        beforeLeave: () => true,
        beforeEnter: (to) => {
          if (to.page === 'admin') return false
          return undefined
        },
      })

      const pushSpy = vi.spyOn(history, 'pushState')
      routing.handleEffect({
        effect: routing.push({ page: 'home' }),
        send: vi.fn(),
        signal: new AbortController().signal,
      })
      pushSpy.mockClear()

      routing.handleEffect({
        effect: routing.push({ page: 'admin' }),
        send: vi.fn(),
        signal: new AbortController().signal,
      })
      expect(pushSpy).not.toHaveBeenCalled()
      pushSpy.mockRestore()
    })
  })

  describe('replace effect with guards', () => {
    it('beforeEnter redirect works with replace', () => {
      const router = makeRouter()
      const routing = connectRouter(router, {
        beforeEnter: (to) => {
          if (to.page === 'admin') return { page: 'login' } as const
          return undefined
        },
      })

      const replaceSpy = vi.spyOn(history, 'replaceState')
      routing.handleEffect({
        effect: routing.replace({ page: 'admin' }),
        send: vi.fn(),
        signal: new AbortController().signal,
      })
      expect(replaceSpy).toHaveBeenCalledWith(expect.any(Object), '', '/login')
      replaceSpy.mockRestore()
    })
  })

  describe('currentRoute tracking', () => {
    it('beforeEnter receives the previous route as from', () => {
      const router = makeRouter()
      const beforeEnter = vi.fn()
      const routing = connectRouter(router, { beforeEnter })

      const pushSpy = vi.spyOn(history, 'pushState')

      // First navigation: from is the seeded route (home, from location /)
      routing.handleEffect({
        effect: routing.push({ page: 'home' }),
        send: vi.fn(),
        signal: new AbortController().signal,
      })
      expect(beforeEnter).toHaveBeenCalledWith({ page: 'home' }, { page: 'home' })

      // Second navigation: from is home
      routing.handleEffect({
        effect: routing.push({ page: 'admin' }),
        send: vi.fn(),
        signal: new AbortController().signal,
      })
      expect(beforeEnter).toHaveBeenCalledWith({ page: 'admin' }, { page: 'home' })

      pushSpy.mockRestore()
    })

    it('beforeLeave receives current and target routes', () => {
      const router = makeRouter()
      const beforeLeave = vi.fn().mockReturnValue(true)
      const routing = connectRouter(router, { beforeLeave })

      const pushSpy = vi.spyOn(history, 'pushState')

      // Navigate to home
      routing.handleEffect({
        effect: routing.push({ page: 'home' }),
        send: vi.fn(),
        signal: new AbortController().signal,
      })

      // Navigate to admin — beforeLeave called with (home, admin)
      routing.handleEffect({
        effect: routing.push({ page: 'admin' }),
        send: vi.fn(),
        signal: new AbortController().signal,
      })
      expect(beforeLeave).toHaveBeenCalledWith({ page: 'home' }, { page: 'admin' })

      pushSpy.mockRestore()
    })
  })
})
