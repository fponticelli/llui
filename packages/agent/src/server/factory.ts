import type { ServerOptions, AgentServerHandle } from './options.js'
import { createLluiAgentCore } from './core.js'
import { createWsUpgradeHandler } from './ws/upgrade.js'
import { createMcpRouter } from './mcp/router.js'

/**
 * Node adapter. Wraps the runtime-neutral core with a Node-specific
 * `wsUpgrade` handler that uses the `ws` library. Imports `ws`
 * eagerly, so this module only works where `ws` is available — use
 * `@llui/agent/server/web` for Cloudflare Workers, Deno, or other
 * WHATWG runtimes.
 *
 * Spec §10.1, §10.4.
 */
export function createLluiAgentServer(opts: ServerOptions = {}): AgentServerHandle {
  // `pairingGraceMs` is the public name for the core's pending-resume
  // grace window; map it through here so the option isn't dead.
  const core = createLluiAgentCore({
    ...opts,
    pendingResumeGraceMs: opts.pairingGraceMs,
  })

  const wsUpgrade = createWsUpgradeHandler({
    acceptConnection: core.acceptConnection,
    corsOrigins: core.allowedOrigins,
  })

  const lapBasePath = opts.lapBasePath ?? '/agent/lap/v1'

  let router = core.router
  if (opts.mcp) {
    const mcpOpts = opts.mcp === true ? {} : opts.mcp
    const mcpRouter = createMcpRouter(
      {
        coreRouter: core.router,
        tokenStore: core.tokenStore,
        lapBasePath,
        slidingTtlMs: core.slidingTtlMs,
      },
      mcpOpts,
    )
    router = async (req) => {
      const mcpRes = await mcpRouter(req)
      if (mcpRes) return mcpRes
      return core.router(req)
    }
  }

  return {
    router,
    wsUpgrade,
    registry: core.registry,
    tokenStore: core.tokenStore,
    auditSink: core.auditSink,
    acceptConnection: core.acceptConnection,
  }
}
