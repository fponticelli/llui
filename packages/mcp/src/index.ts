import type { LluiDebugAPI } from '@llui/dom'
import { WebSocketServer, type WebSocket } from 'ws'
import { randomUUID } from 'node:crypto'

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
      'Get the chronological message history with state transitions, effects, and dirty masks. Supports pagination via `since` (exclusive, return entries with index > since) and `limit` (return at most N most-recent entries). Use both together for tail-fetching.',
    inputSchema: {
      type: 'object',
      properties: {
        since: {
          type: 'number',
          description: 'Return entries with index strictly greater than this.',
        },
        limit: {
          type: 'number',
          description: 'Max entries to return (the N most recent).',
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
    description: 'Get all active reactive bindings with their masks, last values, and DOM targets.',
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
          description: 'Dot-separated path to search. E.g., "user.name", "items"',
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
  {
    name: 'llui_list_messages',
    description:
      'List all message variants the component accepts, with their field types. Returns { discriminant, variants: { [name]: { [field]: typeDescriptor } } }. Use this to discover what messages can be sent without reading source code.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'llui_decode_mask',
    description:
      "Decode a dirty-mask value from llui_get_message_history (the 'dirtyMask' field) into the list of top-level state fields that changed. Requires 'mask' param.",
    inputSchema: {
      type: 'object',
      properties: {
        mask: { type: 'number', description: 'The dirtyMask value to decode' },
      },
      required: ['mask'],
    },
  },
  {
    name: 'llui_mask_legend',
    description:
      'Return the compiler-generated bit→field map for this component. Example: { todos: 1, filter: 2, nextId: 4 } means bit 0 represents `todos`, etc.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'llui_component_info',
    description:
      'Get component name and source location (file + line) of the component() declaration. Lets you find where to read or edit the component.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'llui_describe_state',
    description:
      "Return the State type's shape (not its value). Fields map to type descriptors: 'string', 'number', 'boolean', {kind:'enum',values:[...]}, {kind:'array',of:...}, {kind:'object',fields:...}, {kind:'optional',of:...}. Use this to know what fields exist and their types even when currently undefined.",
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'llui_list_effects',
    description:
      'List all effect variants the component emits, with their field types (same format as llui_list_messages). Returns null if no Effect type is declared.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'llui_trace_element',
    description:
      "Find all bindings targeting a DOM element matched by a CSS selector. Returns { bindingIndex, kind, key, mask, lastValue, relation }[] so you can answer 'why is this element wrong?' — combine with llui_why_did_update(bindingIndex) for a full narrative.",
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector (e.g. `.todo.active`, `#submit`)' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'llui_snapshot_state',
    description:
      'Capture the current state (deep clone). Returns the snapshot — store it, then call llui_restore_state later to roll back. Useful for safely exploring transitions during a debugging session.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'llui_restore_state',
    description:
      'Overwrite the current state with a previously-captured snapshot. Triggers a full re-render (FULL_MASK). Bypasses update() — snap must already be a valid state value.',
    inputSchema: {
      type: 'object',
      properties: {
        snapshot: {
          description: 'The state object returned by llui_snapshot_state.',
        },
      },
      required: ['snapshot'],
    },
  },
  {
    name: 'llui_list_components',
    description:
      'List all currently-mounted LLui components + which one is active (being targeted by subsequent tool calls). Multi-mount apps show one entry per mount.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'llui_select_component',
    description:
      'Switch the active component (the one all other tool calls target). Use a key from llui_list_components.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Component key as returned by llui_list_components' },
      },
      required: ['key'],
    },
  },
  {
    name: 'llui_replay_trace',
    description:
      'Generate a ready-to-run vitest file that replays the current message history via `replayTrace()` from @llui/test. The output is a complete test file with the trace inlined — paste it into packages/<pkg>/test/ to reproduce the exact sequence of messages the component saw in this session. Use this to capture a debugging session as a regression test.',
    inputSchema: {
      type: 'object',
      properties: {
        importPath: {
          type: 'string',
          description:
            "Where to import the component def from in the generated test (default: '../src/index'). Example: '../src/todo-app'.",
        },
        exportName: {
          type: 'string',
          description: "Named export that holds the component def (default: the component's name).",
        },
      },
    },
  },
]

// ── MCP Server ──────────────────────────────────────────────────

interface PendingRequest {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
}

export class LluiMcpServer {
  /** Direct (same-process) debug API, used for tests or in-process bridging. */
  private debugApi: LluiDebugAPI | null = null
  /** Bridge (WebSocket) state for out-of-process browser connection. */
  private wsServer: WebSocketServer | null = null
  private browserWs: WebSocket | null = null
  private pending = new Map<string, PendingRequest>()
  private bridgePort: number

  constructor(bridgePort = 5200) {
    this.bridgePort = bridgePort
  }

  /** Connect to a debug API instance directly (for in-process usage). */
  connectDirect(api: LluiDebugAPI): void {
    this.debugApi = api
  }

  /**
   * Start a WebSocket server on the configured bridge port. The browser-side
   * relay (injected by the Vite plugin in dev mode) connects here and forwards
   * debug-API calls.
   */
  startBridge(): void {
    if (this.wsServer) return
    this.wsServer = new WebSocketServer({ port: this.bridgePort, host: '127.0.0.1' })
    this.wsServer.on('connection', (ws) => {
      this.browserWs = ws
      ws.on('message', (raw) => {
        let msg: { id: string; result?: unknown; error?: string }
        try {
          msg = JSON.parse(String(raw))
        } catch {
          return
        }
        const p = this.pending.get(msg.id)
        if (!p) return
        this.pending.delete(msg.id)
        if (msg.error) p.reject(new Error(msg.error))
        else p.resolve(msg.result)
      })
      ws.on('close', () => {
        if (this.browserWs === ws) this.browserWs = null
      })
    })
  }

  stopBridge(): void {
    this.wsServer?.close()
    this.wsServer = null
    this.browserWs = null
    for (const p of this.pending.values()) p.reject(new Error('bridge closed'))
    this.pending.clear()
  }

  /** Invoke a debug API method — over the bridge if connected, else direct. */
  private async call(method: keyof LluiDebugAPI, args: unknown[]): Promise<unknown> {
    if (this.debugApi) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fn = (this.debugApi as any)[method]
      return typeof fn === 'function' ? fn.apply(this.debugApi, args) : undefined
    }
    if (!this.browserWs) {
      throw new Error('No browser connected to the MCP bridge. Start your dev server.')
    }
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.browserWs!.send(JSON.stringify({ id, method, args }))
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`timeout: ${method}`))
      }, 5000)
    })
  }

  /** Get tool definitions for MCP handshake */
  getTools(): McpToolDefinition[] {
    return TOOLS
  }

  /** Handle an MCP tool call */
  async handleToolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case 'llui_get_state':
        return this.call('getState', [])

      case 'llui_send_message': {
        const errors = (await this.call('validateMessage', [args.msg])) as unknown[] | null
        if (errors) return { errors, sent: false }
        await this.call('send', [args.msg])
        await this.call('flush', [])
        return { state: await this.call('getState', []), sent: true }
      }

      case 'llui_eval_update':
        return this.call('evalUpdate', [args.msg])

      case 'llui_validate_message':
        return this.call('validateMessage', [args.msg])

      case 'llui_get_message_history': {
        const opts: { since?: number; limit?: number } = {}
        if (typeof args.since === 'number') opts.since = args.since
        if (typeof args.limit === 'number') opts.limit = args.limit
        return this.call('getMessageHistory', [opts])
      }

      case 'llui_export_trace':
        return this.call('exportTrace', [])

      case 'llui_get_bindings':
        return this.call('getBindings', [])

      case 'llui_why_did_update':
        return this.call('whyDidUpdate', [args.bindingIndex as number])

      case 'llui_search_state':
        return this.call('searchState', [args.query as string])

      case 'llui_clear_log':
        await this.call('clearLog', [])
        return { cleared: true }

      case 'llui_list_messages':
        return this.call('getMessageSchema', [])

      case 'llui_decode_mask':
        return this.call('decodeMask', [args.mask as number])

      case 'llui_mask_legend':
        return this.call('getMaskLegend', [])

      case 'llui_component_info':
        return this.call('getComponentInfo', [])

      case 'llui_describe_state':
        return this.call('getStateSchema', [])

      case 'llui_list_effects':
        return this.call('getEffectSchema', [])

      case 'llui_trace_element':
        return this.call('getBindingsFor', [args.selector as string])

      case 'llui_snapshot_state':
        return this.call('snapshotState', [])

      case 'llui_restore_state':
        await this.call('restoreState', [args.snapshot])
        return { restored: true, state: await this.call('getState', []) }

      case 'llui_list_components':
        return this.call('__listComponents' as never, [])

      case 'llui_select_component':
        return this.call('__selectComponent' as never, [args.key])

      case 'llui_replay_trace': {
        const trace = (await this.call('exportTrace', [])) as {
          component: string
          entries: Array<{ msg: unknown; expectedState: unknown; expectedEffects: unknown[] }>
        }
        const importPath = (args.importPath as string | undefined) ?? '../src/index'
        const exportName = (args.exportName as string | undefined) ?? trace.component
        return {
          filename: `${trace.component.toLowerCase()}-replay.test.ts`,
          code: generateReplayTest(trace, importPath, exportName),
          entryCount: trace.entries.length,
        }
      }

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

  private async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
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
          const result = await this.handleToolCall(params.name, params.arguments ?? {})
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
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

function generateReplayTest(
  trace: {
    component: string
    entries: Array<{ msg: unknown; expectedState: unknown; expectedEffects: unknown[] }>
  },
  importPath: string,
  exportName: string,
): string {
  const traceJson = JSON.stringify(
    {
      lluiTrace: 1,
      component: trace.component,
      generatedBy: 'llui-mcp',
      timestamp: new Date().toISOString(),
      entries: trace.entries,
    },
    null,
    2,
  )
  return `import { it, expect } from 'vitest'
import { replayTrace } from '@llui/test'
import { ${exportName} } from '${importPath}'

// Auto-generated from a debugging session via llui_replay_trace MCP tool.
// Edit the trace below to trim, reorder, or adjust expected state/effects.
const trace = ${traceJson} as const

it('${trace.component}: replays ${trace.entries.length} recorded message${trace.entries.length === 1 ? '' : 's'}', () => {
  expect(() => replayTrace(${exportName}, trace as Parameters<typeof replayTrace>[1])).not.toThrow()
})
`
}
