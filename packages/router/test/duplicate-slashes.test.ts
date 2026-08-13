import { describe, it, expect } from 'vitest'
import { createRouter, route, param, rest } from '../src/index'

// Issue #111 (residual 1) — `matchPathname` stripped only LEADING and TRAILING
// runs of slashes (`/^\/+|\/+$/g`), so an internal run survived as an empty
// path segment that matches no def. A hand-typed or concatenated URL therefore
// resolved to the fallback with no error anywhere:
//
//   #/article/x   → { page: 'article', slug: 'x' }
//   #/article//x  → { page: 'home' }

type Route = { page: 'home' } | { page: 'article'; slug: string } | { page: 'docs'; path: string }

function makeRouter(mode: 'hash' | 'history') {
  return createRouter<Route>(
    [
      route([], () => ({ page: 'home' })),
      route(['article', param('slug')], ({ slug }) => ({ page: 'article', slug })),
      route(['docs', rest('path')], ({ path }) => ({ page: 'docs', path })),
    ],
    { mode, fallback: { page: 'home' } },
  )
}

describe('internal duplicate slashes are collapsed before matching', () => {
  it('hash mode: #/article//x matches the same route as #/article/x', () => {
    const router = makeRouter('hash')
    expect(router.match('#/article/x')).toEqual({ page: 'article', slug: 'x' })
    expect(router.match('#/article//x')).toEqual({ page: 'article', slug: 'x' })
  })

  it('history mode: /article//x matches the same route as /article/x', () => {
    const router = makeRouter('history')
    expect(router.match('/article//x')).toEqual({ page: 'article', slug: 'x' })
  })

  it('collapses a run of more than two', () => {
    expect(makeRouter('history').match('/article///x')).toEqual({ page: 'article', slug: 'x' })
  })

  it('collapses inside a rest segment rather than emitting an empty part', () => {
    // Without collapsing, `rest` joins the empty segment back in as `a//b`.
    expect(makeRouter('history').match('/docs/a//b')).toEqual({ page: 'docs', path: 'a/b' })
  })

  it('keeps leading/trailing runs harmless, as before', () => {
    const router = makeRouter('history')
    expect(router.match('//article/x//')).toEqual({ page: 'article', slug: 'x' })
    expect(router.match('//')).toEqual({ page: 'home' })
  })

  it('leaves the query string alone', () => {
    const router = createRouter<{ page: 'search'; q: string } | { page: 'home' }>(
      [
        route([], () => ({ page: 'home' })),
        route(['search'], { query: ['q'] }, ({ q }) => ({ page: 'search', q: q ?? '' })),
      ],
      { mode: 'history', fallback: { page: 'home' } },
    )
    expect(router.match('//search?q=a//b')).toEqual({ page: 'search', q: 'a//b' })
  })
})
