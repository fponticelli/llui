import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRouter, route, param } from '../src/index'
import { connectRouter } from '../src/connect'
import { mountApp, component, text } from '@llui/dom'

type Route = { page: 'home' } | { page: 'article'; slug: string } | { page: 'search'; q: string }

const router = createRouter<Route>([
  route([], () => ({ page: 'home' })),
  route(['article', param('slug')], ({ slug }) => ({ page: 'article', slug })),
  route(['search'], { query: ['q'] }, ({ q }) => ({ page: 'search', q: q ?? '' })),
])

describe('connectRouter', () => {
  const routing = connectRouter(router)

  describe('push / replace / back / forward', () => {
    it('push returns a router effect with the formatted path', () => {
      const effect = routing.push({ page: 'article', slug: 'hello' })
      expect(effect).toEqual({
        type: '__router',
        action: 'push',
        path: '#/article/hello',
      })
    })

    it('replace returns a router effect', () => {
      const effect = routing.replace({ page: 'home' })
      expect(effect).toEqual({
        type: '__router',
        action: 'replace',
        path: '#/',
      })
    })

    it('back returns a back effect', () => {
      expect(routing.back()).toEqual({ type: '__router', action: 'back' })
    })

    it('forward returns a forward effect', () => {
      expect(routing.forward()).toEqual({ type: '__router', action: 'forward' })
    })

    it('scroll returns a scroll effect', () => {
      expect(routing.scroll(0, 100)).toEqual({ type: '__router', action: 'scroll', x: 0, y: 100 })
    })
  })

  describe('handleEffect', () => {
    it('returns true for router effects', () => {
      const effect = { type: '__router', action: 'scroll', x: 0, y: 0 } as { type: string }
      const result = routing.handleEffect(effect, vi.fn(), new AbortController().signal)
      expect(result).toBe(true)
    })

    it('returns false for non-router effects', () => {
      const effect = { type: 'http' } as { type: string }
      const result = routing.handleEffect(effect, vi.fn(), new AbortController().signal)
      expect(result).toBe(false)
    })
  })

  describe('createHandler', () => {
    it('handles navigate messages and returns new state + effects', () => {
      type State = { route: Route; count: number }
      type Msg = { type: 'navigate'; route: Route } | { type: 'inc' }
      type Effect = { type: '__router'; action: string; path?: string }

      const handler = routing.createHandler<State, Msg, Effect>({
        getRoute: (msg) => (msg as { route: Route }).route,
        onNavigate: (state, route) => [{ ...state, route }, [routing.push(route)]],
      })

      const state: State = { route: { page: 'home' }, count: 0 }

      // Handles navigate
      const result = handler(state, { type: 'navigate', route: { page: 'article', slug: 'x' } })
      expect(result).not.toBeNull()
      expect(result![0].route).toEqual({ page: 'article', slug: 'x' })
      expect(result![1]).toHaveLength(1)

      // Ignores non-navigate
      expect(handler(state, { type: 'inc' })).toBeNull()
    })

    it('applies guard to redirect', () => {
      type State = { route: Route; loggedIn: boolean }
      type Msg = { type: 'navigate'; route: Route }

      const handler = routing.createHandler<State, Msg, never>({
        getRoute: (msg) => msg.route,
        guard: (route, state) => {
          if (route.page === 'article' && !state.loggedIn) return { page: 'home' }
          return route
        },
        onNavigate: (state, route) => [{ ...state, route }, []],
      })

      const state: State = { route: { page: 'home' }, loggedIn: false }
      const result = handler(state, { type: 'navigate', route: { page: 'article', slug: 'x' } })
      expect(result![0].route).toEqual({ page: 'home' }) // redirected
    })
  })

  describe('link', () => {
    /** Run callback inside a mounted component's view to get a render context */
    function withView(fn: () => void) {
      const container = document.createElement('div')
      const App = component({
        name: 'T',
        init: () => [null, []],
        update: (s) => [s, []],
        view: () => {
          fn()
          return [text('')]
        },
      })
      const handle = mountApp(container, App)
      handle.dispose()
    }

    it('renders an anchor with the correct href', () => {
      withView(() => {
        const el = routing.link(
          vi.fn(),
          { page: 'article', slug: 'hello' },
          { class: 'my-link' },
          [],
        )
        expect(el.tagName).toBe('A')
        expect(el.getAttribute('href')).toBe('#/article/hello')
        expect(el.className).toBe('my-link')
      })
    })

    it('prevents default on click', () => {
      withView(() => {
        const send = vi.fn()
        const el = routing.link(send, { page: 'article', slug: 'test' }, {}, [])
        const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
        el.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(true)
        // In hash mode, location.hash is set and the hashchange listener
        // handles sending the navigate message — send is not called directly
      })
    })

    it('sends navigate message on click in history mode', () => {
      withView(() => {
        const historyRouter = createRouter<Route>(
          [
            route([], () => ({ page: 'home' })),
            route(['article', param('slug')], ({ slug }) => ({ page: 'article', slug })),
          ],
          { mode: 'history' },
        )
        const historyRouting = connectRouter(historyRouter)
        const send = vi.fn()
        const el = historyRouting.link(send, { page: 'article', slug: 'test' }, {}, [])
        const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
        el.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(true)
        expect(send).toHaveBeenCalledWith({
          type: 'navigate',
          route: { page: 'article', slug: 'test' },
        })
      })
    })

    it('does not intercept ctrl+click', () => {
      withView(() => {
        const send = vi.fn()
        const el = routing.link(send, { page: 'home' }, {}, [])
        const event = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          button: 0,
          ctrlKey: true,
        })
        el.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(false)
        expect(send).not.toHaveBeenCalled()
      })
    })

    it('does not intercept meta+click', () => {
      withView(() => {
        const send = vi.fn()
        const el = routing.link(send, { page: 'home' }, {}, [])
        const event = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          button: 0,
          metaKey: true,
        })
        el.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(false)
        expect(send).not.toHaveBeenCalled()
      })
    })

    it('uses custom message factory in history mode', () => {
      withView(() => {
        const historyRouter = createRouter<Route>(
          [
            route([], () => ({ page: 'home' })),
            route(['article', param('slug')], ({ slug }) => ({ page: 'article', slug })),
          ],
          { mode: 'history' },
        )
        const historyRouting = connectRouter(historyRouter)
        const send = vi.fn()
        const el = historyRouting.link(send, { page: 'article', slug: 'x' }, {}, [], (r) => ({
          type: 'goto',
          route: r,
        }))
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
        expect(send).toHaveBeenCalledWith({ type: 'goto', route: { page: 'article', slug: 'x' } })
      })
    })
  })

  describe('history mode', () => {
    it('generates clean paths without hash prefix', () => {
      const historyRouter = createRouter<Route>(
        [
          route([], () => ({ page: 'home' })),
          route(['article', param('slug')], ({ slug }) => ({ page: 'article', slug })),
          route(['search'], { query: ['q'] }, ({ q }) => ({ page: 'search', q: q ?? '' })),
        ],
        { mode: 'history' },
      )
      const historyRouting = connectRouter(historyRouter)

      expect(historyRouting.push({ page: 'article', slug: 'x' }).path).toBe('/article/x')
    })

    it('link href uses clean paths', () => {
      const historyRouter = createRouter<Route>(
        [
          route([], () => ({ page: 'home' })),
          route(['search'], { query: ['q'] }, ({ q }) => ({ page: 'search', q: q ?? '' })),
        ],
        { mode: 'history' },
      )
      const historyRouting = connectRouter(historyRouter)

      const container = document.createElement('div')
      let href = ''
      const App = component({
        name: 'T',
        init: () => [null, []],
        update: (s) => [s, []],
        view: () => {
          const el = historyRouting.link(vi.fn(), { page: 'search', q: 'test' }, {}, [])
          href = el.getAttribute('href') ?? ''
          return [el]
        },
      })
      const handle = mountApp(container, App)
      expect(href).toBe('/search?q=test')
      handle.dispose()
    })
  })
})
