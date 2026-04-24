/**
 * Runtime-neutral entry point. Import from `@llui/agent/server/core`
 * when targeting runtimes without the Node `ws` library (Cloudflare
 * Workers, Deno, Bun, Deno Deploy). Pair with
 * `@llui/agent/server/web` for WebSocket upgrade helpers.
 *
 * Node/standard server processes should keep using the default
 * `@llui/agent/server` entry, which includes this plus the `ws`-based
 * upgrade handler.
 */
export { createLluiAgentCore } from './core.js'
export type { CoreOptions, AgentCoreHandle, AcceptResult } from './core.js'
export { InMemoryPairingRegistry } from './ws/pairing-registry.js'
export type { PairingConnection, PairingRegistry, FrameSubscriber } from './ws/pairing-registry.js'
export { rpc, waitForConfirm, waitForChange } from './ws/rpc.js'
export type { RpcOptions, RpcError } from './ws/rpc.js'
export { InMemoryTokenStore } from './token-store.js'
export type { TokenStore } from './token-store.js'
export { defaultIdentityResolver, signCookieValue } from './identity.js'
export type { IdentityResolver } from './identity.js'
export { consoleAuditSink } from './audit.js'
export type { AuditSink } from './audit.js'
export { defaultRateLimiter } from './rate-limit.js'
export type { RateLimiter } from './rate-limit.js'
export { signToken, verifyToken } from './token.js'
export type { TokenPayload, VerifyResult } from './token.js'
