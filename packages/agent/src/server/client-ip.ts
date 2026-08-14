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
 *      END, never the first — and the chain has to be at least `n` long
 *      to have come through them at all (see below).
 *   2. `clientAddress` — a host-supplied peer (socket) address. Not
 *      derivable from a WHATWG `Request`, so the host has to pass it:
 *      Node from `socket.remoteAddress`, Cloudflare from
 *      `cf-connecting-ip` (which the edge overwrites, unlike XFF).
 *   3. `'anon'` — one SHARED bucket. Anonymous callers throttle each
 *      other, which is coarse; it is deliberately not "one bucket per
 *      caller-supplied string", which throttles nobody.
 *
 * ── WHAT `trustProxy: n` ASSERTS, AND WHY IT IS ONLY ABOUT XFF ─────
 * Declaring `n` proxies asserts that `n` proxies you control are in the
 * path AND that each of them APPENDS to `X-Forwarded-For`. Everything
 * here follows from that one statement, so both of its failure modes
 * are refusals rather than guesses:
 *
 *   - A chain SHORTER than `n` did not pass through `n` appending
 *     proxies, so nothing in it is evidence. It used to be clamped to
 *     index 0 and returned, which handed a direct caller a fresh bucket
 *     per request under any `n > 1` (measured: `trustProxy: 2`, 60
 *     single-entry chains, 60 buckets).
 *   - NO chain, under the same declaration, is the same violation.
 *     `X-Real-IP` used to be read there, which made the declaration
 *     bypassable by simply omitting `X-Forwarded-For` (measured:
 *     `trustProxy: 1`, 60 varied `X-Real-IP` values, 60 buckets). It is
 *     never read now: it is SET rather than appended, so unlike a chain
 *     it carries no structure that says a proxy wrote it.
 *
 * A deployment behind a proxy that writes only `X-Real-IP` — nginx with
 * `proxy_set_header X-Real-IP` and no `X-Forwarded-For`, a common
 * config — is therefore NOT covered by `trustProxy`. It says so with
 * `clientAddress: (req) => req.headers.get('x-real-ip')`, the same
 * explicit deployment statement Cloudflare's `cf-connecting-ip` uses.
 *
 * What remains, unavoidably: a chain of exactly `n` entries is what a
 * direct client behind `n` appending proxies produces AND what a caller
 * who spoofs `n` entries produces, and no property of the request tells
 * them apart. `trustProxy` is trusted input; declare it only for
 * proxies that are really there and really append.
 */

/**
 * Resolves the peer address of a request from whatever the host runtime
 * knows about the connection. Return `null`/`undefined` when unknown.
 */
export type ClientAddressResolver = (req: Request) => string | null | undefined

export type ClientIpOptions = {
  /**
   * Number of TRUSTED reverse proxies between the client and this
   * server, each of which APPENDS to `X-Forwarded-For`. `0`/`false`
   * (the default) trusts no forwarding header at all; `true` means one.
   *
   * Set this only when proxies you control are guaranteed to be in the
   * path AND to write that header: declaring proxies that are not there
   * makes a caller-supplied hop readable again, and declaring one that
   * writes only `X-Real-IP` reads nothing at all (use `clientAddress`
   * for that deployment).
   */
  trustProxy?: boolean | number
  /**
   * Peer address supplied by the host runtime. Preferred over the
   * `'anon'` fallback, and used ahead of nothing else: behind a trusted
   * proxy the socket address is the PROXY's — identical for every
   * client — so a usable forwarded chain wins when `trustProxy` is set.
   *
   * This is also the hook for a proxy header this module will not trust
   * on its own — `(req) => req.headers.get('cf-connecting-ip')`, or
   * `x-real-ip` behind an nginx that sets it. Naming the header here
   * makes it a deployment statement instead of a guess.
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
    // With `hops` trusted proxies the last `hops` entries were written
    // by them; index `length - hops` is the address the outermost
    // trusted proxy saw. A chain shorter than `hops` did not come
    // through them, so it is caller-written in full and is dropped
    // rather than clamped — and no forwarding header is consulted after
    // it. See the module header for both measurements.
    if (chain.length >= hops) {
      const hop = chain[chain.length - hops]
      if (hop) return hop
    }
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
