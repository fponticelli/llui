/** LRU cache for Intl formatter instances (expensive to construct). */
const cache = new Map<string, unknown>()
const MAX_CACHE = 64

export function cached<T>(key: string, create: () => T): T {
  const existing = cache.get(key)
  if (existing) return existing as T
  if (cache.size >= MAX_CACHE) {
    const first = cache.keys().next().value!
    cache.delete(first)
  }
  const instance = create()
  cache.set(key, instance)
  return instance
}

export function cacheKey(prefix: string, locale: string, opts: Record<string, unknown>): string {
  let key = `${prefix}:${locale}`
  for (const k of Object.keys(opts).sort()) {
    const v = opts[k]
    if (v !== undefined) key += `:${k}=${v}`
  }
  return key
}
