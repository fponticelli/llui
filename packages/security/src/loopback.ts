// Loopback / same-machine authority recognition.
//
// This UNIFIES the two previously divergent copies that gated CSRF/CSWSH:
//   - `@llui/mcp`'s `isLoopbackOrigin` (Origin-string based), and
//   - `@llui/vite-plugin`'s `isLoopbackAuthority` (Host/authority based).
//
// Both agreed on the same host SET after normalization; only their parsing and
// their absent-value semantics differed. The union kept here:
//   - host set = { localhost, 127.0.0.1, ::1 } (bracketed `[::1]` normalized).
//   - `0.0.0.0` is DELIBERATELY excluded: it is the unspecified/"all interfaces"
//     bind address, not a loopback authority — a request claiming it is not
//     provably same-machine, so treating it as loopback would widen the guard.
//   - an ABSENT Origin is allowed (native clients omit it); an absent authority
//     is NOT (a request with no Host is not provably same-machine).

/** Bracket-stripped, lowercased hostnames that identify the loopback interface. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

/**
 * True when `host` — a bare hostname with NO port (IPv6 may be bracketed
 * `[::1]` or bare `::1`) — names the loopback interface.
 */
export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase()
  const unbracketed = h.startsWith('[') && h.endsWith(']') ? h.slice(1, -1) : h
  return LOOPBACK_HOSTS.has(unbracketed)
}

/** Strip a `:port` suffix from an authority, tolerating IPv6 forms. */
function stripPort(authority: string): string {
  const trimmed = authority.trim()
  if (trimmed.startsWith('[')) {
    // IPv6 literal: `[::1]:5173` → `[::1]`.
    const close = trimmed.indexOf(']')
    return close === -1 ? trimmed : trimmed.slice(0, close + 1)
  }
  const first = trimmed.indexOf(':')
  if (first === -1) return trimmed
  // A single colon denotes `host:port`; 2+ colons is an unbracketed IPv6 literal
  // (which has no `:port` form) — leave it intact so `::1` is still recognized.
  if (trimmed.indexOf(':', first + 1) !== -1) return trimmed
  return trimmed.slice(0, first)
}

/**
 * True when an authority (`host` or `host:port`, IPv6 bracketed as `[::1]:port`)
 * is a loopback host. An ABSENT/empty authority → `false`: a request with no
 * Host header is not provably same-machine, so it must not pass the guard.
 */
export function isLoopbackAuthority(authority: string | undefined): boolean {
  if (!authority) return false
  return isLoopbackHost(stripPort(authority))
}

/**
 * True when an `Origin` header value is same-origin/local: either ABSENT (a
 * native, non-browser client sends none) or a loopback host. A cross-origin
 * browser page (CSWSH / drive-by hijack) presents a non-loopback Origin and is
 * rejected. A literal `Origin: null` (sandboxed / `file:` / `data:` context)
 * fails `new URL` and is likewise rejected — it is NOT the same as an absent
 * header.
 *
 * IPv6 loopback origins arrive bracketed (`http://[::1]`), and WHATWG
 * `URL.hostname` keeps the brackets (`[::1]`); {@link isLoopbackHost} strips them
 * before the comparison so bracketed IPv6 loopback is recognised.
 */
export function isLoopbackOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true
  try {
    const { hostname } = new URL(origin)
    return isLoopbackHost(hostname)
  } catch {
    return false
  }
}
