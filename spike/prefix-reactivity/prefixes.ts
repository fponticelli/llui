// Simulates the compiler's prefix hoisting: each unique path is converted
// into a stable closure that the compiler would emit at module scope.
// Bindings reference these by identity, so reference-equality is the
// correct dedup primitive (matching how the real compiler would hoist
// per source location).
//
// Path syntax: dot-separated keys, optional `?` to mark the optional pivot.
//   pathPrefix('query')                  → (s) => s.query
//   pathPrefix('auth.user')              → (s) => s.auth.user
//   pathPrefix('auth.user.email')        → (s) => s.auth.user?.email
//                                          (compiler picks the deepest stable point)
//
// For the spike we keep it simple: the path string is the cache key. Each
// distinct path string returns a single shared closure.

import type { AppState } from './state.js'

const cache = new Map<string, (s: AppState) => unknown>()

export function pathPrefix(path: string): (s: AppState) => unknown {
  const cached = cache.get(path)
  if (cached) return cached
  const segments = path.split('.')
  const fn = (s: AppState): unknown => {
    let cur: unknown = s
    for (let i = 0; i < segments.length; i++) {
      if (cur === null || cur === undefined) return cur
      cur = (cur as Record<string, unknown>)[segments[i]!]
    }
    return cur
  }
  cache.set(path, fn)
  return fn
}
