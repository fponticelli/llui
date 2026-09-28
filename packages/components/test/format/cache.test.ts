import { describe, expect, it, vi } from 'vitest'
import { cacheKey, cached } from '../../src/format/cache'

describe('Intl formatter cache', () => {
  it('promotes a hit so the least recently used entry is evicted', () => {
    const create = vi.fn((key: number) => ({ key }))
    const entries = Array.from({ length: 64 }, (_, key) => cached(`lru-${key}`, () => create(key)))

    expect(cached('lru-0', () => create(0))).toBe(entries[0])
    cached('lru-64', () => create(64))

    expect(cached('lru-0', () => create(0))).toBe(entries[0])
    expect(cached('lru-1', () => create(1))).not.toBe(entries[1])
  })
})

describe('cacheKey', () => {
  it('keys an Intl options object by its defined entries, independent of order', () => {
    const a: Intl.DateTimeFormatOptions = { month: 'long', year: 'numeric', day: undefined }
    const b: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long' }
    expect(cacheKey('date', 'en', a)).toBe('date:en:month=long:year=numeric')
    expect(cacheKey('date', 'en', b)).toBe(cacheKey('date', 'en', a))
    expect(cacheKey('date', 'en', { ...b, hour12: false })).toBe(
      'date:en:hour12=false:month=long:year=numeric',
    )
  })
})
