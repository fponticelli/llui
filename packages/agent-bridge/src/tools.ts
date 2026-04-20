import type { ListToolsResult } from '@modelcontextprotocol/sdk/types.js'

/**
 * The 10 MCP tools Claude sees:
 *   2 meta-tools (bind/unbind) + 8 forwarded tools (1:1 with LAP endpoints).
 *
 * Spec §8.
 */
export const TOOLS: ListToolsResult['tools'] = [
  {
    name: 'llui_connect_session',
    description:
      'Bind this Claude conversation to a specific LLui app. Call ONCE per chat when the user pastes /llui-connect <url> <token>. Subsequent LLui tool calls target the bound app.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'LAP base URL (e.g. https://app.example/agent/lap/v1)',
        },
        token: { type: 'string', description: 'Bearer token for LAP calls' },
      },
      required: ['url', 'token'],
    },
  },
  {
    name: 'llui_disconnect_session',
    description:
      'Clear the binding for this Claude conversation. Subsequent LLui tool calls will fail until rebind.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'describe_app',
    description:
      "Return the bound app's name, version, state/message schemas, annotations, and static docs.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_state',
    description:
      'Return the current app state. Optional `path` (JSON-pointer) to narrow the slice.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Optional JSON-pointer, e.g. "/user/name"' },
      },
    },
  },
  {
    name: 'list_actions',
    description:
      'Return the currently-affordable actions: visible UI bindings plus agent-affordable registry entries, filtered by annotation gates.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'send_message',
    description:
      'Dispatch a message to the app. Auto-proposes a user confirmation when the message variant is @requiresConfirm. Returns dispatched / pending-confirmation / rejected.',
    inputSchema: {
      type: 'object',
      properties: {
        msg: { type: 'object', description: 'The message to dispatch; must have a `type` string' },
        reason: {
          type: 'string',
          description: 'User-facing rationale (required for confirm-gated variants)',
        },
        waitFor: { type: 'string', enum: ['idle', 'none'], description: 'default "idle"' },
        timeoutMs: { type: 'number' },
      },
      required: ['msg'],
    },
  },
  {
    name: 'get_confirm_result',
    description:
      'Poll a pending-confirmation by confirmId. Returns confirmed / rejected / still-pending.',
    inputSchema: {
      type: 'object',
      properties: {
        confirmId: { type: 'string' },
        timeoutMs: { type: 'number' },
      },
      required: ['confirmId'],
    },
  },
  {
    name: 'wait_for_change',
    description: 'Long-poll for a state change. Returns changed / timeout.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Optional JSON-pointer to narrow which state changes trigger resolution',
        },
        timeoutMs: { type: 'number' },
      },
    },
  },
  {
    name: 'query_dom',
    description: 'Read elements tagged with data-agent="<name>" in the rendered UI.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        multiple: { type: 'boolean' },
      },
      required: ['name'],
    },
  },
  {
    name: 'describe_visible_content',
    description: 'Return a structured outline of the currently-visible data-agent-tagged subtrees.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'describe_context',
    description:
      'Return the current per-state narrative docs (agentContext) — what the user is trying to do right now.',
    inputSchema: { type: 'object', properties: {} },
  },
]

/**
 * Mapping from tool name → LAP path for the forwarded subset.
 * Meta-tools handled separately in bridge.ts.
 */
export const TOOL_TO_LAP_PATH: Record<string, string> = {
  describe_app: '/describe',
  get_state: '/state',
  list_actions: '/actions',
  send_message: '/message',
  get_confirm_result: '/confirm-result',
  wait_for_change: '/wait',
  query_dom: '/query-dom',
  describe_visible_content: '/describe-visible',
  describe_context: '/context',
}
