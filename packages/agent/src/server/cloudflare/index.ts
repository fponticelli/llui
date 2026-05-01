/**
 * Cloudflare Workers + Durable Object adapter. Use this sub-path
 * from a Cloudflare Workers project where the agent pairing state
 * lives inside a Durable Object.
 *
 * See the full deployment recipe at
 * https://llui.dev/api/agent#cloudflare-deployment — the short
 * version:
 *
 * ```ts
 * import {
 *   AgentPairingDurableObject,
 *   routeToAgentDO,
 *   makeDurableObjectUserInputStorage,
 * } from '@llui/agent/server/cloudflare'
 *
 * export class AgentDO {
 *   private agent: AgentPairingDurableObject
 *   constructor(state: DurableObjectState, _env: Env) {
 *     // Tokens are opaque (see token.ts) — no signing key needed.
 *     // The storage adapter makes the chat-composer's user-input
 *     // buffer survive DO eviction (deploys, idle eviction, runtime
 *     // restarts) — buffered messages from before the eviction are
 *     // restored on the next request.
 *     this.agent = new AgentPairingDurableObject({
 *       userInputStorage: makeDurableObjectUserInputStorage(state.storage),
 *     })
 *   }
 *   fetch(req: Request) {
 *     return this.agent.fetch(req)
 *   }
 * }
 *
 * export default {
 *   async fetch(req: Request, env: Env) {
 *     return routeToAgentDO(req, env.AGENT_DO, async (token) => {
 *       const stub = env.AGENT_DO.get(env.AGENT_DO.idFromName('__root'))
 *       const r = await stub.fetch(`http://internal/__resolve?token=${encodeURIComponent(token)}`)
 *       const body = (await r.json()) as { tid: string | null }
 *       return body.tid
 *     })
 *   },
 * }
 * ```
 *
 * `wrangler.toml`:
 * ```toml
 * [[durable_objects.bindings]]
 * name = "AGENT_DO"
 * class_name = "AgentDO"
 *
 * [[migrations]]
 * tag = "v1"
 * new_classes = ["AgentDO"]
 * ```
 */
export {
  AgentPairingDurableObject,
  type DurableObjectOptions,
  makeDurableObjectUserInputStorage,
  type DurableObjectStorageLike,
} from './durable-object.js'
export {
  routeToAgentDO,
  type MinimalDurableObjectNamespace,
  type MinimalDurableObjectId,
  type MinimalDurableObjectStub,
} from './worker.js'
export {
  createWHATWGPairingConnection,
  handleCloudflareUpgrade,
  extractToken,
} from '../web/index.js'
