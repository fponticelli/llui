import { describe, it, expect, vi } from 'vitest'
import { createRouter, route, param } from '../src/index'
import { connectRouter } from '../src/connect'

type Route = { page: 'home' } | { page: 'admin' } | { page: 'login' } | { page: 'article'; slug: string }

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
  it('no guards configured — navigation works as before (backwards compat)', () => {
    const router = makeRouter()
    const routing = connectRouter(router)

    const pushSpy = vi.spyOn(history, 'pushState')
    routing.handleEffect({
      effect: routing.push({ page: 'admin' }),
      send: vi.fn(),
      signal: new AbortController().signal,
    })
    expect(pushSpy).toHaveBeenCalledWith(null, '', '/admin')
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
      expect(beforeEnter).toHaveBeenCalledWith({ page: 'admin' }, null)
      expect(pushSpy).toHaveBeenCalledWith(null, '', '/admin')
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
        },
      })

      const pushSpy = vi.spyOn(history, 'pushState')
      routing.handleEffect({
        effect: routing.push({ page: 'admin' }),
        send: vi.fn(),
        signal: new AbortController().signal,
      })
      expect(pushSpy).toHaveBeenCalledWith(null, '', '/login')
      pushSpy.mockRestore()
    })
  })

  describe('beforeLeave', () => {
    it('blocks navigation when returning false', () => {
      const router = makeRouter()
      const routing = connectRouter(router, {
        beforeLeave: () => false,
      })

      // First navigation succeeds (no current route to leave)
      const pushSpy = vi.spyOn(history, 'pushState')
      routing.handleEffect({
        effect: routing.push({ page: 'home' }),
        send: vi.fn(),
        signal: new AbortController().signal,
      })
      expect(pushSpy).toHaveBeenCalledWith(null, '', '/')

      // Second navigation blocked by beforeLeave
      pushSpy.mockClear()
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
      expect(pushSpy).toHaveBeenCalledWith(null, '', '/admin')
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
          if (to.page === 'admin') return { page: 'login' }
        },
      })

      const replaceSpy = vi.spyOn(history, 'replaceState')
      routing.handleEffect({
        effect: routing.replace({ page: 'admin' }),
        send: vi.fn(),
        signal: new AbortController().signal,
      })
      expect(replaceSpy).toHaveBeenCalledWith(null, '', '/login')
      replaceSpy.mockRestore()
    })
  })

  describe('currentRoute tracking', () => {
    it('beforeEnter receives the previous route as from', () => {
      const router = makeRouter()
      const beforeEnter = vi.fn()
      const routing = connectRouter(router, { beforeEnter })

      const pushSpy = vi.spyOn(history, 'pushState')

      // First navigation: from is null
      routing.handleEffect({
        effect: routing.push({ page: 'home' }),
        send: vi.fn(),
        signal: new AbortController().signal,
      })
      expect(beforeEnter).toHaveBeenCalledWith({ page: 'home' }, null)

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
