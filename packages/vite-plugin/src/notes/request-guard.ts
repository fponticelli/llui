// Request-provenance guards for the `/_llui/*` notebook API.
//
// The notebook middleware runs on the dev server and exposes mutating
// endpoints (create/patch/delete notes, spawn tasks, revert working-tree
// files). None of that should be reachable cross-site: a malicious page a
// developer visits while `vite dev` runs must not be able to POST to
// `http://127.0.0.1:5173/_llui/*` and drive the notebook (CSRF), so every
// mutating request is gated on:
//
//   1. a loopback Host header (the dev server only ever serves localhost),
//   2. a same-origin (or absent) Origin header — a cross-site Origin is a
//      forged request from another page and is rejected,
//   3. `Sec-Fetch-Site` not being `cross-site`/`cross-origin` (browsers
//      that send it give us a second, header-forgery-resistant signal).
//
// JSON-body routes additionally require an `application/json` content type
// so a form/`text/plain` POST (which browsers allow cross-site without a
// CORS preflight) can't smuggle a JSON body past the parser.

import type { IncomingMessage } from 'node:http'

// The loopback host set + authority parsing are owned by `@llui/security`
// (`isLoopbackAuthority`), unified with the MCP copy so the CSRF/CSWSH guard
// can't drift. The host set is { localhost, 127.0.0.1, ::1 }; `0.0.0.0` is
// deliberately NOT loopback (the unspecified/all-interfaces bind address is not
// provably same-machine). The same-origin flow below (Host required, cross-site
// Sec-Fetch-Site rejected, Origin — when present — must be loopback) is unchanged.
import { isLoopbackAuthority } from '@llui/security'

/**
 * Reject any mutating request that isn't a same-origin call to a loopback
 * host. Returns `null` when the request is allowed, or an error message
 * describing the rejection (the caller answers with 403).
 */
export function checkSameOriginLoopback(req: IncomingMessage): string | null {
  const host = req.headers['host']
  if (!isLoopbackAuthority(host)) {
    return 'request rejected: non-loopback Host'
  }

  // A browser marks cross-site fetches with Sec-Fetch-Site. Trust it when
  // present as an early, unforgeable-by-page rejection.
  const fetchSite = req.headers['sec-fetch-site']
  if (fetchSite === 'cross-site' || fetchSite === 'cross-origin') {
    return `request rejected: cross-site fetch (${String(fetchSite)})`
  }

  // Origin, when the browser sends it, must match the Host we're serving.
  // A missing Origin is allowed (same-origin GET-style fetches and
  // non-browser clients legitimately omit it); a mismatching Origin is a
  // cross-site forgery.
  const origin = req.headers['origin']
  if (origin && origin !== 'null') {
    let originHost: string
    try {
      originHost = new URL(origin).host
    } catch {
      return `request rejected: malformed Origin (${origin})`
    }
    // A loopback Origin (any port / any loopback spelling) is same-machine
    // and allowed; a non-loopback Origin is a cross-site forgery.
    if (!isLoopbackAuthority(originHost)) {
      return `request rejected: cross-origin Origin (${origin})`
    }
  }
  return null
}

/** Whether the request declares a JSON body. */
export function isJsonContentType(req: IncomingMessage): boolean {
  const ct = req.headers['content-type']
  if (!ct) return false
  // `application/json` optionally followed by `; charset=...`
  return /^application\/json\b/i.test(ct.trim())
}
