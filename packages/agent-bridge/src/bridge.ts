import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { TOOL_DESCRIPTORS, type ToolDescriptor } from './tools.js'
import { BindingMap } from './binding.js'
import { forwardLap } from './forwarder.js'
import type { LapDescribeResponse, LapObserveResponse } from '@llui/agent/protocol'
import { registerPrompts } from './prompts.js'

/**
 * Compare a freshly-fetched app description against the cached one and
 * decide whether the bridge's cached schema is now stale. A changed
 * `schemaHash` means the app's Msg/State schema was recompiled — cached
 * affordances/examples/payload shapes may no longer be valid, so the
 * caller is told to re-read before dispatching. Exported so the
 * invalidation policy is unit-testable without wiring an MCP transport.
 */
export function detectSchemaChange(
  prev: LapDescribeResponse | null,
  next: Pick<LapDescribeResponse, 'schemaHash'>,
): { changed: boolean; note: string | null } {
  if (prev === null || prev.schemaHash === next.schemaHash) {
    return { changed: false, note: null }
  }
  return {
    changed: true,
    note:
      `App schema changed (was ${prev.schemaHash}, now ${next.schemaHash}). ` +
      `The previously cached description is stale — re-read actions/description ` +
      `before dispatching, as payload shapes and affordances may have changed.`,
  }
}

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
 * Forwarded tools (`kind: 'forward'`) share a generic forwarder that
 * looks up the binding, dispatches to LAP, and caches description
 * payloads where applicable. The two meta tools
 * (`connect_session`, `disconnect_session`) carry custom
 * handlers that mutate the BindingMap directly.
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
      // Validate AND prefetch the bootstrap bundle in one call.
      // /observe returns {state, actions, description, context} —
      // exactly what the LLM needs to start acting. Without this,
      // Claude has to follow up with `observe` to get anything
      // usable, costing round-trips and creating a window where
      // the connect tool's "you are now connected" result is the
      // entire context the LLM has to reason about.
      const res = await forwardLap(url, token, '/observe', {}, { fetch: deps.fetch })
      if (!res.ok) {
        deps.bindings.clear(deps.sessionId)
        return errorResult(`connect failed: ${JSON.stringify(res.error)}`)
      }
      const observe = res.body as LapObserveResponse
      deps.bindings.setDescribe(deps.sessionId, observe.description)
      return okResult({
        status: 'connected',
        appName: observe.description.name,
        appVersion: observe.description.version,
        // Full observe payload — same shape the `observe` tool returns —
        // so a `describe_app` / `get_state` / `list_actions` /
        // `describe_context` follow-up is unnecessary on the first turn.
        state: observe.state,
        actions: observe.actions,
        description: observe.description,
        context: observe.context,
      })
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

      // describe_app can serve from cache when one is available.
      if (desc.name === 'describe_app' && binding.describe) {
        return okResult(binding.describe)
      }

      const res = await forwardLap(binding.url, binding.token, desc.lapPath, args ?? {}, {
        fetch: deps.fetch,
      })
      if (!res.ok) {
        return errorResult(
          `LAP ${desc.lapPath} failed: status=${res.status} ${JSON.stringify(res.error)}`,
        )
      }

      // Cache describe_app responses after the first call too. (Only
      // reached on a cache miss — a warm cache short-circuits above — so
      // there's no prior hash to diff against, but route it through the
      // same detector for uniformity/future-proofing.)
      if (desc.name === 'describe_app') {
        const d = res.body as LapDescribeResponse
        const change = detectSchemaChange(binding.describe, d)
        deps.bindings.setDescribe(deps.sessionId, d)
        if (change.changed) {
          return okResult({ ...(d as object), schemaChanged: true, schemaChangedNote: change.note })
        }
      }

      // observe returns description on every call; it's the invalidation
      // path for the describe cache. Diff the incoming schemaHash against
      // the cached one, replace the cache, and surface a note when the
      // app's schema changed under a live session so the LLM re-reads
      // before trusting stale affordances.
      if (desc.name === 'observe') {
        const obs = res.body as LapObserveResponse
        if (obs?.description) {
          const change = detectSchemaChange(binding.describe, obs.description)
          deps.bindings.setDescribe(deps.sessionId, obs.description)
          if (change.changed) {
            return okResult({
              ...(obs as object),
              schemaChanged: true,
              schemaChangedNote: change.note,
            })
          }
        }
      }

      return okResult(res.body)
    },
  )
}

function okResult(body: unknown): CallToolResult {
  // structuredContent is what current Claude clients (Desktop + CC)
  // consume preferentially when present — typed JSON instead of a
  // stringified blob. The `content` array stays as a `text` fallback
  // so older clients still see something sensible.
  return {
    structuredContent: body as Record<string, unknown>,
    content: [{ type: 'text', text: JSON.stringify(body) }],
  }
}

function errorResult(msg: string): CallToolResult {
  return {
    content: [{ type: 'text', text: msg }],
    isError: true,
  }
}
