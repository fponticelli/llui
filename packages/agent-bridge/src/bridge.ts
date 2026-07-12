import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { TOOL_DESCRIPTORS, type ToolDescriptor } from './tools.js'
import { BindingMap, type Binding } from './binding.js'
import { forwardLap } from './forwarder.js'
import {
  okResult,
  errorResult,
  executeForwardedTool,
  executeConnect,
  detectSchemaChange,
  type LapCaller,
  type DescribeCache,
} from '@llui/agent/mcp/executor'
import { registerPrompts } from './prompts.js'

// Re-exported so the bridge's unit tests (and any downstream) can reach
// the schemaHash-invalidation policy at its historical import site. The
// implementation now lives once in the shared executor.
export { detectSchemaChange }

export type BridgeDeps = {
  /** Injectable for tests. */
  fetch?: typeof fetch
  /** MCP session ID for this client. In stdio mode there's one session; derive from the Server instance. */
  sessionId: string
  /** Shared binding map (one BindingMap per process). */
  bindings: BindingMap
  /** Package version — set from package.json at boot. */
  version: string
}

/**
 * Builds the bridge's MCP server using the high-level `McpServer`
 * registrars. Each tool's Zod schema (declared once in `tools.ts`)
 * drives both runtime input validation and the JSON Schema published
 * to `tools/list` — eliminating the hand-written-schema-vs-handler
 * drift that the low-level `setRequestHandler` pattern is prone to.
 *
 * Forwarded tools (`kind: 'forward'`) share the `@llui/agent/mcp/executor`
 * dispatch — the same code the server-side MCP runs — so describe
 * caching, schemaHash invalidation, and error shaping behave identically
 * across both surfaces. The two meta tools (`connect_session`,
 * `disconnect_session`) carry custom handlers that mutate the BindingMap
 * directly, then delegate to the shared connect prefetch.
 */
export function createBridgeServer(deps: BridgeDeps): McpServer {
  const server = new McpServer(
    { name: 'llui-agent', version: deps.version },
    { capabilities: { tools: {}, prompts: {} } },
  )

  for (const desc of TOOL_DESCRIPTORS) {
    registerToolDescriptor(server, deps, desc)
  }

  registerPrompts(server)

  return server
}

/** LAP caller bound to a live binding — POSTs over HTTP via `forwardLap`. */
function callerFor(deps: BridgeDeps, binding: Binding): LapCaller {
  return (path, args) => forwardLap(binding.url, binding.token, path, args, { fetch: deps.fetch })
}

/** Per-session describe cache backed by the BindingMap. */
function cacheFor(deps: BridgeDeps): DescribeCache {
  return {
    get: () => deps.bindings.get(deps.sessionId)?.describe ?? null,
    set: (d) => deps.bindings.setDescribe(deps.sessionId, d),
  }
}

function registerToolDescriptor(server: McpServer, deps: BridgeDeps, desc: ToolDescriptor): void {
  if (desc.kind === 'meta') {
    if (desc.name === 'connect_session') {
      registerConnectSession(server, deps, desc)
    } else if (desc.name === 'disconnect_session') {
      registerDisconnectSession(server, deps, desc)
    }
    return
  }
  registerForwardedTool(server, deps, desc)
}

function registerConnectSession(server: McpServer, deps: BridgeDeps, desc: ToolDescriptor): void {
  server.registerTool(
    desc.name,
    { description: desc.description, inputSchema: desc.schema.shape },
    async (args) => {
      const { url, token } = args as { url: string; token: string }
      deps.bindings.set(deps.sessionId, url, token)
      const binding = deps.bindings.get(deps.sessionId)
      if (!binding) return errorResult('connect_session failed: binding lost')
      // Validate + prefetch the /observe bootstrap bundle and cache the
      // description — shared with the server-side MCP.
      return executeConnect(callerFor(deps, binding), cacheFor(deps), () =>
        deps.bindings.clear(deps.sessionId),
      )
    },
  )
}

function registerDisconnectSession(
  server: McpServer,
  deps: BridgeDeps,
  desc: ToolDescriptor,
): void {
  server.registerTool(
    desc.name,
    { description: desc.description, inputSchema: desc.schema.shape },
    async () => {
      deps.bindings.clear(deps.sessionId)
      return okResult({ status: 'disconnected' })
    },
  )
}

function registerForwardedTool(
  server: McpServer,
  deps: BridgeDeps,
  desc: Extract<ToolDescriptor, { kind: 'forward' }>,
): void {
  server.registerTool(
    desc.name,
    { description: desc.description, inputSchema: desc.schema.shape },
    async (args) => {
      const binding = deps.bindings.get(deps.sessionId)
      if (!binding) {
        return errorResult(
          'not bound — ask the user to copy the connect snippet from the LLui app, ' +
            "or call the LLui MCP server's `connect_session` tool with the url and token they provide. " +
            '(In Claude Code the tool is namespaced as `mcp__<server>__connect_session` and may be deferred. ' +
            'In Claude Desktop, the snippet is also available as the slash command `/llui-connect`.)',
        )
      }
      return executeForwardedTool(
        desc,
        (args ?? {}) as Record<string, unknown>,
        callerFor(deps, binding),
        cacheFor(deps),
      )
    },
  )
}
