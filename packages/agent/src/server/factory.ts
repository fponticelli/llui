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
  const core = createLluiAgentCore(opts)

  const wsUpgrade = createWsUpgradeHandler({
    tokenStore: core.tokenStore,
    registry: core.registry,
    auditSink: core.auditSink,
  })

  const lapBasePath = opts.lapBasePath ?? '/agent/lap/v1'

  let router = core.router
  if (opts.mcp) {
    const mcpOpts = opts.mcp === true ? {} : opts.mcp
    const mcpRouter = createMcpRouter(
      { coreRouter: core.router, tokenStore: core.tokenStore, lapBasePath },
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
