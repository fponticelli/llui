import type { TokenRecord } from '../protocol.js'

/**
 * Sliding-TTL (inactivity) expiry check.
 *
 * A token's `expiresAt` is a HARD ceiling — the longest a token can
 * ever live. The sliding TTL is a softer, inactivity-based expiry: a
 * token that hasn't been seen for `slidingTtlMs` is treated as expired
 * even though its hard expiry is still in the future. This caps the
 * blast radius of a leaked-but-idle bearer: an abandoned token a remote
 * controller is no longer touching stops authenticating long before its
 * 24h hard expiry, instead of staying live for the full window.
 *
 * `lastSeenAt` is bumped on every authenticated touch (mint, WS
 * connect, and the LAP `touch` path), so an actively-used token never
 * trips this check.
 *
 * Returns `false` when `slidingTtlMs` is unset or non-positive — the
 * feature is opt-in via the server option, and `0`/undefined disables
 * it (hard expiry still applies).
 */
export function isSlidingTtlExpired(
  rec: Pick<TokenRecord, 'lastSeenAt'>,
  slidingTtlMs: number | undefined,
  now: number,
): boolean {
  if (slidingTtlMs === undefined || slidingTtlMs <= 0) return false
  return rec.lastSeenAt + slidingTtlMs < now
}
