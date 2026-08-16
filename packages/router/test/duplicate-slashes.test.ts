import { describe, expect, it } from 'vitest'
import { createRouter, route } from '../src/index'

describe('duplicate slash normalization', () => {
  const registry = {
    article: route('/article/:slug'),
    files: route('/files/*path'),
  }

  it.each([
    ['hash', '#/article//x'],
    ['hash', '#///article////x//'],
    ['history', '/article//x'],
    ['history', '///article////x//'],
  ] as const)('normalizes %s-mode path runs in %s', (mode, input) => {
    const router = createRouter(registry, { mode })
    expect(router.match(input)).toEqual({ name: 'article', params: { slug: 'x' } })
  })

  it('does not introduce empty rest segments', () => {
    const router = createRouter(registry)
    expect(router.match('#/files//one///two/')).toEqual({
      name: 'files',
      params: { path: ['one', 'two'] },
    })
  })
})
