/**
 * The smoke test's NETWORK POLICY: every request an example makes is decided
 * here, and nothing leaves the machine.
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
 * Every request now takes exactly one of four decisions:
 *
 *  - `local`: the example's own static server. Passed through.
 *  - `fixture`: a DECLARED third-party dependency an example legitimately
 *    needs, answered from a checked-in fixture. Today that is the Iconify API
 *    (`@llui/components/icon` fetches glyph bodies from it at mount).
 *  - `declared-failure`: a host an example requests PRECISELY so it fails —
 *    `example.invalid` (RFC 6761 reserves `.invalid`; it can never resolve),
 *    used by the components demo to exercise the avatar's image-error
 *    fallback. Aborted as `namenotresolved`, which is what a real resolver
 *    would say, deterministically.
 *  - `unexpected`: anything else. Aborted, and the smoke FAILS naming the URL.
 *    A new network dependency has to be declared here, with a fixture, before
 *    it can ship in an example.
 *
 * Pure and Playwright-free so `scripts/test/smoke-network.test.ts` can pin each
 * branch without a browser.
 */
import { ICONIFY_FIXTURE, type IconifyFixtureSet } from './smoke-iconify-fixture'

export const ICONIFY_ORIGIN = 'https://api.iconify.design'

export type NetworkDecision =
  | { readonly kind: 'local' }
  | {
      readonly kind: 'fixture'
      readonly status: number
      readonly contentType: string
      readonly body: string
    }
  | { readonly kind: 'declared-failure'; readonly reason: string }
  | { readonly kind: 'unexpected'; readonly message: string }

/** Hosts an example requests so that the request FAILS. */
const DECLARED_FAILURE_HOSTS: readonly { readonly host: string; readonly why: string }[] = [
  {
    host: 'example.invalid',
    why: 'RFC 6761 reserved name; the components demo points an avatar at it to render the fallback',
  },
]

function sameOrigin(url: URL, localOrigin: string): boolean {
  return url.origin === localOrigin
}

function iconNames(url: URL): string[] {
  return (url.searchParams.get('icons') ?? '').split(',').filter((name) => name !== '')
}

/**
 * The `prefix:name` entries an Iconify request ASKS for, whatever the decision
 * on it. Staleness is judged against what was requested, not what was served:
 * a batch rejected for one undeclared glyph still asked for the other 23, and
 * reporting those as stale would bury the one real failure.
 */
export function requestedIconifyEntries(rawUrl: string): string[] {
  let url: URL
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
 * either way is `unexpected` — the fixture must describe every glyph the
 * examples request, so a new icon in a demo is a smoke failure until someone
 * adds it here rather than a silent live request.
 */
export function iconifyDecision(
  url: URL,
  fixture: Readonly<Record<string, IconifyFixtureSet>> = ICONIFY_FIXTURE,
): NetworkDecision {
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
      message: `Iconify set "${prefix}" is not in the smoke fixture (scripts/lib/smoke-iconify-fixture.ts): ${url.href}`,
    }
  }
  const requested = iconNames(url)
  if (requested.length === 0) {
    return { kind: 'unexpected', message: `Iconify request names no icons: ${url.href}` }
  }
  const icons: Record<string, { body: string }> = {}
  const notFound: string[] = []
  const undeclared: string[] = []
  for (const name of requested) {
    const body = set.icons[name]
    if (body !== undefined) icons[name] = { body }
    else if (set.notFound.includes(name)) notFound.push(name)
    else undeclared.push(name)
  }
  if (undeclared.length > 0) {
    return {
      kind: 'unexpected',
      message: `Iconify glyph(s) ${undeclared.map((name) => `"${prefix}:${name}"`).join(', ')} not declared in the smoke fixture (scripts/lib/smoke-iconify-fixture.ts): ${url.href}`,
    }
  }
  const payload: Record<string, unknown> = {
    prefix,
    icons,
    width: set.width,
    height: set.height,
  }
  if (notFound.length > 0) payload.not_found = notFound
  return {
    kind: 'fixture',
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(payload),
  }
}

/** Decide one request. `localOrigin` is the example's static server. */
export function decideRequest(rawUrl: string, localOrigin: string): NetworkDecision {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { kind: 'unexpected', message: `unparseable request URL: ${rawUrl}` }
  }
  if (sameOrigin(url, localOrigin)) return { kind: 'local' }
  if (url.origin === ICONIFY_ORIGIN) return iconifyDecision(url)
  const failure = DECLARED_FAILURE_HOSTS.find((entry) => entry.host === url.hostname)
  if (failure !== undefined) return { kind: 'declared-failure', reason: failure.why }
  return {
    kind: 'unexpected',
    message: `unexpected off-origin request ${url.href} — the smoke test is hermetic; declare the dependency (with a fixture) in scripts/lib/smoke-network.ts`,
  }
}

/** Every `prefix:name` the fixture declares, found or not-found. */
export function declaredIconifyEntries(
  fixture: Readonly<Record<string, IconifyFixtureSet>> = ICONIFY_FIXTURE,
): string[] {
  const out: string[] = []
  for (const [prefix, set] of Object.entries(fixture)) {
    for (const name of Object.keys(set.icons)) out.push(`${prefix}:${name}`)
    for (const name of set.notFound) out.push(`${prefix}:${name}`)
  }
  return out.sort()
}

/**
 * Fixture entries no example requested. The fixture is meant to describe what
 * the examples need EXACTLY, so an entry nobody asks for is stale (a demo
 * dropped the glyph) and is reported the same way a missing one is.
 */
export function staleIconifyEntries(
  requested: ReadonlySet<string>,
  fixture: Readonly<Record<string, IconifyFixtureSet>> = ICONIFY_FIXTURE,
): string[] {
  return declaredIconifyEntries(fixture).filter((entry) => !requested.has(entry))
}
