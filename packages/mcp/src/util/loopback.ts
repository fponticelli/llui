import { Buffer } from 'node:buffer'
import { timingSafeEqual } from 'node:crypto'

/**
 * Constant-time comparison of two ASCII tokens. Avoids leaking length /
 * content via early-exit timing on the auth check. Shared by the MCP
 * HTTP transport (`cli.ts`) and the browser-bridge relay (`relay.ts`) so
 * this security-sensitive check exists in exactly one place.
 */
export function tokensMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/**
 * True when an `Origin` header is same-origin/local: either ABSENT (a
 * native, non-browser client sends none) or a loopback host. A
 * cross-origin browser page (CSWSH / drive-by hijack) presents a
 * non-loopback Origin and is rejected. A literal `Origin: null`
 * (sandboxed / `file:` / `data:` context) fails `new URL` below and is
 * likewise rejected — it is NOT the same as an absent header.
 *
 * IPv6 loopback origins arrive bracketed (`http://[::1]`), and WHATWG
 * `URL.hostname` keeps the brackets (`[::1]`); we strip them before the
 * loopback comparison so bracketed IPv6 loopback is recognised.
 */
export function isLoopbackOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true
  try {
    const { hostname } = new URL(origin)
    const host =
      hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
    return host === '127.0.0.1' || host === 'localhost' || host === '::1'
  } catch {
    return false
  }
}
