/**
 * Web-runtime adapters. Use this sub-path from Cloudflare Workers,
 * Deno, Bun, or any other runtime that speaks WHATWG `Request` /
 * `Response` and exposes native WebSocket upgrade primitives.
 *
 * Pair with `@llui/agent/server/core`'s `createLluiAgentCore` — that
 * builds the runtime-neutral router and registry; the handlers
 * exported here handle the WebSocket upgrade half.
 */
export { createWHATWGPairingConnection } from './adapter.js'
export { handleCloudflareUpgrade, handleDenoUpgrade, extractToken } from './upgrade.js'
