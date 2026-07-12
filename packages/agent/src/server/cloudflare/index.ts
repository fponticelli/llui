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
 * } from '@llui/agent/server/cloudflare'
 *
 * export class AgentDO {
 *   private agent: AgentPairingDurableObject
 *   constructor(_state: DurableObjectState, env: Env) {
 *     // Tokens are opaque (see token.ts) — no signing key needed.
 *     // SHARDED RECIPE: inject ONE shared TokenStore (a KV/D1-backed
 *     // adapter) into EVERY DO — a token minted on `__root` is otherwise
 *     // invisible to a per-tid DO and `/__resolve` (and every LAP auth
 *     // check) 401s. See AgentPairingDurableObject docs. To avoid a
 *     // shared store entirely, don't shard: route everything through the
 *     // root DO via `resolveTid: () => Promise.resolve('__root')`.
 *     this.agent = new AgentPairingDurableObject({
 *       tokenStore: new KvTokenStore(env.AGENT_KV), // your TokenStore adapter
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
 *       // Bearer in a header (and POST), never the query string — a
 *       // token in the URL lands in Workers logs/traces. Keep
 *       // `__resolve` reachable only via this internal DO stub.
 *       const r = await stub.fetch('http://internal/__resolve', {
 *         method: 'POST',
 *         headers: { authorization: `Bearer ${token}` },
 *       })
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
export { AgentPairingDurableObject, type DurableObjectOptions } from './durable-object.js'
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
