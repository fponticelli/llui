/**
 * Default entry for Node server processes. Bundles the runtime-neutral
 * core with a `ws`-library-based WebSocket upgrade handler. For web
 * runtimes (Cloudflare Workers, Deno, Bun) where `ws` isn't
 * available, use `@llui/agent/server/core` + `@llui/agent/server/web`
 * instead.
 */
export { createLluiAgentServer } from './factory.js'
export type { ServerOptions, AgentServerHandle } from './options.js'
// Runtime-neutral core — re-exported so Node users don't need a second import.
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
export { mintToken, tokenHashOf } from './token.js'
export type { VerifyResult } from './token.js'
