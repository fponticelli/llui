import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type ListToolsResult,
} from '@modelcontextprotocol/sdk/types.js'
import { TOOLS, TOOL_TO_LAP_PATH } from './tools.js'
import { BindingMap } from './binding.js'
import { forwardLap } from './forwarder.js'
import type { LapDescribeResponse, LapObserveResponse } from '@llui/agent/protocol'
import { registerPrompts } from './prompts.js'

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

export function createBridgeServer(deps: BridgeDeps): McpServer {
  const server = new McpServer(
    { name: 'llui-agent', version: deps.version },
    { capabilities: { tools: {}, prompts: {} } },
  )

  server.setRequestHandler(
    ListToolsRequestSchema,
    async (): Promise<ListToolsResult> => ({
      tools: TOOLS,
    }),
  )

  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
    const { name, arguments: args = {} } = req.params

    if (name === 'llui_connect_session') {
      const { url, token } = args as { url?: string; token?: string }
      if (typeof url !== 'string' || typeof token !== 'string') {
        return errorResult('invalid: url and token required')
      }
      deps.bindings.set(deps.sessionId, url, token)
      // Validate AND prefetch the full bootstrap bundle in one call.
      // /observe returns {state, actions, description, context} — exactly
      // what the LLM needs to start acting. Without this, Claude has to
      // follow up with `observe` (or worse, the legacy
      // `list_actions` + `describe_visible_content` pair) to get
      // anything usable, which costs round-trips and introduces a
      // window where the connect tool's "you are now connected" result
      // is the entire context the LLM has to reason about.
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
    }

    if (name === 'llui_disconnect_session') {
      deps.bindings.clear(deps.sessionId)
      return okResult({ status: 'disconnected' })
    }

    // Forwarded tools
    const binding = deps.bindings.get(deps.sessionId)
    if (!binding) {
      return errorResult('not bound — ask the user to run /llui-connect <url> <token> first')
    }

    // describe_app can serve from cache
    if (name === 'describe_app' && binding.describe) {
      return okResult(binding.describe)
    }

    const lapPath = TOOL_TO_LAP_PATH[name]
    if (!lapPath) return errorResult(`unknown tool: ${name}`)

    const res = await forwardLap(binding.url, binding.token, lapPath, args, { fetch: deps.fetch })
    if (!res.ok) {
      return errorResult(`LAP ${lapPath} failed: status=${res.status} ${JSON.stringify(res.error)}`)
    }

    // Cache describe_app responses after the first call too
    if (name === 'describe_app') {
      deps.bindings.setDescribe(deps.sessionId, res.body as LapDescribeResponse)
    }

    // observe returns description on every call; cache it so a later
    // describe_app hit can serve from cache and short-circuit the LAP
    // round-trip.
    if (name === 'observe') {
      const obs = res.body as LapObserveResponse
      if (obs?.description) deps.bindings.setDescribe(deps.sessionId, obs.description)
    }

    return okResult(res.body)
  })

  registerPrompts(server)

  return server
}

function okResult(body: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(body) }],
  }
}

function errorResult(msg: string): CallToolResult {
  return {
    content: [{ type: 'text', text: msg }],
    isError: true,
  }
}
