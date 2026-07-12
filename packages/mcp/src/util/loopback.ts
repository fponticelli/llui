import { Buffer } from 'node:buffer'
import { timingSafeEqual } from 'node:crypto'

// `isLoopbackOrigin` is owned by `@llui/security` (unified with the vite-plugin
// request-guard copy so the CSRF/CSWSH host set can't drift). Re-exported here
// so the transport call sites (`cli.ts`, `relay.ts`) keep their import. The
// node-crypto `tokensMatch` stays local — it depends on `node:*` builtins and
// has no browser-safe home in the dependency-free security package.
export { isLoopbackOrigin } from '@llui/security'

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
