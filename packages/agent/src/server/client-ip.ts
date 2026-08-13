/**
 * Client-IP derivation for the rate-limit bucket key, used on every
 * endpoint that allocates server-side state for a caller who has no
 * resolved identity yet — `/agent/mint` (a token record) and the MCP
 * `initialize` path (a transport + a fully-registered MCP server).
 *
 * ── WHY THE DEFAULT IGNORES `X-FORWARDED-FOR` ─────────────────────
 * This used to read the first `X-Forwarded-For` hop unconditionally,
 * then `X-Real-IP`. Both are plain request headers. A deployment sitting
 * directly on the origin — the primary one for this package, a dev
 * server or a small Node app — has nothing rewriting them, so the caller
 * chooses the value, and a caller who chooses a fresh value per request
 * gets a fresh throttle bucket per request. That is a limiter that
 * allows everything (measured: 200/200 allocations through a 3/minute
 * limiter). A forwarding header is evidence only when something
 * trustworthy wrote it, so trusting one is now an explicit deployment
 * statement (`trustProxy`) and defaults to OFF.
 *
 * Three sources, in order:
 *
 *   1. The forwarded chain — ONLY when `trustProxy` declares how many
 *      reverse proxies sit in front. Each proxy APPENDS the peer it saw,
 *      so with `n` trusted proxies the last `n` entries are the ones
 *      they authored and everything left of those arrived in the
 *      caller's own header. The hop to read is therefore `n` from the
 *      END, never the first.
 *   2. `clientAddress` — a host-supplied peer (socket) address. Not
 *      derivable from a WHATWG `Request`, so the host has to pass it:
 *      Node from `socket.remoteAddress`, Cloudflare from
 *      `cf-connecting-ip` (which the edge overwrites, unlike XFF).
 *   3. `'anon'` — one SHARED bucket. Anonymous callers throttle each
 *      other, which is coarse; it is deliberately not "one bucket per
 *      caller-supplied string", which throttles nobody.
 */

/**
 * Resolves the peer address of a request from whatever the host runtime
 * knows about the connection. Return `null`/`undefined` when unknown.
 */
export type ClientAddressResolver = (req: Request) => string | null | undefined

export type ClientIpOptions = {
  /**
   * Number of TRUSTED reverse proxies between the client and this
   * server. `0`/`false` (the default) trusts no forwarding header at
   * all; `true` means one. Set this only when a proxy you control is
   * guaranteed to be in the path — declaring proxies that are not there
   * makes an attacker-supplied hop readable again.
   */
  trustProxy?: boolean | number
  /**
   * Peer address supplied by the host runtime. Preferred over the
   * `'anon'` fallback, and used ahead of nothing else: behind a trusted
   * proxy the socket address is the PROXY's — identical for every
   * client — so the forwarded chain wins when `trustProxy` is set.
   */
  clientAddress?: ClientAddressResolver
}

const SHARED_ANONYMOUS_BUCKET = 'anon'

function trustedHopCount(trustProxy: boolean | number | undefined): number {
  if (trustProxy === true) return 1
  if (typeof trustProxy === 'number' && Number.isFinite(trustProxy)) {
    return Math.max(0, Math.floor(trustProxy))
  }
  return 0
}

/**
 * Best-effort client IP for a request. See the module header for the
 * ordering and why the default trusts no forwarding header.
 */
export function clientIpOf(req: Request, opts: ClientIpOptions = {}): string {
  const hops = trustedHopCount(opts.trustProxy)

  if (hops > 0) {
    const chain = (req.headers.get('x-forwarded-for') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    if (chain.length > 0) {
      // With `hops` trusted proxies the last `hops` entries were written
      // by them; index `length - hops` is the address the outermost
      // trusted proxy saw. A chain SHORTER than that means every entry
      // was trusted-written, so its leftmost is the real client.
      const idx = Math.max(0, chain.length - hops)
      const hop = chain[idx]
      if (hop) return hop
    }
    // `X-Real-IP` carries a single value written by the immediate proxy,
    // so it is readable under the same declaration — but only when no
    // chain was present, since the chain is the richer signal.
    const real = req.headers.get('x-real-ip')?.trim()
    if (real) return real
  }

  const peer = opts.clientAddress?.(req)?.trim()
  if (peer) return peer

  return SHARED_ANONYMOUS_BUCKET
}

/**
 * Bind {@link clientIpOf} to one deployment's trust configuration. The
 * server core builds exactly one of these and threads it into every
 * surface that keys a limiter on a caller address, so mint and the MCP
 * endpoint can never disagree about what is trustworthy.
 */
export function createClientIpResolver(opts: ClientIpOptions = {}): (req: Request) => string {
  return (req) => clientIpOf(req, opts)
}
