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

/** Per-def selection metadata, computed ONCE at createRouter. */
interface DefMeta<R> {
  def: RouteDef<R>
  /** param + rest segment names — all must be present on a route to select this def */
  paramKeys: string[]
  /**
   * The builder's CONSTANT output fields (e.g. `page`, `tab`): primitive,
   * non-param, non-query fields whose value did not move when the sample params
   * did. SAMPLED, therefore only a HEURISTIC — a field that happens to take the
   * same value for both samples reads as constant even when it is derived. It
   * orders candidates and breaks ties; the winner is settled by round-tripping
   * the formatted path (`verifySelection`), never by this map alone.
   * `null` when the builder threw on sample params.
   */
  constants: Record<string, string | number | boolean> | null
  /**
   * The def's COMPLETE primitive output, known EXACTLY rather than sampled.
   * Only defs that read no params at all (no path parameters, no query keys)
   * qualify: their builder is a pure function of `{}`, so this is the one and
   * only route they can ever produce. A route that disagrees with it on a field
   * they both carry provably did not come from this def, which is what lets the
   * common single-template case skip verification entirely (and keeps `href()`
   * at zero builder calls). `null` for every param-reading def.
   */
  exact: Record<string, string | number | boolean> | null
}

type Primitive = string | number | boolean

function isPrimitive(v: unknown): v is Primitive {
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
}

/** Lexicographic compare of two selection scores; > 0 when `a` is the better fit. */
function compareScore(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i]! !== b[i]!) return a[i]! - b[i]!
  }
  return 0
}

/** How well the route a URL actually denotes reproduces the route we formatted. */
interface Fidelity {
  /** +1 per agreeing primitive field, −1 per disagreement and per unexplained one. */
  score: number
  /** No disagreement and nothing unexplained — this URL denotes exactly this route. */
  perfect: boolean
}

/**
 * Compare a route against the route its formatted URL round-trips back to,
 * over PRIMITIVE fields only (an object field — a runtime `data` payload — is
 * never part of a URL and must not influence selection).
 *
 * A field only the ROUND-TRIP carries is a default this def would supply, and
 * #104 established that it must not DISQUALIFY the def. It is still weaker
 * evidence than an exact reproduction, so it costs a point: between two defs
 * that agree on everything the route carries, the one that invents nothing is
 * the better fit. That is the whole of the `/p/:id` vs `/p/:id/edit` decision.
 */
function fidelityOf(route: Record<string, unknown>, produced: Record<string, unknown>): Fidelity {
  let score = 0
  let perfect = true
  for (const key of Object.keys(route)) {
    const a = route[key]
    if (!isPrimitive(a)) continue
    const b = produced[key]
    if (!isPrimitive(b)) {
      score -= 1
      perfect = false
      continue
    }
    if (Object.is(a, b)) {
      score += 1
    } else {
      score -= 1
      perfect = false
    }
  }
  for (const key of Object.keys(produced)) {
    if (!isPrimitive(produced[key])) continue
    if (isPrimitive(route[key])) continue
    score -= 1
    perfect = false
  }
  return { score, perfect }
}

/** Does a route contradict a def's EXACTLY known output on a field they share? */
function contradictsExact(
  exact: Record<string, Primitive>,
  route: Record<string, unknown>,
): boolean {
  for (const key in exact) {
    const v = route[key]
    // An OMITTED field is a default this def supplies, not a contradiction (#104).
    if (v === undefined) continue
    if (!Object.is(v, exact[key])) return true
  }
  return false
}

export function createRouter<R>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  defs: RouteDef<any>[],
  config?: RouterConfig<R>,
): Router<R> {
  const mode = config?.mode ?? 'hash'
  const base = normalizeBase(config?.base)

  /** Placeholder params covering every path/query key a builder may read. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function sampleParamsFor(def: RouteDef<any>, value: string): Record<string, string> {
    const params: Record<string, string> = {}
    for (const seg of def.segments) {
      if (typeof seg !== 'string') params[seg.name] = value
    }
    for (const key of def.queryKeys) params[key] = value
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
  const fallback: R = config?.fallback ?? (defs[0]!.build(sampleParamsFor(defs[0]!, '1')) as R)

  /**
   * Precompute per-def selection metadata ONCE — `href()` is on the hot path of
   * every link and must never call a builder.
   *
   * Classify the builder's emitted fields by building it TWICE with clearly
   * different sample params and keeping only what did not move. A field that
   * moves is param-DERIVED (`title: \`User ${id}\``, `upper: id.toUpperCase()`)
   * and carries no information a route can be matched on; freezing one sample's
   * value and demanding equality against it is what sent every real route to
   * the fallback URL (#104). The two samples differ in length, characters AND
   * numeric value, so the usual derivations — interpolation, case mapping,
   * `.length`, `parseInt` — all move.
   */
  function computeConstants(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    def: RouteDef<any>,
    paramKeys: string[],
  ): Record<string, string | number | boolean> | null {
    try {
      const a = def.build(sampleParamsFor(def, '1')) as Record<string, unknown>
      const b = def.build(sampleParamsFor(def, '2zz')) as Record<string, unknown>
      const constants: Record<string, string | number | boolean> = {}
      const querySet = new Set(def.queryKeys)
      for (const key of Object.keys(a)) {
        if (paramKeys.includes(key)) continue
        if (querySet.has(key)) continue
        const v = a[key]
        // Only primitive fields discriminate a route. Object/array fields (e.g.
        // a runtime `data` payload) are not part of the URL and would break
        // selection, so they are excluded.
        if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') continue
        if (!Object.is(v, b[key])) continue
        constants[key] = v
      }
      return constants
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
    const constants = computeConstants(def, paramKeys)
    // A def that reads NO params has one possible output, so the sampled map IS
    // its exact output. Any param or query key makes the output param-dependent
    // and the map a heuristic again.
    const readsNoParams = paramKeys.length === 0 && def.queryKeys.length === 0
    return {
      def: def as RouteDef<R>,
      paramKeys,
      constants,
      exact: readsNoParams ? constants : null,
    }
  })

  /** Every name any def consumes from a route to build its URL. */
  const urlParamNames = new Set<string>()
  for (const meta of defMetas) {
    for (const p of meta.paramKeys) urlParamNames.add(p)
    for (const q of meta.def.queryKeys) urlParamNames.add(q)
  }

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
        return def.build(params) as R
      }
    }

    return fallback
  }

  /**
   * The defs that could format this route at all: it carries every path
   * parameter they need (without one there is no URL to format), and it does
   * not contradict an EXACTLY known output. That second filter is the only
   * sound elimination available without calling a builder, and it is what
   * leaves the ordinary single-template route with one candidate — hence no
   * verification and no builder call on the `href()` hot path.
   */
  function candidateMetas(ro: Record<string, unknown>): DefMeta<R>[] {
    const out: DefMeta<R>[] = []
    for (const meta of defMetas) {
      let allParams = true
      for (const p of meta.paramKeys) {
        const v = ro[p]
        if (v === undefined || v === null) {
          allParams = false
          break
        }
      }
      if (!allParams) continue
      if (meta.exact !== null && contradictsExact(meta.exact, ro)) continue
      out.push(meta)
    }
    return out
  }

  /**
   * Order the candidates by SHAPE — a cheap, builder-free heuristic used to
   * pick which candidate to verify first and to break ties between equally
   * faithful ones. Two tiers:
   *
   * 1. STRICT — every constant the route actually carries agrees. This is the
   *    discriminating tier: it is what keeps two shared-prefix defs separated
   *    by a constant (`tab: 'authored'` vs `'favorited'`) apart. A constant the
   *    route OMITS is a default this def would supply, not a contradiction, so
   *    it does not disqualify — `href({page:'user', id:'7'})` must resolve
   *    through a def that also emits `tab: 'profile'` (#104).
   * 2. RELAXED — only when no def matches strictly. A builder-emitted field the
   *    caller set to a NON-default value is not representable in the URL and
   *    must not send the route to the fallback URL, so the def that agrees with
   *    the most constants wins. Contradicting every constant while agreeing
   *    with none means a different route entirely, never this URL.
   */
  function preferByShape(candidates: DefMeta<R>[], ro: Record<string, unknown>): DefMeta<R> | null {
    let strict: DefMeta<R> | null = null
    let strictScore: readonly number[] = []
    let relaxed: DefMeta<R> | null = null
    let relaxedScore: readonly number[] = []

    for (const meta of candidates) {
      let matched = 0
      let mismatched = 0
      if (meta.constants) {
        for (const key in meta.constants) {
          if (ro[key] === undefined) continue
          if (ro[key] === meta.constants[key]) matched++
          else mismatched++
        }
      }

      if (mismatched === 0) {
        // Prefer the most specific def (most params); on a tie the
        // later-registered one wins (the longer, more specific pattern).
        const score = [meta.paramKeys.length]
        if (strict === null || compareScore(score, strictScore) >= 0) {
          strict = meta
          strictScore = score
        }
        continue
      }
      if (matched === 0) continue
      const score = [matched, -mismatched, meta.paramKeys.length]
      if (relaxed === null || compareScore(score, relaxedScore) >= 0) {
        relaxed = meta
        relaxedScore = score
      }
    }
    return strict ?? relaxed
  }

  function formatWithDef(def: RouteDef<R>, r: R): string | null {
    return def.toPath ? def.toPath(r) : tryFormat(def, r)
  }

  /**
   * Verified selections, keyed on the route's primitive key/value signature.
   * Bounded: a router whose routes carry an unbounded param space (an id per
   * user) would otherwise grow one entry per distinct route ever formatted.
   * Dropping the whole table on overflow costs a re-verification, never a wrong
   * answer — the cache is an optimization, and the verification is the truth.
   */
  const verified = new Map<string, DefMeta<R> | null>()
  const VERIFIED_MAX = 512

  /**
   * A key that determines the verification outcome, or `null` when it cannot.
   * Values are length-prefixed so no two different routes can encode alike. A
   * NON-primitive value is only observable through `String(value)` in a URL
   * segment, so it disables caching just for the keys a def actually formats.
   */
  function signatureOf(ro: Record<string, unknown>): string | null {
    let sig = ''
    for (const key of Object.keys(ro).sort()) {
      const v = ro[key]
      if (v === undefined) continue
      if (v === null || !isPrimitive(v)) {
        if (urlParamNames.has(key)) return null
        continue
      }
      const t = typeof v === 'string' ? 's' : typeof v === 'number' ? 'n' : 'b'
      const s = String(v)
      sig += `${key.length}:${key}=${t}${s.length}:${s};`
    }
    return sig
  }

  /** The route the def's URL actually denotes, and how well it reproduces `r`. */
  function roundTrip(meta: DefMeta<R>, r: R, ro: Record<string, unknown>): Fidelity | null {
    try {
      const path = formatWithDef(meta.def, r)
      if (path === null) return null
      return fidelityOf(ro, matchPathname(path) as Record<string, unknown>)
    } catch {
      // A hand-written `toPath` or a builder that throws on these params: this
      // def cannot be verified, so it cannot win a contest it might lose.
      return null
    }
  }

  /**
   * Settle a contested selection by ROUND-TRIP: format with each candidate and
   * ask `match()` which route that URL actually denotes. Sampling cannot tell a
   * param-derived field from a constant when the samples coincide, and the
   * shape tiers then hand the route to a def that genuinely owns that constant
   * — a plausible URL for the WRONG route, which `link()` both renders and
   * pushes. The round-trip answers the real question ("does this URL mean this
   * route?") instead of guessing at it.
   *
   * Only runs when more than one def can format the route, and is memoized on
   * the route's signature, so the ordinary case stays at zero builder calls.
   */
  function verifySelection(
    r: R,
    ro: Record<string, unknown>,
    candidates: DefMeta<R>[],
    preferred: DefMeta<R> | null,
  ): DefMeta<R> | null {
    const key = signatureOf(ro)
    if (key !== null) {
      const hit = verified.get(key)
      if (hit !== undefined) return hit
    }

    let best: DefMeta<R> | null = null
    let bestScore = -Infinity
    // The shape-preferred candidate goes first: when it round-trips exactly,
    // no other candidate can beat it and no further builder runs.
    const ordered = preferred === null ? candidates : [preferred, ...candidates]
    for (const meta of ordered) {
      if (meta === best) continue
      const fit = roundTrip(meta, r, ro)
      if (fit === null) continue
      if (fit.perfect) {
        best = meta
        break
      }
      // Strictly greater: an equal fit leaves the shape order in charge, so a
      // genuinely ambiguous route keeps the answer it has always had.
      if (fit.score > bestScore) {
        best = meta
        bestScore = fit.score
      }
    }
    const winner = best ?? preferred
    if (key !== null) {
      if (verified.size >= VERIFIED_MAX) verified.clear()
      verified.set(key, winner)
    }
    return winner
  }

  /**
   * Pick the def whose URL template a route belongs to: narrow to the defs that
   * can format it, order them by shape, and — only when more than one competes
   * — verify the winner by round-tripping its URL back through `match()`.
   */
  function selectDef(r: R): DefMeta<R> | null {
    const ro = r as Record<string, unknown>
    const candidates = candidateMetas(ro)
    if (candidates.length === 0) return null
    if (candidates.length === 1) return candidates[0]!
    const preferred = preferByShape(candidates, ro)
    return verifySelection(r, ro, candidates, preferred)
  }

  function formatPath(r: R): string {
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
