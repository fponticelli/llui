import type { TokenStore } from './token-store.js'
import type { IdentityResolver } from './identity.js'
import type { AuditSink } from './audit.js'
import type { RateLimiter } from './rate-limit.js'

/**
 * Options accepted by `createLluiAgentServer`. All values except
 * `signingKey` are optional and fall back to in-memory defaults.
 * See spec §10.1.
 */
export type ServerOptions = {
  /** HMAC key for signing tokens. ≥32 bytes; rotation invalidates all tokens. */
  signingKey: string | Uint8Array

  /** Token store. Defaults to an `InMemoryTokenStore`. */
  tokenStore?: TokenStore

  /** Identity resolver. Defaults to anonymous (always null). */
  identityResolver?: IdentityResolver

  /** Audit sink. Defaults to `consoleAuditSink`. */
  auditSink?: AuditSink

  /** Rate limiter. Defaults to `defaultRateLimiter` with 30/minute. */
  rateLimiter?: RateLimiter

  /** Base path prefix for LAP endpoints. Defaults to `/agent/lap/v1`. */
  lapBasePath?: string

  /** Pairing grace window after a tab closes, in ms. Default 15 min. */
  pairingGraceMs?: number

  /** Sliding TTL for active tokens, in ms. Default 1 h. */
  slidingTtlMs?: number

  /** Allowed origins for the HTTP surface (CORS). Empty = any. */
  corsOrigins?: readonly string[]
}

/**
 * Value returned by `createLluiAgentServer`. `router` matches any
 * `/agent/*` request and returns a Response (or null to fall through).
 * `wsUpgrade` lands in Plan 5.
 */
export type AgentServerHandle = {
  router: (req: Request) => Promise<Response | null>
}
