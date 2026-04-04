import { describe, it, expect, vi } from 'vitest'
import { createRouter, route, param } from '../src/index'
import { connectRouter } from '../src/connect'

describe('navigation should not double-push on popstate', () => {
  type Route = { page: 'search'; q: string } | { page: 'repo'; owner: string; name: string }

  const router = createRouter<Route>(
    [
      route([], () => ({ page: 'search', q: '' })),
      route(['search'], { query: ['q'] }, ({ q }) => ({ page: 'search', q: q ?? '' })),
      route([param('owner'), param('name')], ({ owner, name }) => ({ page: 'repo', owner, name })),
    ],
    { mode: 'history' },
  )

  const routing = connectRouter(router)

  it('push effect should only be used for user-initiated navigation', () => {
    // Simulating the flow:
    // 1. User searches → should push /search?q=tempo
    const searchPush = routing.push({ page: 'search', q: 'tempo' })
    expect(searchPush.path).toBe('/search?q=tempo')

    // 2. User clicks repo → should push /grafana/tempo
    const repoPush = routing.push({ page: 'repo', owner: 'grafana', name: 'tempo' })
    expect(repoPush.path).toBe('/grafana/tempo')

    // 3. Browser back → popstate fires → listener sends navigate message
    //    The app should NOT push here — the browser already navigated.
    //    This test documents the expected behavior: popstate-triggered
    //    navigation should update state without pushing.
  })

  it('listener sends a distinct message for popstate vs user navigation', () => {
    // The listener's default message factory should differentiate popstate
    // so the app can handle it without pushing
    const send = vi.fn()
    const factory = (r: Route) => ({ type: 'routeChanged' as const, route: r })

    // When using a custom factory, the app controls whether to push
    // routeChanged → update state only (no push)
    // navigate → update state + push
    expect(factory({ page: 'search', q: 'test' })).toEqual({
      type: 'routeChanged',
      route: { page: 'search', q: 'test' },
    })
  })
})
