export type GetStateArgs = { path?: string }
export type GetStateResult = { state: unknown }
export type GetStateHost = { getState(): unknown }

/**
 * Spec §8.2: get_state returns a JSON-pointer-scoped slice of the
 * app's current state, or the whole root state if no path is given.
 */
export function handleGetState(host: GetStateHost, args: GetStateArgs): GetStateResult {
  const state = host.getState()
  if (!args.path) return { state }
  return { state: resolveJsonPointer(state, args.path) }
}

function resolveJsonPointer(root: unknown, pointer: string): unknown {
  if (pointer === '' || pointer === '/') return root
  // Accept either "/a/b" or "a/b"
  const parts = pointer.split('/').filter((p) => p !== '')
  let cur: unknown = root
  for (const raw of parts) {
    // RFC 6901 escaping: ~1 → /, ~0 → ~
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~')
    if (cur === null || cur === undefined) return undefined
    if (Array.isArray(cur)) {
      const idx = Number(key)
      if (!Number.isInteger(idx)) return undefined
      cur = cur[idx]
    } else if (typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[key]
    } else {
      return undefined
    }
  }
  return cur
}
