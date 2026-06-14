/**
 * Cross-Site WebSocket Hijacking (CSWSH) defense for the LAP WebSocket
 * upgrade surface.
 *
 * A WebSocket handshake is an ordinary cross-origin GET that is NOT
 * subject to the same-origin policy or CORS preflight. A malicious page
 * a logged-in user visits can therefore open `wss://app/agent/ws` with
 * the victim's ambient credentials unless the server validates the
 * `Origin` header itself. We do exactly that here, before handing the
 * socket to `handleUpgrade` / `acceptConnection`.
 *
 * Semantics:
 *
 *   - **No `Origin` header** → allow. Browsers always send `Origin` on a
 *     WebSocket handshake; a non-browser client (the `ws` library, a
 *     CLI, a server-to-server bridge) sends none. CSWSH requires a
 *     browser-driven cross-origin request, so an absent Origin can't be
 *     a CSWSH attack and must keep working for legitimate non-browser
 *     callers.
 *   - **`corsOrigins` configured** → the request `Origin` must be a
 *     member of the allowlist (exact string match), otherwise reject.
 *   - **`corsOrigins` not configured** → default to same-origin: the
 *     request `Origin` must equal the server's own origin (derived from
 *     the upgrade request URL).
 */

/** Outcome of an origin check. `reason` is for audit/diagnostics only. */
export type OriginCheck = { ok: true } | { ok: false; reason: string }

/**
 * Validate a WebSocket-upgrade `Origin` against an allowlist (or, when
 * none is configured, the server's own origin).
 *
 * @param origin       The request's `Origin` header value, or `null`
 *                     when the header is absent (non-browser client).
 * @param selfOrigin   The server's own origin (scheme + host + port),
 *                     used as the same-origin fallback when no allowlist
 *                     is configured.
 * @param corsOrigins  Optional explicit allowlist. When provided and
 *                     non-empty, only these origins are accepted.
 */
export function checkWsOrigin(
  origin: string | null | undefined,
  selfOrigin: string,
  corsOrigins?: readonly string[],
): OriginCheck {
  // No Origin header → non-browser client → not a CSWSH vector.
  if (origin === null || origin === undefined || origin === '') return { ok: true }

  if (corsOrigins && corsOrigins.length > 0) {
    if (corsOrigins.includes(origin)) return { ok: true }
    return { ok: false, reason: `origin ${origin} not in allowlist` }
  }

  // Default: same-origin only.
  if (origin === selfOrigin) return { ok: true }
  return { ok: false, reason: `cross-origin ${origin} (expected ${selfOrigin})` }
}
