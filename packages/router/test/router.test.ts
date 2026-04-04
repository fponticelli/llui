import { describe, it, expect } from 'vitest'
import { createRouter, route, param, rest } from '../src/index'

type Route =
  | { page: 'home' }
  | { page: 'login' }
  | { page: 'article'; slug: string }
  | { page: 'editor'; slug?: string }
  | { page: 'profile'; username: string; tab: 'authored' | 'favorited' }
  | { page: 'search'; q: string }
  | { page: 'docs'; path: string }

const router = createRouter<Route>([
  route([], () => ({ page: 'home' })),
  route(['login'], () => ({ page: 'login' })),
  route(['article', param('slug')], ({ slug }) => ({ page: 'article', slug })),
  route(['editor'], () => ({ page: 'editor' })),
  route(['editor', param('slug')], ({ slug }) => ({ page: 'editor', slug })),
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
  route(['search'], { query: ['q'] }, ({ q }) => ({ page: 'search', q: q ?? '' })),
  route(['docs', rest('path')], ({ path }) => ({ page: 'docs', path })),
])

describe('match', () => {
  it('matches root path', () => {
    expect(router.match('#/')).toEqual({ page: 'home' })
    expect(router.match('#')).toEqual({ page: 'home' })
    expect(router.match('')).toEqual({ page: 'home' })
  })

  it('matches static segments', () => {
    expect(router.match('#/login')).toEqual({ page: 'login' })
  })

  it('matches param segments', () => {
    expect(router.match('#/article/hello-world')).toEqual({ page: 'article', slug: 'hello-world' })
  })

  it('matches optional param by trying longer pattern', () => {
    expect(router.match('#/editor')).toEqual({ page: 'editor' })
    expect(router.match('#/editor/my-post')).toEqual({ page: 'editor', slug: 'my-post' })
  })

  it('matches multi-segment paths with shared prefix', () => {
    expect(router.match('#/profile/bob')).toEqual({
      page: 'profile',
      username: 'bob',
      tab: 'authored',
    })
    expect(router.match('#/profile/bob/favorites')).toEqual({
      page: 'profile',
      username: 'bob',
      tab: 'favorited',
    })
  })

  it('matches rest segments', () => {
    expect(router.match('#/docs/getting-started/install')).toEqual({
      page: 'docs',
      path: 'getting-started/install',
    })
    expect(router.match('#/docs/api')).toEqual({ page: 'docs', path: 'api' })
  })

  it('falls back for unknown routes', () => {
    expect(router.match('#/nonexistent')).toEqual({ page: 'home' })
  })

  it('decodes URI components', () => {
    expect(router.match('#/article/hello%20world')).toEqual({
      page: 'article',
      slug: 'hello world',
    })
  })
})

describe('toPath', () => {
  it('formats root route', () => {
    expect(router.toPath({ page: 'home' })).toBe('/')
  })

  it('formats static routes', () => {
    expect(router.toPath({ page: 'login' })).toBe('/login')
  })

  it('formats param routes', () => {
    expect(router.toPath({ page: 'article', slug: 'hello' })).toBe('/article/hello')
  })

  it('formats routes with shared prefix using round-trip', () => {
    expect(router.toPath({ page: 'profile', username: 'bob', tab: 'authored' })).toBe(
      '/profile/bob',
    )
    expect(router.toPath({ page: 'profile', username: 'bob', tab: 'favorited' })).toBe(
      '/profile/bob/favorites',
    )
  })

  it('formats rest routes', () => {
    expect(router.toPath({ page: 'docs', path: 'getting-started/install' })).toBe(
      '/docs/getting-started/install',
    )
  })

  it('formats editor without slug', () => {
    expect(router.toPath({ page: 'editor' })).toBe('/editor')
  })

  it('formats editor with slug', () => {
    expect(router.toPath({ page: 'editor', slug: 'my-post' })).toBe('/editor/my-post')
  })
})

describe('href', () => {
  it('adds hash prefix in hash mode', () => {
    expect(router.href({ page: 'article', slug: 'x' })).toBe('#/article/x')
  })

  it('adds hash prefix for root', () => {
    expect(router.href({ page: 'home' })).toBe('#/')
  })
})

describe('history mode', () => {
  it('matches without hash prefix', () => {
    const r = createRouter<Route>(
      [
        route([], () => ({ page: 'home' })),
        route(['article', param('slug')], ({ slug }) => ({ page: 'article', slug })),
      ],
      { mode: 'history' },
    )

    expect(r.match('/article/hello')).toEqual({ page: 'article', slug: 'hello' })
    expect(r.href({ page: 'article', slug: 'x' })).toBe('/article/x')
  })
})

describe('query params', () => {
  it('parses query params for routes that declare them', () => {
    expect(router.match('#/search?q=hello')).toEqual({ page: 'search', q: 'hello' })
  })

  it('defaults missing query params', () => {
    expect(router.match('#/search')).toEqual({ page: 'search', q: '' })
  })

  it('formats query params in toPath', () => {
    expect(router.toPath({ page: 'search', q: 'hello' })).toBe('/search?q=hello')
  })

  it('omits empty query params', () => {
    expect(router.toPath({ page: 'search', q: '' })).toBe('/search')
  })
})

describe('round-trip', () => {
  it('match → toPath → match is identity for all routes', () => {
    const paths = [
      '#/',
      '#/login',
      '#/article/hello',
      '#/editor',
      '#/editor/post-1',
      '#/profile/alice',
      '#/profile/alice/favorites',
      '#/docs/api/reference',
      '#/search?q=test',
    ]

    for (const path of paths) {
      const matched = router.match(path)
      const formatted = router.toPath(matched)
      const rematched = router.match('#' + formatted)
      expect(rematched).toEqual(matched)
    }
  })
})
