/** LRU cache for Intl formatter instances (expensive to construct). */
const cache = new Map<string, unknown>()
const MAX_CACHE = 64

export function cached<T>(key: string, create: () => T): T {
  const existing = cache.get(key)
  if (existing !== undefined) {
    cache.delete(key)
    cache.set(key, existing)
    return existing as T
  }
  if (cache.size >= MAX_CACHE) {
    const first = cache.keys().next().value!
    cache.delete(first)
  }
  const instance = create()
  cache.set(key, instance)
  return instance
}

/** A cache key for a formatter built from `opts` (any `Intl.*Options` object):
 * its defined entries in key order, so equal options give equal keys whatever
 * order they were written in. */
export function cacheKey(prefix: string, locale: string, opts: object): string {
  const entries: Array<[string, unknown]> = Object.entries(opts)
  let key = `${prefix}:${locale}`
  for (const [k, v] of entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (v !== undefined) key += `:${k}=${String(v)}`
  }
  return key
}
