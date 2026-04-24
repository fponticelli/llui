import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { TokenStore } from './token-store.js'
import type { IdentityResolver } from './identity.js'
import type { AuditSink } from './audit.js'
import type { RateLimiter } from './rate-limit.js'
import type { PairingRegistry } from './ws/pairing-registry.js'
import type { AcceptResult } from './core.js'
import type { PairingConnection } from './ws/pairing-registry.js'

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
 * `wsUpgrade` handles Node HTTP upgrade events for `/agent/ws`.
 */
export type AgentServerHandle = {
  router: (req: Request) => Promise<Response | null>
  /**
   * Handles Node HTTP upgrade events for `/agent/ws`. Returns a Promise
   * because token verification uses WebCrypto (async). Node's
   * `server.on('upgrade', handler)` fires the handler without awaiting,
   * which is fine — the handler writes errors directly to the socket
   * and never throws back to the caller.
   */
  wsUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => Promise<void>
  /** The pairing registry. Runtime-neutral adapters may access it. */
  registry: PairingRegistry
  /** The active token store. */
  tokenStore: TokenStore
  /** The active audit sink. */
  auditSink: AuditSink
  /**
   * Runtime-neutral WebSocket acceptance primitive. Validates a token
   * and registers a `PairingConnection` with the registry. The Node
   * `wsUpgrade` above calls this internally; web-runtime adapters
   * (`@llui/agent/server/web`) use it after accepting a WebSocket via
   * their native API.
   */
  acceptConnection: (token: string, conn: PairingConnection) => Promise<AcceptResult>
}
