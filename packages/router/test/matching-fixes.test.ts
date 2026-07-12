import { describe, it, expect } from 'vitest'
import { createRouter, route, param, rest } from '../src/index'

describe('malformed URL decode (finding 3)', () => {
  type Route = { page: 'article'; slug: string } | { page: 'home' }
  const router = createRouter<Route>(
    [
      route([], () => ({ page: 'home' })),
      route(['article', param('slug')], ({ slug }) => ({ page: 'article', slug })),
    ],
    { mode: 'history' },
  )

  it('does not throw on a malformed percent-escape — falls back to the raw segment', () => {
    // decodeURIComponent('100%') throws URIError; the router must not crash.
    expect(() => router.match('/article/100%')).not.toThrow()
    expect(router.match('/article/100%')).toEqual({ page: 'article', slug: '100%' })
  })

  it('decodes well-formed escapes normally', () => {
    expect(router.match('/article/hello%20world')).toEqual({
      page: 'article',
      slug: 'hello world',
    })
  })

  it('malformed escape in a rest segment does not throw', () => {
    const r = createRouter<{ page: 'docs'; path: string }>(
      [route(['docs', rest('path')], ({ path }) => ({ page: 'docs', path }))],
      { mode: 'history' },
    )
    expect(() => r.match('/docs/a/b%')).not.toThrow()
    expect(r.match('/docs/a/b%')).toEqual({ page: 'docs', path: 'a/b%' })
  })
})

describe('query parsing via URLSearchParams (finding 3)', () => {
  type Route = { page: 'search'; token: string; q: string }
  const router = createRouter<Route>(
    [
      route(['search'], { query: ['token', 'q'] }, ({ token, q }) => ({
        page: 'search',
        token: token ?? '',
        q: q ?? '',
      })),
    ],
    { mode: 'history' },
  )

  it('keeps `=` inside a value (does not truncate on the first =)', () => {
    expect(router.match('/search?token=a=b=c')).toMatchObject({ token: 'a=b=c' })
  })

  it('decodes `+` as a space in values', () => {
    expect(router.match('/search?q=hello+world')).toMatchObject({ q: 'hello world' })
  })

  it('decodes percent-encoded values', () => {
    expect(router.match('/search?q=a%26b')).toMatchObject({ q: 'a&b' })
  })

  it('last value wins on duplicate keys', () => {
    expect(router.match('/search?q=first&q=second')).toMatchObject({ q: 'second' })
  })

  it('round-trips a value containing reserved characters', () => {
    const path = router.toPath({ page: 'search', token: 'a=b', q: 'x y' })
    expect(router.match(path)).toMatchObject({ token: 'a=b', q: 'x y' })
  })
})

describe('base path support (finding 4)', () => {
  type Route = { page: 'home' } | { page: 'article'; slug: string } | { page: 'search'; q: string }

  const router = createRouter<Route>(
    [
      route([], () => ({ page: 'home' })),
      route(['article', param('slug')], ({ slug }) => ({ page: 'article', slug })),
      route(['search'], { query: ['q'] }, ({ q }) => ({ page: 'search', q: q ?? '' })),
    ],
    { mode: 'history', base: '/app/' },
  )

  it('normalizes the trailing slash off the base', () => {
    expect(router.base).toBe('/app')
  })

  it('strips the base before matching', () => {
    expect(router.match('/app/article/hello')).toEqual({ page: 'article', slug: 'hello' })
    expect(router.match('/app/')).toEqual({ page: 'home' })
    expect(router.match('/app')).toEqual({ page: 'home' })
  })

  it('strips the base while preserving the query string', () => {
    expect(router.match('/app/search?q=tempo')).toMatchObject({ page: 'search', q: 'tempo' })
  })

  it('a pathname outside the base resolves to the fallback', () => {
    // '/other/...' is not under '/app' → fallback (first route: home).
    expect(router.match('/other/article/x')).toEqual({ page: 'home' })
    // '/application' is not '/app' + '/' — must not false-match the prefix.
    expect(router.match('/application')).toEqual({ page: 'home' })
  })

  it('prepends the base in toPath and href', () => {
    expect(router.toPath({ page: 'article', slug: 'x' })).toBe('/app/article/x')
    expect(router.href({ page: 'article', slug: 'x' })).toBe('/app/article/x')
    expect(router.toPath({ page: 'home' })).toBe('/app/')
    expect(router.toPath({ page: 'search', q: 'a b' })).toBe('/app/search?q=a+b')
  })

  it('round-trips under a base', () => {
    for (const r of [
      { page: 'home' } as Route,
      { page: 'article', slug: 'x' } as Route,
      { page: 'search', q: 'hi there' } as Route,
    ]) {
      expect(router.match(router.toPath(r))).toEqual(r)
    }
  })

  it('empty / missing base behaves as no base', () => {
    const noBase = createRouter<Route>([route([], () => ({ page: 'home' }))], { mode: 'history' })
    expect(noBase.base).toBe('')
    expect(noBase.toPath({ page: 'home' })).toBe('/')
  })
})

describe('rest segment encoding (finding 5)', () => {
  type Route = { page: 'docs'; path: string }
  const router = createRouter<Route>(
    [route(['docs', rest('path')], ({ path }) => ({ page: 'docs', path }))],
    { mode: 'history' },
  )

  it('encodes reserved characters within each rest segment but keeps the slashes', () => {
    const path = router.toPath({ page: 'docs', path: 'a b/c?d/e' })
    expect(path).toBe('/docs/a%20b/c%3Fd/e')
    // And it round-trips.
    expect(router.match(path)).toEqual({ page: 'docs', path: 'a b/c?d/e' })
  })

  it('round-trips a rest value with an encoded space', () => {
    const r: Route = { page: 'docs', path: 'get started/intro' }
    expect(router.match(router.toPath(r))).toEqual(r)
  })
})

describe('toPath without round-trip guessing (finding 6)', () => {
  it('formats a route whose builder reads params — no build({}) crash', () => {
    // This builder throws if params are absent — the old getUrlKeys ran
    // build({}) per format and would crash here.
    type Route = { page: 'user'; id: string; upper: string }
    const router = createRouter<Route>(
      [
        route(['user', param('id')], ({ id }) => ({
          page: 'user',
          id,
          upper: id!.toUpperCase(),
        })),
      ],
      { mode: 'history' },
    )
    expect(() => router.toPath({ page: 'user', id: 'ab', upper: 'AB' })).not.toThrow()
    expect(router.toPath({ page: 'user', id: 'ab', upper: 'AB' })).toBe('/user/ab')
  })

  it('disambiguates shared-prefix routes by their fixed discriminant field', () => {
    type Route = { page: 'profile'; username: string; tab: 'authored' | 'favorited' }
    const router = createRouter<Route>(
      [
        route(['profile', param('username')], ({ username }) => ({
          page: 'profile',
          username,
          tab: 'authored',
        })),
        route(['profile', param('username'), 'favorites'], ({ username }) => ({
          page: 'profile',
          username,
          tab: 'favorited',
        })),
      ],
      { mode: 'history' },
    )
    expect(router.toPath({ page: 'profile', username: 'bob', tab: 'authored' })).toBe(
      '/profile/bob',
    )
    expect(router.toPath({ page: 'profile', username: 'bob', tab: 'favorited' })).toBe(
      '/profile/bob/favorites',
    )
  })

  it('ignores non-URL object fields (e.g. runtime data) when selecting a def', () => {
    type Route = { page: 'search'; q: string; data: { type: string } }
    const router = createRouter<Route>(
      [
        route(['search'], { query: ['q'] }, ({ q }) => ({
          page: 'search',
          q: q ?? '',
          data: { type: 'loading' },
        })),
      ],
      { mode: 'history' },
    )
    expect(router.toPath({ page: 'search', q: 'x', data: { type: 'success' } })).toBe('/search?q=x')
  })

  it('picks the most specific def by param count (optional trailing param)', () => {
    type Route = { page: 'editor'; slug?: string }
    const router = createRouter<Route>(
      [
        route(['editor'], () => ({ page: 'editor' })),
        route(['editor', param('slug')], ({ slug }) => ({ page: 'editor', slug })),
      ],
      { mode: 'history' },
    )
    expect(router.toPath({ page: 'editor' })).toBe('/editor')
    expect(router.toPath({ page: 'editor', slug: 'my-post' })).toBe('/editor/my-post')
  })
})
