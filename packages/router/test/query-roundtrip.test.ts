import { describe, expect, it } from 'vitest'
import { createRouter, route, routeCodec, type StandardSchemaV1 } from '../src/index'

const textSchema: StandardSchemaV1<string> = {
  '~standard': {
    version: 1,
    vendor: 'query-fixture',
    validate: (value) =>
      typeof value === 'string' ? { value } : { issues: [{ message: 'Expected text' }] },
  },
}

describe('named query round-trip', () => {
  const router = createRouter(
    {
      search: route('/search', {
        query: { q: routeCodec(textSchema, String) },
        defaults: { q: '' },
      }),
    },
    { mode: 'history' },
  )

  it('preserves a non-empty query through match, path generation, and rematch', () => {
    const location = router.match('/search?q=a%2Fb%3Fc%3Dd+e')
    expect(location).toEqual({ name: 'search', params: { q: 'a/b?c=d e' } })
    expect(router.toPath('search', { q: 'a/b?c=d e' })).toBe('/search?q=a%2Fb%3Fc%3Dd+e')
    expect(router.match(router.toPath('search', { q: 'a/b?c=d e' }))).toEqual(location)
  })

  it('normalizes the default to a complete location and omits it from the URL', () => {
    expect(router.match('/search')).toEqual({ name: 'search', params: { q: '' } })
    expect(router.toPath('search', {})).toBe('/search')
    expect(router.href('search', { q: '' })).toBe('/search')
  })
})
