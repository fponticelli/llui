// ── Path Segment Types ───────────────────────────────────────────

interface ParamSegment {
  __kind: 'param'
  name: string
}

interface RestSegment {
  __kind: 'rest'
  name: string
}

export type Segment = string | ParamSegment | RestSegment

/** Named path parameter: matches one segment */
export function param(name: string): ParamSegment {
  return { __kind: 'param', name }
}

/** Rest parameter: matches remaining segments */
export function rest(name: string): RestSegment {
  return { __kind: 'rest', name }
}

// ── Route Definition ─────────────────────────────────────────────

interface RouteDefOptions {
  query?: string[]
}

export interface RouteDef<R> {
  segments: Segment[]
  build: (params: Record<string, string>) => R
  queryKeys: string[]
  /** Optional manual toPath override */
  toPath?: (route: R) => string
}

/**
 * Define a route with structured path segments.
 *
 * @example
 * route(['article', param('slug')], ({ slug }) => ({ page: 'article', slug }))
 * route(['search'], { query: ['q'] }, ({ q }) => ({ page: 'search', q: q ?? '' }))
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function route<R = any>(
  segments: Segment[],
  buildOrOpts: ((params: Record<string, string>) => R) | RouteDefOptions,
  buildOrToPath?: ((params: Record<string, string>) => R) | { toPath: (route: R) => string },
): RouteDef<R> {
  if (typeof buildOrOpts === 'function') {
    const tp = buildOrToPath && typeof buildOrToPath === 'object' ? buildOrToPath.toPath : undefined
    return { segments, build: buildOrOpts, queryKeys: [], toPath: tp }
  }
  const opts = buildOrOpts
  const build = buildOrToPath as (params: Record<string, string>) => R
  return { segments, build, queryKeys: opts.query ?? [] }
}

// ── Router ───────────────────────────────────────────────────────

export interface RouterConfig<R> {
  mode?: 'hash' | 'history'
  fallback?: R
}

export interface Router<R> {
  /** Match a pathname to a Route. Returns fallback if no match. */
  match(pathname: string): R
  /** Format a Route back to a pathname (without hash/history prefix). */
  toPath(route: R): string
  /** Format a Route to a full href (with # prefix in hash mode). */
  href(route: R): string
  /** The configured mode */
  mode: 'hash' | 'history'
  /** All route definitions (for iteration) */
  routes: ReadonlyArray<RouteDef<R>>
  /** The fallback route */
  fallback: R
}

export function createRouter<R>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  defs: RouteDef<any>[],
  config?: RouterConfig<R>,
): Router<R> {
  const mode = config?.mode ?? 'hash'
  const fallback = config?.fallback ?? defs[0]!.build({})

  function matchPathname(pathname: string): R {
    // Separate path from query string
    let queryParams: Record<string, string> = {}
    const qIdx = pathname.indexOf('?')
    const rawPath = qIdx !== -1 ? pathname.slice(0, qIdx) : pathname
    if (qIdx !== -1) {
      queryParams = parseQuery(pathname.slice(qIdx + 1))
    }

    const path = rawPath.replace(/^\/+|\/+$/g, '')
    const pathSegments = path === '' ? [] : path.split('/')

    // Try each route definition
    for (const def of defs) {
      const params = matchDef(def, pathSegments)
      if (params !== null) {
        // Merge query params
        for (const key of def.queryKeys) {
          if (queryParams[key] !== undefined) params[key] = queryParams[key]
        }
        return def.build(params)
      }
    }

    return fallback
  }

  function formatPath(r: R): string {
    // Try each route definition in reverse order (most specific first)
    for (let i = defs.length - 1; i >= 0; i--) {
      const def = defs[i]!

      // If route has a manual toPath, use it
      if (def.toPath) return def.toPath(r)

      // Try to extract params from the Route and build the path
      const path = tryFormat(def, r)
      if (path !== null) {
        // Round-trip check: parse the formatted path and verify URL-relevant
        // fields match. Ignore extra fields (like runtime `data`) that aren't
        // part of the URL — they would break the comparison since the route
        // builder produces default values that differ from the actual state.
        const roundTrip = matchPathname(path)
        const urlKeys = getUrlKeys(def)
        if (partialEqual(roundTrip as Record<string, unknown>, r as Record<string, unknown>, urlKeys)) return path
      }
    }

    // Last resort: try forward order
    for (const def of defs) {
      if (def.toPath) return def.toPath(r)
      const path = tryFormat(def, r)
      if (path !== null) return path
    }

    return '/'
  }

  return {
    match(input: string) {
      // Strip hash prefix
      const pathname = mode === 'hash'
        ? input.replace(/^#\/?/, '/')
        : input.split('?')[0]!
      return matchPathname(pathname)
    },
    toPath: formatPath,
    href(r: R) {
      const path = formatPath(r)
      return mode === 'hash' ? `#${path}` : path
    },
    mode,
    routes: defs,
    fallback,
  }
}

// ── Matching ─────────────────────────────────────────────────────

function matchDef<R>(
  def: RouteDef<R>,
  pathSegments: string[],
): Record<string, string> | null {
  const params: Record<string, string> = {}
  let si = 0

  for (let di = 0; di < def.segments.length; di++) {
    const seg = def.segments[di]!

    if (typeof seg === 'string') {
      if (si >= pathSegments.length || pathSegments[si] !== seg) return null
      si++
    } else if (seg.__kind === 'param') {
      if (si >= pathSegments.length) return null
      params[seg.name] = decodeURIComponent(pathSegments[si]!)
      si++
    } else if (seg.__kind === 'rest') {
      params[seg.name] = pathSegments.slice(si).map(decodeURIComponent).join('/')
      si = pathSegments.length
    }
  }

  // All path segments must be consumed
  if (si !== pathSegments.length) return null

  return params
}

function tryFormat<R>(def: RouteDef<R>, r: R): string | null {
  const routeObj = r as Record<string, unknown>
  const parts: string[] = []

  for (const seg of def.segments) {
    if (typeof seg === 'string') {
      parts.push(seg)
    } else if (seg.__kind === 'param') {
      const value = routeObj[seg.name]
      if (value === undefined || value === null) return null
      parts.push(encodeURIComponent(String(value)))
    } else if (seg.__kind === 'rest') {
      const value = routeObj[seg.name]
      if (value === undefined || value === null) return null
      parts.push(String(value))
    }
  }

  let path = '/' + parts.join('/')

  // Append query params if defined
  if (def.queryKeys.length > 0) {
    const qParts: string[] = []
    for (const key of def.queryKeys) {
      const value = routeObj[key]
      if (value !== undefined && value !== null && value !== '') {
        qParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      }
    }
    if (qParts.length > 0) path += '?' + qParts.join('&')
  }

  return path
}

// ── Utilities ────────────────────────────────────────────────────

function parseQuery(qs: string): Record<string, string> {
  const params: Record<string, string> = {}
  for (const pair of qs.split('&')) {
    const [key, val] = pair.split('=')
    if (key) params[decodeURIComponent(key)] = decodeURIComponent(val ?? '')
  }
  return params
}

/** Extract URL-relevant field names from a route definition */
function getUrlKeys<R>(def: RouteDef<R>): Set<string> {
  const keys = new Set<string>()
  for (const seg of def.segments) {
    if (typeof seg === 'string') continue
    keys.add(seg.name)
  }
  for (const key of def.queryKeys) {
    keys.add(key)
  }
  // Also include 'page' / 'tab' or any fixed field from the builder
  // by running the builder with empty params and collecting its keys
  const sample = def.build({}) as Record<string, unknown>
  for (const key of Object.keys(sample)) {
    // Include all keys from the builder EXCEPT those with object/array values
    // (which are likely runtime state like `data`)
    const val = sample[key]
    if (val === null || val === undefined || typeof val !== 'object') {
      keys.add(key)
    }
  }
  return keys
}

/** Compare two objects only on the specified keys */
function partialEqual(a: Record<string, unknown>, b: Record<string, unknown>, keys: Set<string>): boolean {
  for (const key of keys) {
    if (!deepEqual(a[key], b[key])) return false
  }
  return true
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  const ka = Object.keys(a as Record<string, unknown>)
  const kb = Object.keys(b as Record<string, unknown>)
  if (ka.length !== kb.length) return false
  for (const key of ka) {
    if (!deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false
  }
  return true
}
