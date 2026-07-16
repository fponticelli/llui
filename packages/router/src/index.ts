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
  /**
   * Base path (history mode only). All matched pathnames must start with it —
   * a non-matching prefix resolves to `fallback`. `toPath`/`href` prepend it.
   * Trailing slashes are normalized away, e.g. `'/app/'` → `'/app'`.
   */
  base?: string
}

export interface Router<R> {
  /** Match a pathname to a Route. Returns fallback if no match. */
  match(pathname: string): R
  /** Format a Route back to a pathname (base prefixed in history mode, no hash prefix). */
  toPath(route: R): string
  /** Format a Route to a full href (# prefix in hash mode, base prefix in history mode). */
  href(route: R): string
  /** The configured mode */
  mode: 'hash' | 'history'
  /** The normalized base path (empty string when none) */
  base: string
  /** All route definitions (for iteration) */
  routes: ReadonlyArray<RouteDef<R>>
  /** The fallback route */
  fallback: R
}

// Non-enumerable tag attached to routes produced by `match`, carrying the
// RouteDef that built them. `toPath`/`href` read it for a direct O(segments)
// format with no round-trip and no per-format `build()` call. Non-enumerable
// so it never shows up in JSON, equality checks, or object spreads.
const ROUTE_DEF = Symbol('llui.routeDef')

/** Primitive fixed fields a builder emits for a def, keyed by field name. */
interface DefMeta<R> {
  def: RouteDef<R>
  /** param + rest segment names — all must be present on a route to select this def */
  paramKeys: string[]
  /**
   * The builder's primitive, non-param, non-query output fields (e.g. `page`,
   * `tab`) computed ONCE at createRouter with sample params. `null` when the
   * builder threw on sample params (selection then falls back to params only).
   */
  fixed: Record<string, string | number | boolean> | null
}

export function createRouter<R>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  defs: RouteDef<any>[],
  config?: RouterConfig<R>,
): Router<R> {
  const mode = config?.mode ?? 'hash'
  const base = normalizeBase(config?.base)

  function tagRoute(r: R, def: RouteDef<R>): R {
    if (r !== null && typeof r === 'object') {
      Object.defineProperty(r as object, ROUTE_DEF, {
        value: def,
        enumerable: false,
        configurable: true,
        writable: true,
      })
    }
    return r
  }

  function getTag(r: R): RouteDef<R> | undefined {
    if (r !== null && typeof r === 'object') {
      return (r as Record<symbol, unknown>)[ROUTE_DEF] as RouteDef<R> | undefined
    }
    return undefined
  }

  /** Placeholder params covering every path/query key a builder may read. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function sampleParamsFor(def: RouteDef<any>): Record<string, string> {
    const params: Record<string, string> = {}
    for (const seg of def.segments) {
      if (typeof seg !== 'string') params[seg.name] = '1'
    }
    for (const key of def.queryKeys) params[key] = '1'
    return params
  }

  // With no routes there is nothing to derive a fallback from — require an
  // explicit one rather than crashing on `defs[0]!` (a TypeError).
  if (defs.length === 0 && config?.fallback === undefined) {
    throw new Error(
      '[llui/router] createRouter requires at least one route definition, or a ' +
        '`fallback` in config when the route list is empty.',
    )
  }

  // The synthesized fallback is `defs[0]` built from PLACEHOLDER params. When the
  // first route reads path parameters, those placeholders are fabricated ('1'), so
  // an unmatched URL would resolve to a bogus route (e.g. `{ page: 'user', id: '1'
  // }`). Require an explicit `fallback` rather than silently inventing one.
  if (config?.fallback === undefined && defs.length > 0) {
    const firstHasParams = defs[0]!.segments.some((seg) => typeof seg !== 'string')
    if (firstHasParams) {
      throw new Error(
        '[llui/router] createRouter needs an explicit `fallback` when the first route ' +
          'has path parameters — otherwise an unmatched URL would fabricate placeholder ' +
          'params for it (e.g. `{ id: "1" }`). Pass `config.fallback`.',
      )
    }
  }

  // Fallback: an explicit config value, else the first route built with sample
  // params so a param-reading builder does not crash createRouter.
  const fallback: R =
    config?.fallback ?? tagRoute(defs[0]!.build(sampleParamsFor(defs[0]!)) as R, defs[0]!)

  // Precompute per-def selection metadata ONCE. Never calls build({}) per
  // format, never round-trips through match — replaces the old
  // O(defs²×deepEqual) heuristic.
  function computeFixed(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    def: RouteDef<any>,
    paramKeys: string[],
  ): Record<string, string | number | boolean> | null {
    try {
      const out = def.build(sampleParamsFor(def)) as Record<string, unknown>
      const fixed: Record<string, string | number | boolean> = {}
      const querySet = new Set(def.queryKeys)
      for (const key of Object.keys(out)) {
        if (paramKeys.includes(key)) continue
        if (querySet.has(key)) continue
        const v = out[key]
        // Only primitive fields discriminate a route. Object/array fields (e.g.
        // a runtime `data` payload) are not part of the URL and would break
        // selection, so they are excluded.
        if (v === null || v === undefined) continue
        if (typeof v === 'object') continue
        fixed[key] = v as string | number | boolean
      }
      return fixed
    } catch {
      // Builder threw on sample params — selection falls back to params only.
      return null
    }
  }

  const defMetas: DefMeta<R>[] = defs.map((def) => {
    const paramKeys: string[] = []
    for (const seg of def.segments) {
      if (typeof seg !== 'string') paramKeys.push(seg.name)
    }
    return { def: def as RouteDef<R>, paramKeys, fixed: computeFixed(def, paramKeys) }
  })

  function matchPathname(pathname: string): R {
    // Drop the URL fragment first — it is client-only and never part of route
    // matching. A `#` sits after the query (`path?query#frag`), so stripping it
    // up front also keeps it out of the parsed query values.
    const hashIdx = pathname.indexOf('#')
    const noFrag = hashIdx !== -1 ? pathname.slice(0, hashIdx) : pathname
    // Separate path from query string
    let queryParams: Record<string, string> = {}
    const qIdx = noFrag.indexOf('?')
    const rawPath = qIdx !== -1 ? noFrag.slice(0, qIdx) : noFrag
    if (qIdx !== -1) {
      queryParams = parseQuery(noFrag.slice(qIdx + 1))
    }

    const path = rawPath.replace(/^\/+|\/+$/g, '')
    const pathSegments = path === '' ? [] : path.split('/')

    // Try each route definition
    for (const def of defs) {
      const params = matchDef(def, pathSegments)
      if (params !== null) {
        // Merge query params
        for (const key of def.queryKeys) {
          if (queryParams[key] !== undefined) params[key] = queryParams[key]!
        }
        return tagRoute(def.build(params) as R, def as RouteDef<R>)
      }
    }

    return fallback
  }

  /** Pick the def that produced a route object, without round-tripping. */
  function selectDef(r: R): DefMeta<R> | null {
    const ro = r as Record<string, unknown>
    let best: DefMeta<R> | null = null
    for (const meta of defMetas) {
      // Every fixed field the builder emits must match the route's value.
      if (meta.fixed) {
        let ok = true
        for (const key in meta.fixed) {
          if (ro[key] !== meta.fixed[key]) {
            ok = false
            break
          }
        }
        if (!ok) continue
      }
      // Every path parameter must be present on the route.
      let allParams = true
      for (const p of meta.paramKeys) {
        const v = ro[p]
        if (v === undefined || v === null) {
          allParams = false
          break
        }
      }
      if (!allParams) continue
      // Prefer the most specific viable def (most params); on a tie, the
      // later-registered def wins (matches the old "most specific first").
      if (best === null || meta.paramKeys.length >= best.paramKeys.length) best = meta
    }
    return best
  }

  function formatWithDef(def: RouteDef<R>, r: R): string | null {
    return def.toPath ? def.toPath(r) : tryFormat(def, r)
  }

  function formatPath(r: R): string {
    // Fast + exact path: a route produced by match carries its def.
    const tagged = getTag(r)
    if (tagged) {
      const p = formatWithDef(tagged, r)
      if (p !== null) return p
    }
    const meta = selectDef(r)
    if (meta) {
      const p = formatWithDef(meta.def, r)
      if (p !== null) return p
    }
    // Last resort — a manual toPath, then any structural format.
    for (const def of defs as RouteDef<R>[]) {
      if (def.toPath) return def.toPath(r)
    }
    for (const def of defs as RouteDef<R>[]) {
      const p = tryFormat(def, r)
      if (p !== null) return p
    }
    return '/'
  }

  function stripBase(pathname: string): string | null {
    if (!base) return pathname
    if (pathname === base || pathname === base + '/') return '/'
    if (pathname.startsWith(base + '/')) return pathname.slice(base.length)
    // `base` immediately followed by a query/hash delimiter: the path is just
    // `/`, and the `?`/`#` tail must be PRESERVED (dropping the delimiter would
    // fold the query into the path, e.g. `/app?q=x` → `/q=x`).
    if (pathname.startsWith(base + '?') || pathname.startsWith(base + '#'))
      return '/' + pathname.slice(base.length)
    return null
  }

  function withBase(path: string): string {
    if (!base) return path
    if (path === '/') return base + '/'
    return base + path
  }

  return {
    match(input: string) {
      if (mode === 'hash') {
        // Strip hash prefix, preserve query string
        return matchPathname(input.replace(/^#\/?/, '/'))
      }
      const stripped = stripBase(input)
      if (stripped === null) return fallback
      return matchPathname(stripped)
    },
    toPath(r: R) {
      return mode === 'hash' ? formatPath(r) : withBase(formatPath(r))
    },
    href(r: R) {
      return mode === 'hash' ? `#${formatPath(r)}` : withBase(formatPath(r))
    },
    mode,
    base,
    routes: defs as ReadonlyArray<RouteDef<R>>,
    fallback,
  }
}

// ── Matching ─────────────────────────────────────────────────────

/** Decode a URI component, falling back to the raw string on malformed input. */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    // Malformed percent-encoding (e.g. `100%`) — decodeURIComponent throws
    // URIError. Fall back to the raw segment rather than crashing the nav path.
    return s
  }
}

function matchDef<R>(def: RouteDef<R>, pathSegments: string[]): Record<string, string> | null {
  const params: Record<string, string> = {}
  let si = 0

  for (let di = 0; di < def.segments.length; di++) {
    const seg = def.segments[di]!

    if (typeof seg === 'string') {
      // Decode the incoming segment before comparing: a non-ASCII literal route
      // (e.g. `['café']`) arrives percent-encoded from the browser (`caf%C3%A9`),
      // so an un-decoded comparison would never match. Params/rest are already
      // decoded below — literals must be too.
      if (si >= pathSegments.length || safeDecode(pathSegments[si]!) !== seg) return null
      si++
    } else if (seg.__kind === 'param') {
      if (si >= pathSegments.length) return null
      params[seg.name] = safeDecode(pathSegments[si]!)
      si++
    } else if (seg.__kind === 'rest') {
      params[seg.name] = pathSegments.slice(si).map(safeDecode).join('/')
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
      // A rest value spans multiple segments — encode each segment
      // individually so the `/` separators survive but any other reserved
      // characters inside a segment are escaped.
      parts.push(String(value).split('/').map(encodeURIComponent).join('/'))
    }
  }

  let path = '/' + parts.join('/')

  // Append query params if defined
  if (def.queryKeys.length > 0) {
    const search = new URLSearchParams()
    for (const key of def.queryKeys) {
      const value = routeObj[key]
      if (value !== undefined && value !== null && value !== '') {
        search.set(key, String(value))
      }
    }
    const qs = search.toString()
    if (qs) path += '?' + qs
  }

  return path
}

// ── Utilities ────────────────────────────────────────────────────

/** Normalize a base path: ensure a leading slash, strip trailing slashes. */
function normalizeBase(b?: string): string {
  if (!b) return ''
  let s = b.trim()
  if (s === '' || s === '/') return ''
  if (!s.startsWith('/')) s = '/' + s
  s = s.replace(/\/+$/, '')
  return s
}

/** Parse a query string via URLSearchParams (handles `+`, `=` in values, decode). */
function parseQuery(qs: string): Record<string, string> {
  const params: Record<string, string> = {}
  // URLSearchParams handles `+` → space, percent-decoding (leniently, never
  // throwing on malformed input), and values containing `=`. Last value wins
  // on duplicate keys, matching the previous hand-rolled behavior.
  const search = new URLSearchParams(qs)
  for (const [key, val] of search) {
    params[key] = val
  }
  return params
}
