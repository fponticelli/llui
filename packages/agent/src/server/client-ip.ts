/**
 * Best-effort client IP, used as the rate-limit bucket key on every
 * endpoint that allocates server-side state for a caller who has no
 * resolved identity yet — `/agent/mint` (a token record) and the MCP
 * `initialize` path (a transport + a fully-registered MCP server).
 *
 * Prefers the first `X-Forwarded-For` hop (the original client behind
 * proxies), then `X-Real-IP`. Falls back to a shared constant so
 * anonymous callers without any forwarding header still share ONE
 * throttle bucket rather than each getting an unlimited allowance —
 * that fallback is what makes the limiter hold on a direct-to-origin
 * deployment where no proxy sets either header.
 */
export function clientIpOf(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first
  }
  const real = req.headers.get('x-real-ip')
  if (real) return real.trim()
  return 'anon'
}
