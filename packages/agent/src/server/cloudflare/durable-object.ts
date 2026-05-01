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
 *     // Tokens are opaque (see token.ts) — no signing key needed.
 *     this.agent = new AgentPairingDurableObject({})
 *   }
 *   fetch(req: Request): Promise<Response> {
 *     return this.agent.fetch(req)
 *   }
 * }
 *
 * export default {
 *   async fetch(req: Request, env: Env): Promise<Response> {
 *     // routeToAgentDO now takes a `resolveTid` callback — typically
 *     // a fetch to the root DO's token-resolution endpoint, or a
 *     // const stub when you don't shard by tid.
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
 * See `./worker.ts` for `routeToAgentDO` and the full wiring.
 */
import type { CoreOptions, AgentCoreHandle } from '../core.js'
import { createLluiAgentCore } from '../core.js'
import { handleCloudflareUpgrade } from '../web/upgrade.js'
import type { UserInputStorage } from '../ws/pairing-registry.js'

export type DurableObjectOptions = Omit<CoreOptions, 'registry'>

/**
 * Minimal subset of the Cloudflare Durable Object `state.storage`
 * surface needed to back the registry's `UserInputStorage` adapter.
 * Declared structurally so we don't pull in `@cloudflare/workers-types`
 * — that's a peer dependency of the host's Worker project, not ours.
 */
export interface DurableObjectStorageLike {
  get<T>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<void>
  delete(key: string): Promise<boolean>
}

/**
 * Build a `UserInputStorage` adapter backed by the DO's `state.storage`.
 * Pass the result to `AgentPairingDurableObject`'s constructor opts to
 * make buffered chat-composer submissions survive DO eviction (process
 * restarts, deploys, idle eviction). Without this adapter the in-memory
 * buffer is lost on eviction; with it, the next request restores any
 * buffered messages from before the eviction.
 *
 * Parked `waitForUserInput` waiters can't be persisted (they're JS
 * Promise resolvers); the LAP client retries naturally on its own
 * timeout, and the retry sees the restored buffer.
 *
 * Usage:
 *
 * ```ts
 * export class AgentDO {
 *   private agent: AgentPairingDurableObject
 *   constructor(state: DurableObjectState) {
 *     this.agent = new AgentPairingDurableObject({
 *       userInputStorage: makeDurableObjectUserInputStorage(state.storage),
 *     })
 *   }
 *   fetch(req: Request) {
 *     return this.agent.fetch(req)
 *   }
 * }
 * ```
 */
export function makeDurableObjectUserInputStorage(
  storage: DurableObjectStorageLike,
): UserInputStorage {
  // One key per tid keeps the operations O(1) and avoids cross-tid
  // contention. Prefix is to namespace from any other agent storage
  // a future feature might add.
  const key = (tid: string) => `__llui_agent_user_input_buf__:${tid}`
  return {
    async read(tid) {
      const stored = await storage.get<Array<{ text: string; at: number }>>(key(tid))
      return stored ?? []
    },
    async write(tid, buffer) {
      await storage.put(key(tid), buffer)
    },
    async clear(tid) {
      await storage.delete(key(tid))
    },
  }
}

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
