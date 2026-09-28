/**
 * The repo's HERMETIC NETWORK POLICY: every request a browser page makes under
 * `pnpm smoke:examples` or under a browser test suite is decided here, and
 * nothing leaves the machine.
 *
 * `scripts/smoke-examples.ts` boots each built example in Chromium to catch
 * runtime crashes on first paint. It used to let off-origin requests go to the
 * live internet and forgave exactly one failure shape,
 * `net::ERR_NAME_NOT_RESOLVED`. That made a test about LLui runtime correctness
 * depend on how the network happened to be broken: behind a proxy the same two
 * requests fail `ERR_TUNNEL_CONNECTION_FAILED`, a slow resolver times out, and
 * an Iconify outage fails a run whose code is fine. It also IGNORED every new
 * off-origin dependency whose host did not resolve, which is the opposite of
 * what a smoke test should do with one.
 *
 * The browser test suites had the same dependency with nothing watching it:
 * every suite that loads a demo requested `api.iconify.design` live, no
 * assertion looked at the answer, and so the suites behaved differently on a
 * networked CI runner (glyphs painted) and in a sandbox (requests failed) while
 * both stayed green. They now go through the SAME decision function and the
 * SAME fixture (`scripts/lib/hermetic-browser.mjs`), so the two cannot drift.
 *
 * Every request takes exactly one of four decisions:
 *
 *  - `local`: the caller's own server(s) — for the smoke, the one example's
 *    static origin; for a test suite, any loopback origin (suites serve
 *    several ephemeral ports, and loopback is by definition this machine) —
 *    and any non-network scheme (`data:`, `blob:`, `about:`). Passed through.
 *  - `fixture`: a DECLARED third-party dependency a page legitimately needs,
 *    answered from a checked-in fixture. Today that is the Iconify API
 *    (`@llui/components/icon` fetches glyph bodies from it at mount).
 *  - `declared-failure`: a host a page requests PRECISELY so it fails —
 *    `example.invalid` (RFC 6761 reserves `.invalid`; it can never resolve),
 *    used by the components demo to exercise the avatar's image-error
 *    fallback. Aborted as `namenotresolved`, which is what a real resolver
 *    would say, deterministically.
 *  - `unexpected`: anything else. Aborted, and the smoke or the test FAILS
 *    naming the URL. A new network dependency has to be declared here, with a
 *    fixture, before it can ship.
 *
 * The decision functions are pure and Playwright-free so
 * `scripts/test/network-policy.test.ts` can pin each branch without a browser;
 * `routeContext` is the one place that applies them to a browser context.
 */
import { AFTER_FIRST_PAINT, ICONIFY_FIXTURE } from './iconify-fixture.mjs'

/** @typedef {import('./iconify-fixture.mjs').IconifyFixtureSet} IconifyFixtureSet */

export const ICONIFY_ORIGIN = 'https://api.iconify.design'

/**
 * @typedef {{ readonly kind: 'local' }
 *   | { readonly kind: 'fixture', readonly status: number, readonly contentType: string, readonly body: string }
 *   | { readonly kind: 'declared-failure', readonly reason: string }
 *   | { readonly kind: 'unexpected', readonly message: string }} NetworkDecision
 */

/**
 * Which URLs count as the caller's own. A predicate rather than an origin
 * string, because the smoke has exactly one origin and a test suite has as
 * many loopback ports as it started servers.
 *
 * @typedef {(url: URL) => boolean} LocalPolicy
 */

/**
 * Hosts a page requests so that the request FAILS.
 * @type {readonly { readonly host: string, readonly why: string }[]}
 */
const DECLARED_FAILURE_HOSTS = [
  {
    host: 'example.invalid',
    why: 'RFC 6761 reserved name; the components demo points an avatar at it to render the fallback',
  },
]

/** Schemes that never touch a network. */
const NON_NETWORK_SCHEMES = new Set(['data:', 'blob:', 'about:'])

/** `ws:`/`wss:` share their origin with `http:`/`https:` for this policy. */
const HTTP_SCHEME_OF = /** @type {Readonly<Record<string, string>>} */ ({
  'http:': 'http:',
  'https:': 'https:',
  'ws:': 'http:',
  'wss:': 'https:',
})

/**
 * The origin of an HTTP or WebSocket URL with the WebSocket scheme folded onto
 * its HTTP twin, or `null` for any other scheme.
 * @param {URL} url
 * @returns {string | null}
 */
function httpOrigin(url) {
  const scheme = HTTP_SCHEME_OF[url.protocol]
  return scheme === undefined ? null : `${scheme}//${url.host}`
}

/**
 * Local = exactly one origin (and its WebSocket twin). The smoke's policy.
 * @param {string} origin e.g. `http://127.0.0.1:4173`
 * @returns {LocalPolicy}
 */
export function sameOrigin(origin) {
  const expected = new URL(origin).origin
  return (url) => httpOrigin(url) === expected
}

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]'])

/**
 * Local = any port on the loopback interface. The test suites' policy: a
 * suite serves prebuilt fixtures, Vite servers and path documents on several
 * ephemeral ports, and none of them is off the machine.
 * @type {LocalPolicy}
 */
export const loopback = (url) => httpOrigin(url) !== null && LOOPBACK_HOSTNAMES.has(url.hostname)

/**
 * @param {URL} url
 * @returns {string[]}
 */
function iconNames(url) {
  return (url.searchParams.get('icons') ?? '').split(',').filter((name) => name !== '')
}

/**
 * The `prefix:name` entries an Iconify request ASKS for, whatever the decision
 * on it. Staleness is judged against what was requested, not what was served:
 * a batch rejected for one undeclared glyph still asked for the other 23, and
 * reporting those as stale would bury the one real failure.
 *
 * @param {string} rawUrl
 * @returns {string[]}
 */
export function requestedIconifyEntries(rawUrl) {
  /** @type {URL} */
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    return []
  }
  if (url.origin !== ICONIFY_ORIGIN) return []
  const prefix = /^\/([a-z0-9-]+)\.json$/.exec(url.pathname)?.[1]
  if (prefix === undefined) return []
  return iconNames(url).map((name) => `${prefix}:${name}`)
}

/**
 * Answer one Iconify API request (`/<prefix>.json?icons=a,b,c`) from the
 * fixture, in the API's own response shape: found glyphs under `icons`, names
 * the set does not have under `not_found`. A name the fixture does not DECLARE
 * either way is `unexpected` — the fixture must describe every glyph a page
 * requests, so a new icon in a demo is a failure until someone adds it there
 * rather than a silent live request.
 *
 * @param {URL} url
 * @param {Readonly<Record<string, IconifyFixtureSet>>} [fixture]
 * @returns {NetworkDecision}
 */
export function iconifyDecision(url, fixture = ICONIFY_FIXTURE) {
  const match = /^\/([a-z0-9-]+)\.json$/.exec(url.pathname)
  const prefix = match?.[1]
  if (prefix === undefined) {
    return {
      kind: 'unexpected',
      message: `Iconify request with an unrecognised path: ${url.href}`,
    }
  }
  const set = fixture[prefix]
  if (set === undefined) {
    return {
      kind: 'unexpected',
      message: `Iconify set "${prefix}" is not in the fixture (scripts/lib/iconify-fixture.mjs): ${url.href}`,
    }
  }
  const requested = iconNames(url)
  if (requested.length === 0) {
    return { kind: 'unexpected', message: `Iconify request names no icons: ${url.href}` }
  }
  /** @type {Record<string, { body: string }>} */
  const icons = {}
  /** @type {string[]} */
  const notFound = []
  /** @type {string[]} */
  const undeclared = []
  for (const name of requested) {
    const body = set.icons[name]
    if (body !== undefined) icons[name] = { body }
    else if (set.notFound.includes(name)) notFound.push(name)
    else undeclared.push(name)
  }
  if (undeclared.length > 0) {
    return {
      kind: 'unexpected',
      message: `Iconify glyph(s) ${undeclared.map((name) => `"${prefix}:${name}"`).join(', ')} not declared in the fixture (scripts/lib/iconify-fixture.mjs): ${url.href}`,
    }
  }
  /** @type {Record<string, unknown>} */
  const payload = {
    prefix,
    icons,
    width: set.width,
    height: set.height,
  }
  if (notFound.length > 0) payload['not_found'] = notFound
  return {
    kind: 'fixture',
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(payload),
  }
}

/**
 * Decide one request.
 * @param {string} rawUrl
 * @param {LocalPolicy} isLocal which URLs are the caller's own servers
 * @returns {NetworkDecision}
 */
export function decideRequest(rawUrl, isLocal) {
  /** @type {URL} */
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    return { kind: 'unexpected', message: `unparseable request URL: ${rawUrl}` }
  }
  if (NON_NETWORK_SCHEMES.has(url.protocol) || isLocal(url)) return { kind: 'local' }
  if (url.origin === ICONIFY_ORIGIN) return iconifyDecision(url)
  const failure = DECLARED_FAILURE_HOSTS.find((entry) => entry.host === url.hostname)
  if (failure !== undefined) return { kind: 'declared-failure', reason: failure.why }
  return {
    kind: 'unexpected',
    message: `unexpected off-origin request ${url.href} — browser pages are hermetic; declare the dependency (with a fixture) in scripts/lib/network-policy.mjs`,
  }
}

/**
 * Every `prefix:name` the fixture declares, found or not-found.
 * @param {Readonly<Record<string, IconifyFixtureSet>>} [fixture]
 * @returns {string[]}
 */
export function declaredIconifyEntries(fixture = ICONIFY_FIXTURE) {
  /** @type {string[]} */
  const out = []
  for (const [prefix, set] of Object.entries(fixture)) {
    for (const name of Object.keys(set.icons)) out.push(`${prefix}:${name}`)
    for (const name of set.notFound) out.push(`${prefix}:${name}`)
  }
  return out.sort()
}

/**
 * First-paint fixture entries the smoke's examples did not request. The
 * fixture is meant to describe what the pages need EXACTLY, so an entry nobody
 * asks for is stale (a demo dropped the glyph) and is reported the same way a
 * missing one is. Entries in `afterFirstPaint` are requested only after an
 * interaction the smoke does not perform, so their staleness is judged
 * elsewhere (by source reference, in `scripts/test/network-policy.test.ts`).
 *
 * @param {ReadonlySet<string>} requested
 * @param {Readonly<Record<string, IconifyFixtureSet>>} [fixture]
 * @param {ReadonlySet<string>} [afterFirstPaint]
 * @returns {string[]}
 */
export function staleIconifyEntries(
  requested,
  fixture = ICONIFY_FIXTURE,
  afterFirstPaint = AFTER_FIRST_PAINT,
) {
  return declaredIconifyEntries(fixture).filter(
    (entry) => !requested.has(entry) && !afterFirstPaint.has(entry),
  )
}

/**
 * `AFTER_FIRST_PAINT` entries a first paint DID request: they belong with the
 * first-paint entries, where the smoke's own staleness check covers them.
 *
 * @param {ReadonlySet<string>} requested
 * @param {ReadonlySet<string>} [afterFirstPaint]
 * @returns {string[]}
 */
export function misfiledAfterFirstPaintEntries(requested, afterFirstPaint = AFTER_FIRST_PAINT) {
  return [...afterFirstPaint].filter((entry) => requested.has(entry)).sort()
}

/**
 * @typedef {object} RouteHooks
 * @property {LocalPolicy} isLocal Which URLs are the caller's own servers.
 * @property {(message: string) => void} onUnexpected Called once per request
 *   (HTTP or WebSocket) the policy refuses that the page ISSUED, with a
 *   message naming its URL and the page that made it — whether the policy's
 *   own route aborted it or some other route let it through.
 * @property {(url: string) => void} [onRequest] Observes every HTTP request the
 *   page issues (the smoke collects requested Iconify glyphs here).
 * @property {(request: import('playwright').Request) => void} [onAborted]
 *   Observes every request the policy aborted on purpose (declared failures
 *   included), so a `requestfailed` listener can tell them from real failures.
 */

/**
 * Where a request came from, for the failure message. A service-worker
 * request has no frame, and `frame()` throws for it.
 * @param {import('playwright').Request} request
 * @returns {string}
 */
function initiator(request) {
  try {
    return request.frame().url()
  } catch {
    return '(no frame)'
  }
}

/**
 * Apply the policy to every HTTP request and WebSocket of `context`. The ONE
 * place the decision is turned into Playwright routing and reporting, shared
 * by the smoke and the test suites.
 *
 * TWO MECHANISMS, because routing alone depends on ORDER. Playwright runs the
 * NEWEST matching route handler first (page routes before context routes), so
 * a caller that registers its own `route(…)` after this one and calls
 * `continue()` — or `fulfill()` — decides the request before the policy's
 * handler ever runs. So:
 *
 *  - ROUTING is the first line of defence: it is what keeps a disallowed
 *    request off the network and answers the Iconify fixture. It REPORTS
 *    nothing for HTTP.
 *  - OBSERVATION is what reports. Every HTTP request fires the context's
 *    `request` event whatever any route handler then does with it (measured:
 *    it fires for requests a route aborts, continues or fulfills), and every
 *    WebSocket that is actually opened fires its page's `websocket` event. Each
 *    is judged against the same `decideRequest`, so a disallowed request the
 *    page ISSUED is reported exactly once, whichever handler decided it. That
 *    includes a request a caller's own route stubbed: an external dependency
 *    is declared here, with a fixture, never answered ad hoc by one suite.
 *
 * A WebSocket the policy's own `routeWebSocket` handler refuses is closed
 * without being opened, so no `websocket` event fires for it (measured); that
 * handler reports it instead, and the two paths never both see one socket.
 *
 * Service workers must be blocked on the context (`serviceWorkers: 'block'`):
 * a worker's fetches bypass `route`, which would be a hole in the routing.
 *
 * @param {import('playwright').BrowserContext} context
 * @param {RouteHooks} hooks
 * @returns {Promise<void>}
 */
export async function routeContext(context, hooks) {
  const { isLocal, onUnexpected, onRequest, onAborted } = hooks
  /** @param {string} url */
  const refusedSocket = (url) =>
    `unexpected off-origin WebSocket ${url} — browser pages are hermetic; declare the dependency in scripts/lib/network-policy.mjs`

  // Observation first, so nothing issued between the two registrations
  // escapes it.
  context.on('request', (request) => {
    onRequest?.(request.url())
    const decision = decideRequest(request.url(), isLocal)
    if (decision.kind === 'unexpected') {
      onUnexpected(`${decision.message} (requested by ${initiator(request)})`)
    }
  })
  /** @param {import('playwright').Page} page */
  const watchPage = (page) => {
    page.on('websocket', (ws) => {
      if (decideSocket(ws.url(), isLocal)) return
      onUnexpected(`${refusedSocket(ws.url())} (opened by ${page.url()})`)
    })
  }
  for (const page of context.pages()) watchPage(page)
  context.on('page', watchPage)

  await context.route('**/*', async (route) => {
    const request = route.request()
    const decision = decideRequest(request.url(), isLocal)
    switch (decision.kind) {
      case 'local':
        await route.continue()
        return
      case 'fixture':
        await route.fulfill({
          status: decision.status,
          contentType: decision.contentType,
          // The page reads it with a cross-origin `fetch`, as from the API.
          headers: { 'access-control-allow-origin': '*' },
          body: decision.body,
        })
        return
      case 'declared-failure':
      case 'unexpected':
        // Reported by the `request` observer above, not here.
        onAborted?.(request)
        await route.abort(decision.kind === 'unexpected' ? 'blockedbyclient' : 'namenotresolved')
        return
    }
  })
  await context.routeWebSocket(/.*/, async (ws) => {
    if (decideSocket(ws.url(), isLocal)) {
      ws.connectToServer()
      return
    }
    onUnexpected(refusedSocket(ws.url()))
    await ws.close()
  })
}

/**
 * Whether a WebSocket URL is one of the caller's own servers.
 * @param {string} url
 * @param {LocalPolicy} isLocal
 * @returns {boolean}
 */
function decideSocket(url, isLocal) {
  return URL.canParse(url) && isLocal(new URL(url))
}
