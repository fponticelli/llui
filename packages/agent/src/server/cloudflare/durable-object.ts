/**
 * Durable Object helper for hosting the agent pairing + LAP surface
 * on Cloudflare Workers. One DO instance owns one `tid` — its
 * in-memory `PairingRegistry` survives across Worker isolate
 * invocations because the DO IS persistent.
 *
 * This file exports a class designed to be composed into a real
 * Durable Object in the user's Worker project. We intentionally
 * don't subclass `DurableObject` from `@cloudflare/workers-types` —
 * that dependency belongs to the user's project, not ours. Users
 * wrap an instance of `AgentPairingDurableObject` in their own DO
 * class and forward `fetch` to it.
 *
 * Usage in a Worker project:
 *
 * ```ts
 * // worker.ts
 * import { AgentPairingDurableObject } from '@llui/agent/server/cloudflare'
 *
 * export class AgentDO {
 *   private agent: AgentPairingDurableObject
 *   constructor(_state: DurableObjectState, env: Env) {
 *     this.agent = new AgentPairingDurableObject({
 *       signingKey: env.AGENT_SIGNING_KEY,
 *     })
 *   }
 *   fetch(req: Request): Promise<Response> {
 *     return this.agent.fetch(req)
 *   }
 * }
 *
 * export default {
 *   async fetch(req: Request, env: Env): Promise<Response> {
 *     return routeToAgentDO(req, env.AGENT_DO, env.AGENT_SIGNING_KEY)
 *   },
 * }
 * ```
 *
 * See `./worker.ts` for `routeToAgentDO` and the full wiring.
 */
import type { CoreOptions, AgentCoreHandle } from '../core.js'
import { createLluiAgentCore } from '../core.js'
import { handleCloudflareUpgrade } from '../web/upgrade.js'

export type DurableObjectOptions = Omit<CoreOptions, 'registry'>

/**
 * Agent server instance scoped to a single Durable Object. All
 * pairing state lives in the DO's in-process memory — which is safe
 * here because the DO is a persistent addressable entity, not a
 * one-shot Worker isolate.
 *
 * Users instantiate one of these inside their DO class's constructor
 * and delegate `fetch` to `agent.fetch(req)`. LAP HTTP routes and
 * WebSocket upgrades both flow through this single entry.
 */
export class AgentPairingDurableObject {
  readonly agent: AgentCoreHandle

  constructor(opts: DurableObjectOptions) {
    this.agent = createLluiAgentCore(opts)
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)

    // LAP routes (/agent/lap/v1/*, /agent/*). `router` returns null
    // for non-matching paths so we can fall through to the upgrade.
    const lapRes = await this.agent.router(req)
    if (lapRes) return lapRes

    // WebSocket upgrade — uses `WebSocketPair`, which only exists in
    // Cloudflare Workers.
    if (url.pathname === '/agent/ws') {
      return handleCloudflareUpgrade(req, this.agent)
    }

    return new Response('Not Found', { status: 404 })
  }
}
