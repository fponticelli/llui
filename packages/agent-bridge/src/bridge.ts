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
import type { LapDescribeResponse } from '@llui/agent/protocol'

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

  server.setRequestHandler(ListToolsRequestSchema, async (): Promise<ListToolsResult> => ({
    tools: TOOLS,
  }))

  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
    const { name, arguments: args = {} } = req.params

    if (name === 'llui_connect_session') {
      const { url, token } = args as { url?: string; token?: string }
      if (typeof url !== 'string' || typeof token !== 'string') {
        return errorResult('invalid: url and token required')
      }
      deps.bindings.set(deps.sessionId, url, token)
      // Validate immediately by pinging /describe
      const res = await forwardLap(url, token, '/describe', {}, { fetch: deps.fetch })
      if (!res.ok) {
        deps.bindings.clear(deps.sessionId)
        return errorResult(`connect failed: ${JSON.stringify(res.error)}`)
      }
      const describe = res.body as LapDescribeResponse
      deps.bindings.setDescribe(deps.sessionId, describe)
      return okResult({
        appName: describe.name,
        appVersion: describe.version,
        status: 'connected',
      })
    }

    if (name === 'llui_disconnect_session') {
      deps.bindings.clear(deps.sessionId)
      return okResult({ status: 'disconnected' })
    }

    // Forwarded tools
    const binding = deps.bindings.get(deps.sessionId)
    if (!binding) {
      return errorResult(
        'not bound — ask the user to run /llui-connect <url> <token> first',
      )
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

    return okResult(res.body)
  })

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
