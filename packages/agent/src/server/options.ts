import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { TokenStore } from './token-store.js'
import type { IdentityResolver } from './identity.js'
import type { AuditSink } from './audit.js'
import type { RateLimiter } from './rate-limit.js'
import type { PairingRegistry } from './ws/pairing-registry.js'
import type { AcceptResult } from './core.js'
import type { PairingConnection } from './ws/pairing-registry.js'
import type { McpRouterOptions } from './mcp/router.js'

export type { McpRouterOptions }

/**
 * Options accepted by `createLluiAgentServer`. All values are
 * optional and fall back to in-memory defaults. See spec §10.1.
 *
 * Pre-0.0.35 this required a `signingKey` for HMAC-signed JWT tokens.
 * The new opaque-token scheme (token.ts) doesn't sign anything — the
 * server stores the SHA-256 hash and looks tokens up. The option is
 * gone; existing config that passed `signingKey` should drop it.
 */
export type ServerOptions = {
  /** Token store. Defaults to an `InMemoryTokenStore`. */
  tokenStore?: TokenStore

  /**
   * Identity resolver. Defaults to one that always resolves `null`
   * (unauthenticated). With the default resolver and `allowAnonymous`
   * left `false`, `/agent/mint` fails closed — see `allowAnonymous`.
   */
  identityResolver?: IdentityResolver

  /**
   * Allow minting remote-control tokens for unauthenticated callers
   * (identity resolves to `null`).
   *
   * SECURITY: defaults to `false`. When false, `/agent/mint` rejects
   * with 401 unless the identity resolver returns a real uid, so a
   * deployment without a configured resolver does NOT let any anonymous
   * visitor mint a token. Set `true` only for apps that deliberately
   * allow anonymous agent pairing.
   */
  allowAnonymous?: boolean

  /** Audit sink. Defaults to `consoleAuditSink`. */
  auditSink?: AuditSink

  /** Rate limiter. Defaults to `defaultRateLimiter` with 30/minute. */
  rateLimiter?: RateLimiter

  /** Base path prefix for LAP endpoints. Defaults to `/agent/lap/v1`. */
  lapBasePath?: string

  /**
   * Grace window, in ms, during which a closed pairing can re-pair with
   * the same bearer token without going through the rotate-on-resume
   * (`/resume/claim`) path. Wired to the core's pending-resume grace.
   * Default 60 s; `0` opts out (a WS close immediately requires a
   * rotated token to reconnect).
   */
  pairingGraceMs?: number

  /**
   * Sliding (inactivity) TTL for tokens, in ms. A token whose
   * `lastSeenAt + slidingTtlMs` is in the past is treated as expired on
   * the next verify — on every LAP/MCP call AND on the WebSocket
   * upgrade — even though its hard expiry hasn't elapsed. Caps the live
   * window of a leaked-but-idle bearer.
   *
   * SECURITY-relevant: undefined / `0` disables the sliding check (the
   * hard `expiresAt` ceiling still applies). Set a value to enforce
   * inactivity expiry.
   */
  slidingTtlMs?: number

  /**
   * Allowed `Origin` values for the WebSocket upgrade (CSWSH defense).
   *
   * When set, a browser-issued WS upgrade whose `Origin` is not in this
   * list is rejected with 403 before the handshake completes. When
   * unset, the upgrade defaults to same-origin (the request `Origin`
   * must equal the server's own origin). Requests with NO `Origin`
   * header (non-browser clients) are always allowed, since CSWSH
   * requires a browser-supplied Origin.
   */
  corsOrigins?: readonly string[]

  /**
   * Enable the server-side MCP endpoint at `/agent/mcp` (or a custom
   * path). When set, Claude Desktop can connect directly to the app
   * backend without installing the `llui-agent` bridge — the user pastes
   * the token via `connect_session` in chat, same flow as the bridge but
   * no separate process required.
   *
   * Pass `true` to use all defaults, or an `McpRouterOptions` object to
   * customise the path, server name, and connect_session description.
   */
  mcp?: boolean | McpRouterOptions
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
