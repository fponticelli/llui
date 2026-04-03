import { describe, it, expect } from 'vitest'
import { createRouter, route, param } from '../src/index'

describe('query param preservation in routes with extra fields', () => {
  // Simulates the GitHub Explorer pattern: routes carry a `data` field
  // that varies at runtime but shouldn't affect URL generation
  type Route =
    | { page: 'search'; q: string; data: { type: string } }
    | { page: 'repo'; owner: string; name: string; data: { type: string } }

  const router = createRouter<Route>([
    route([], () => ({ page: 'search', q: '', data: { type: 'idle' } })),
    route(['search'], { query: ['q'] }, ({ q }) => ({ page: 'search', q: q ?? '', data: { type: 'loading' } })),
    route([param('owner'), param('name')], ({ owner, name }) => ({ page: 'repo', owner, name, data: { type: 'loading' } })),
  ], {
    mode: 'history',
    fallback: { page: 'search', q: '', data: { type: 'idle' } },
  })

  it('toPath preserves query params when data field differs', () => {
    // The route being formatted has data: { type: 'loading' } but the
    // round-trip match produces data: { type: 'loading' } too — should match
    const path = router.toPath({ page: 'search', q: 'tempo', data: { type: 'loading' } })
    expect(path).toBe('/search?q=tempo')
  })

  it('toPath produces /search (no q) for empty query', () => {
    const path = router.toPath({ page: 'search', q: '', data: { type: 'idle' } })
    // Empty q should NOT produce ?q= in the URL
    expect(path).toBe('/search')
  })

  it('href includes query for non-empty q', () => {
    const href = router.href({ page: 'search', q: 'tempo', data: { type: 'loading' } })
    expect(href).toBe('/search?q=tempo')
  })

  it('href for empty q produces /search without query param', () => {
    const href = router.href({ page: 'search', q: '', data: { type: 'idle' } })
    expect(href).toBe('/search')
    expect(href).not.toContain('?')
  })

  it('round-trip: match → toPath → match preserves query', () => {
    const paths = ['/search?q=tempo', '/search?q=hello+world', '/grafana/tempo']
    for (const path of paths) {
      const matched = router.match(path)
      const formatted = router.toPath(matched)
      const rematched = router.match(formatted)
      expect(rematched).toEqual(matched)
    }
  })

  it('toPath ignores data field differences in round-trip', () => {
    // Route with data.type = 'success' should still format correctly
    // even though the route builder produces data.type = 'loading'
    const route: Route = { page: 'search', q: 'test', data: { type: 'success' } }
    const path = router.toPath(route)
    // The round-trip won't match because data.type differs
    // But toPath should still produce a valid path
    expect(path).toContain('/search')
    expect(path).toContain('q=test')
  })
})
