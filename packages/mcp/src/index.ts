import type { LluiDebugAPI } from '@llui/dom'

// ── MCP Protocol Types ──────────────────────────────────────────

interface McpToolDefinition {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: Record<string, unknown>
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

// ── Tool Definitions ────────────────────────────────────────────

const TOOLS: McpToolDefinition[] = [
  {
    name: 'llui_get_state',
    description:
      'Get the current state of the LLui component. Returns a JSON-serializable state object.',
    inputSchema: {
      type: 'object',
      properties: {
        component: {
          type: 'string',
          description: 'Component name (defaults to root)',
        },
      },
    },
  },
  {
    name: 'llui_send_message',
    description:
      'Send a message to the component and return the new state and effects. Validates the message first. Calls flush() automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        msg: {
          type: 'object',
          description: 'The message to send (must be a valid Msg variant)',
        },
      },
      required: ['msg'],
    },
  },
  {
    name: 'llui_eval_update',
    description:
      'Dry-run: call update(state, msg) without applying. Returns what the new state and effects would be without modifying the running app.',
    inputSchema: {
      type: 'object',
      properties: {
        msg: {
          type: 'object',
          description: 'The hypothetical message to evaluate',
        },
      },
      required: ['msg'],
    },
  },
  {
    name: 'llui_validate_message',
    description:
      'Validate a message against the component Msg type. Returns errors or null if valid.',
    inputSchema: {
      type: 'object',
      properties: {
        msg: {
          type: 'object',
          description: 'The message to validate',
        },
      },
      required: ['msg'],
    },
  },
  {
    name: 'llui_get_message_history',
    description:
      'Get the chronological message history with state transitions and effects.',
    inputSchema: {
      type: 'object',
      properties: {
        since: {
          type: 'number',
          description: 'Return entries after this index',
        },
      },
    },
  },
  {
    name: 'llui_export_trace',
    description: 'Export the current session as a replayable LluiTrace JSON.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'llui_get_bindings',
    description:
      'Get all active reactive bindings with their masks, last values, and DOM targets.',
    inputSchema: {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          description: 'Filter by DOM selector or mask value',
        },
      },
    },
  },
  {
    name: 'llui_why_did_update',
    description:
      'Explain why a specific binding re-evaluated: which mask bits were dirty, what the accessor returned, what the previous value was.',
    inputSchema: {
      type: 'object',
      properties: {
        bindingIndex: {
          type: 'number',
          description: 'The binding index to inspect',
        },
      },
      required: ['bindingIndex'],
    },
  },
  {
    name: 'llui_search_state',
    description:
      'Search current state using a dot-separated path query. E.g., "cart.items" returns the items array.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Dot-separated path to search. E.g., "user.name", "items"',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'llui_clear_log',
    description: 'Clear the message and effects history.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
]

// ── MCP Server ──────────────────────────────────────────────────

export class LluiMcpServer {
  private debugApi: LluiDebugAPI | null = null
  private wsUrl: string

  constructor(wsUrl = 'ws://127.0.0.1:5173') {
    this.wsUrl = wsUrl
  }

  /** Connect to a debug API instance directly (for in-process usage) */
  connectDirect(api: LluiDebugAPI): void {
    this.debugApi = api
  }

  /** Get tool definitions for MCP handshake */
  getTools(): McpToolDefinition[] {
    return TOOLS
  }

  /** Handle an MCP tool call */
  async handleToolCall(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const api = this.debugApi
    if (!api) {
      throw new Error(
        'Not connected to LLui debug API. Start a dev server first.',
      )
    }

    switch (name) {
      case 'llui_get_state':
        return api.getState()

      case 'llui_send_message': {
        const errors = api.validateMessage(args.msg)
        if (errors) return { errors, sent: false }
        api.send(args.msg)
        api.flush()
        return { state: api.getState(), sent: true }
      }

      case 'llui_eval_update':
        return api.evalUpdate(args.msg)

      case 'llui_validate_message':
        return api.validateMessage(args.msg)

      case 'llui_get_message_history': {
        const history = api.getMessageHistory()
        const since = args.since as number | undefined
        if (since !== undefined) {
          return history.filter((h) => h.index > since)
        }
        return history
      }

      case 'llui_export_trace':
        return api.exportTrace()

      case 'llui_get_bindings':
        return api.getBindings()

      case 'llui_why_did_update':
        return api.whyDidUpdate(args.bindingIndex as number)

      case 'llui_search_state':
        return api.searchState(args.query as string)

      case 'llui_clear_log':
        api.clearLog()
        return { cleared: true }

      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  }

  /** Start the MCP server on stdin/stdout */
  start(): void {
    let buffer = ''

    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk: string) => {
      buffer += chunk
      // MCP uses newline-delimited JSON
      const lines = buffer.split('\n')
      buffer = lines.pop()! // keep incomplete line
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const request = JSON.parse(line) as JsonRpcRequest
          this.handleRequest(request).then((response) => {
            process.stdout.write(JSON.stringify(response) + '\n')
          })
        } catch {
          // Ignore parse errors
        }
      }
    })
  }

  private async handleRequest(
    request: JsonRpcRequest,
  ): Promise<JsonRpcResponse> {
    try {
      switch (request.method) {
        case 'initialize':
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: { name: '@llui/mcp', version: '0.0.0' },
            },
          }

        case 'tools/list':
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: { tools: this.getTools() },
          }

        case 'tools/call': {
          const params = request.params as {
            name: string
            arguments: Record<string, unknown>
          }
          const result = await this.handleToolCall(
            params.name,
            params.arguments ?? {},
          )
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              content: [
                { type: 'text', text: JSON.stringify(result, null, 2) },
              ],
            },
          }
        }

        default:
          return {
            jsonrpc: '2.0',
            id: request.id,
            error: {
              code: -32601,
              message: `Method not found: ${request.method}`,
            },
          }
      }
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32000, message: String(err) },
      }
    }
  }
}

export { TOOLS as mcpToolDefinitions }
