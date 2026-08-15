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

  describe('#161 a guard redirect CHAINS to a fixed point, at every call site', () => {
    // `beforeEnter` is re-asked about each target it returns until it accepts
    // one, blocks one, or stops moving the URL. `admin → login → home` therefore
    // rests on `home`, and the URL and the dispatched route agree on it (#143's
    // property, now on the settled route rather than the first hop).
    //
    // The loop lives inside `runGuards`, so every call site gets it: the three
    // effects below, `link()` (`link-guards.test.ts`) and the browser-driven
    // listener (`redirect-url-sync.test.ts`).
    const chain = () => {
      const seen: Route[] = []
      const routing = connectRouter(makeRouter(), {
        beforeEnter: (to) => {
          seen.push(to)
          if (to.page === 'admin') return { page: 'login' } as const
          if (to.page === 'login') return { page: 'home' } as const
          return undefined
        },
      })
      return { routing, seen }
    }

    it('push() settles on the fixed point', () => {
      const { routing, seen } = chain()
      const send = vi.fn()
      routing.handleEffect({
        effect: routing.push({ page: 'admin' }),
        send,
        signal: new AbortController().signal,
      })
      // Every hop is offered, and the ACCEPTING call is included — the loop ends
      // when the guard returns nullish for `home`, not when it stops moving.
      expect(seen).toEqual([{ page: 'admin' }, { page: 'login' }, { page: 'home' }])
      expect(location.pathname).toBe('/')
      expect(send).toHaveBeenCalledWith({ type: 'navigate', route: { page: 'home' } })
    })

    it('replace() settles on the fixed point', () => {
      const { routing, seen } = chain()
      routing.handleEffect({
        effect: routing.replace({ page: 'admin' }),
        send: vi.fn(),
        signal: new AbortController().signal,
      })
      expect(seen).toEqual([{ page: 'admin' }, { page: 'login' }, { page: 'home' }])
      expect(location.pathname).toBe('/')
    })

    it('navigate() settles on the fixed point', () => {
      const { routing, seen } = chain()
      const send = vi.fn()
      routing.handleEffect({
        effect: routing.navigate({ page: 'admin' }),
        send,
        signal: new AbortController().signal,
      })
      expect(seen).toEqual([{ page: 'admin' }, { page: 'login' }, { page: 'home' }])
      expect(location.pathname).toBe('/')
      expect(send).toHaveBeenCalledWith({ type: 'navigate', route: { page: 'home' } })
    })

    it('a hop that BLOCKS blocks the whole navigation, mid-chain', () => {
      // `false` from any hop refuses the navigation outright — it does not rest
      // on the last allowed hop. The app stays where it was, which is the same
      // thing a first-hop block has always meant.
      const seen: Route[] = []
      const send = vi.fn()
      const routing = connectRouter(makeRouter(), {
        beforeEnter: (to) => {
          seen.push(to)
          if (to.page === 'admin') return { page: 'login' } as const
          if (to.page === 'login') return false
          return undefined
        },
      })
      const pushSpy = vi.spyOn(history, 'pushState')
      routing.handleEffect({
        effect: routing.navigate({ page: 'admin' }),
        send,
        signal: new AbortController().signal,
      })
      expect(seen).toEqual([{ page: 'admin' }, { page: 'login' }])
      expect(pushSpy).not.toHaveBeenCalled()
      expect(send).not.toHaveBeenCalled()
      expect(location.pathname).toBe('/')
      pushSpy.mockRestore()
    })

    it('an IDEMPOTENT guard settles on hop one, and its object is the one adopted', () => {
      // The shape #162 is about: a guard that normalises `to` and hands back an
      // equivalent route. The settle test is `router.href`, so the second hop
      // addresses the URL the first already did and the loop stops — but the
      // route DISPATCHED is the object the guard returned, and `redirected` is
      // true for it (which is what makes the same-URL short-circuit downstream
      // the thing that suppresses the write).
      const seen: Route[] = []
      let dispatched: Route | undefined
      const send = vi.fn((msg: unknown) => {
        dispatched = (msg as { route: Route }).route
      })
      const normalised = { page: 'admin' } as const
      const routing = connectRouter(makeRouter(), {
        beforeEnter: (to) => {
          seen.push(to)
          return to.page === 'admin' ? normalised : undefined
        },
      })
      routing.handleEffect({
        effect: routing.navigate({ page: 'admin' }),
        send,
        signal: new AbortController().signal,
      })
      // Asked ONCE. A guard whose output does not move the URL is not re-asked,
      // so an idempotent guard costs exactly what it cost single-hop.
      expect(seen).toEqual([{ page: 'admin' }])
      expect(send).toHaveBeenCalledTimes(1)
      // The guard's OWN object, not the one it was asked about.
      expect(dispatched).toBe(normalised)
      expect(location.pathname).toBe('/admin')
    })

    it('a CYCLE stops at the hop cap, lands on the last hop and warns — it does not block', () => {
      // `admin ⇄ login` never settles. The cap is what terminates it; the policy
      // on exhaustion is to LAND (#161 named blocking as the alternative). A
      // blocked navigation would leave the app stuck with no route change at
      // all; landing keeps it usable and the warning names the cause.
      const seen: Route[] = []
      const send = vi.fn()
      let warned = ''
      const warn = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
        warned = String(args[0])
      })
      const routing = connectRouter(makeRouter(), {
        beforeEnter: (to) => {
          seen.push(to)
          if (to.page === 'admin') return { page: 'login' } as const
          if (to.page === 'login') return { page: 'admin' } as const
          return undefined
        },
      })
      routing.handleEffect({
        effect: routing.navigate({ page: 'admin' }),
        send,
        signal: new AbortController().signal,
      })
      // Ten hops taken means ten questions asked; the cap is checked after the
      // hop, so the guard is not asked an eleventh time about the route it
      // lands on. Even hop count on a two-cycle → back on `admin`.
      expect(seen).toHaveLength(10)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warned).toContain('redirected 10 times without settling')
      // Landed, not refused: a route was dispatched and the URL written.
      expect(send).toHaveBeenCalledTimes(1)
      expect(send).toHaveBeenCalledWith({ type: 'navigate', route: { page: 'admin' } })
      expect(location.pathname).toBe('/admin')
      warn.mockRestore()
    })

    it('`beforeLeave` is asked ONCE, before the chain, about the REQUESTED route', () => {
      // It is the unsaved-changes prompt: one navigation must produce one
      // prompt however many hops resolve it. It is also asked FIRST, so a
      // refused leave runs no `beforeEnter` at all.
      const left: Array<[Route, Route]> = []
      const routing = connectRouter(makeRouter(), {
        beforeLeave: (from, to) => {
          left.push([from, to])
          return true
        },
        beforeEnter: (to) => {
          if (to.page === 'admin') return { page: 'login' } as const
          if (to.page === 'login') return { page: 'home' } as const
          return undefined
        },
      })
      routing.handleEffect({
        effect: routing.navigate({ page: 'admin' }),
        send: vi.fn(),
        signal: new AbortController().signal,
      })
      expect(left).toEqual([[{ page: 'home' }, { page: 'admin' }]])
    })

    it('`from` is the route being left, on EVERY hop', () => {
      // No hop is ENTERED — they are proposals — so where the navigation is
      // coming from does not change as the chain resolves.
      const froms: Array<Route | null> = []
      const routing = connectRouter(makeRouter(), {
        beforeEnter: (to, from) => {
          froms.push(from)
          if (to.page === 'admin') return { page: 'login' } as const
          if (to.page === 'login') return { page: 'article', slug: 'x' } as const
          return undefined
        },
      })
      routing.handleEffect({
        effect: routing.navigate({ page: 'admin' }),
        send: vi.fn(),
        signal: new AbortController().signal,
      })
      expect(froms).toEqual([{ page: 'home' }, { page: 'home' }, { page: 'home' }])
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
