import { describe, expect, it, vi } from 'vitest'
import { cached } from '../../src/format/cache'

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
