/**
 * Resolve a JSON-Pointer-shaped path against the current state and
 * return just that slice. Saves bandwidth on `observe` for complex
 * apps where the agent only needs to check a single field.
 *
 * Path syntax (RFC 6901):
 *   `''`            → the whole state (escape hatch; same as get_state)
 *   `'/auth/user'`  → state.auth.user
 *   `'/items/0/id'` → state.items[0].id
 *   `'/key~1with~1slash'` → state['key/with/slash']
 *   `'/key~0tilde'`       → state['key~tilde']
 *
 * Returns `{ value: unknown, found: true }` on hit, `{ found: false,
 * detail: string }` on miss. The miss is non-fatal: the agent might
 * be polling an optional field that isn't present yet, and a soft
 * miss lets it observe the absence directly rather than catching a
 * thrown error.
 */

export type QueryStateHost = {
  getState(): unknown
}

export type QueryStateResult = { found: true; value: unknown } | { found: false; detail: string }

export function handleQueryState(host: QueryStateHost, args: { path: string }): QueryStateResult {
  return resolvePath(host.getState(), args.path)
}

/**
 * Walk the path from `root` segment by segment. Empty path returns
 * root unchanged (RFC 6901's "whole document" reference). Each
 * segment is unescaped before the lookup; the unescape order matters
 * (`~1` first, then `~0`) to avoid double-decoding.
 */
function resolvePath(root: unknown, path: string): QueryStateResult {
  if (path === '') return { found: true, value: root }
  if (!path.startsWith('/')) {
    return { found: false, detail: `path must be empty or start with '/' (got: ${quote(path)})` }
  }

  // Split on '/' but skip the leading slash. Hand-rolled to avoid
  // edge cases with empty segments (path "//foo" is valid in RFC
  // 6901 — references the empty string key).
  const rawSegments = path.slice(1).split('/')

  let cur: unknown = root
  for (let i = 0; i < rawSegments.length; i++) {
    const segment = unescapeSegment(rawSegments[i]!)
    if (cur === null || cur === undefined) {
      return {
        found: false,
        detail: `path "${path}" walks through ${cur === null ? 'null' : 'undefined'} at segment ${i} (${quote(segment)})`,
      }
    }
    if (Array.isArray(cur)) {
      const idx = Number(segment)
      if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) {
        return {
          found: false,
          detail: `path "${path}" — array at segment ${i} has length ${cur.length}, can't index by ${quote(segment)}`,
        }
      }
      cur = cur[idx]
      continue
    }
    if (typeof cur !== 'object') {
      return {
        found: false,
        detail: `path "${path}" walks through non-object (${typeof cur}) at segment ${i} (${quote(segment)})`,
      }
    }
    const obj = cur as Record<string, unknown>
    if (!(segment in obj)) {
      return {
        found: false,
        detail: `path "${path}" — key ${quote(segment)} not present at segment ${i}`,
      }
    }
    cur = obj[segment]
  }
  return { found: true, value: cur }
}

/** Inverse of state-diff's `escapeSegment`: `~1` → `/`, `~0` → `~`. */
function unescapeSegment(seg: string): string {
  return seg.replace(/~1/g, '/').replace(/~0/g, '~')
}

function quote(s: string): string {
  return JSON.stringify(s)
}
