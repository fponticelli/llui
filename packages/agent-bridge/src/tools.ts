import type { ListToolsResult } from '@modelcontextprotocol/sdk/types.js'

/**
 * The MCP tools Claude sees. Two tiers:
 *
 *  - Efficient path (recommended): `observe` + `send_message`.
 *    `observe` returns state + actions + description + context in one
 *    call — replacing the old describe_app + get_state + list_actions
 *    trio. `send_message` defaults to `waitFor: 'drained'`, blocking
 *    until the message queue goes idle (http/delay/debounce round
 *    trips complete), then returns the new state + actions + drain
 *    meta. Together these cut the "check state → act → check state"
 *    loop from 5 round-trips to 2.
 *
 *  - Legacy / specialized: `describe_app`, `get_state`, `list_actions`,
 *    `wait_for_change`. Kept for back-compat and niche uses (e.g.
 *    scoped state reads via JSON pointer, external state pushes). New
 *    integrations should prefer `observe`.
 *
 * Spec §8.
 */
export const TOOLS: ListToolsResult['tools'] = [
  {
    name: 'llui_connect_session',
    description:
      'Bind this Claude conversation to a specific LLui app. Call ONCE per chat when the user pastes /llui-connect <url> <token>. The result includes the full observe bundle ({state, actions, description, context}) so you have everything you need to start acting — no separate describe_app / get_state / list_actions / describe_context follow-up is required on the first turn. Use observe later when you want a refreshed snapshot.',
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
    name: 'observe',
    description:
      'Unified snapshot — returns {state, actions, description, context} in one call. Use this as the default "what can I see, what can I do" read; prefer it over describe_app + get_state + list_actions. Typical flow: observe → send_message → (repeat). The response includes the static app description (name, version, msgSchema, docs) on every call so first-time callers do not need a separate describe_app.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'describe_app',
    description:
      "Return the bound app's name, version, state/message schemas, annotations, and static docs. Legacy — prefer `observe`, which includes this as `description`.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_state',
    description:
      'Return the current app state. Optional `path` (JSON-pointer) to narrow the slice. Legacy for full-state reads — prefer `observe`. Still useful for scoped reads via JSON pointer.',
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
      'Return the currently-affordable actions: visible UI bindings plus agent-affordable registry entries, filtered by annotation gates. Legacy — prefer `observe`, which includes this as `actions`.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'send_message',
    description:
      'Dispatch a message to the app. Blocks by default until the message queue goes idle (drain semantics — captures http/delay/debounce round-trips that feed back as messages). Returns {status, stateAfter, actions, drain} on dispatched, {status: "pending-confirmation", confirmId} when the variant is @requiresConfirm, or {status: "rejected", reason} on validation failures. `drain.timedOut: true` means the 5s cap was hit while messages were still arriving — follow up with `observe` to resync. `actions` in the response reflects the new state, so you normally do not need a separate `observe` after a send.',
    inputSchema: {
      type: 'object',
      properties: {
        msg: { type: 'object', description: 'The message to dispatch; must have a `type` string' },
        reason: {
          type: 'string',
          description: 'User-facing rationale (required for confirm-gated variants)',
        },
        waitFor: {
          type: 'string',
          enum: ['drained', 'idle', 'none'],
          description:
            '"drained" (default) waits for the message queue to go idle; "idle" flushes the update cycle only (no async effects); "none" is fire-and-forget.',
        },
        drainQuietMs: {
          type: 'number',
          description:
            'Quiescence window for waitFor:"drained". Drain completes when no commit fires for this many ms. Default 100.',
        },
        timeoutMs: {
          type: 'number',
          description:
            'Hard cap on total wait. Default 5000. For waitFor:"drained", this bounds how long the drain loop runs; for pending-confirmation, how long to wait for user approval.',
        },
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
    description:
      'Long-poll for a state change. Returns changed / timeout. Specialized — use for external state pushes (WebSocket messages, timers) that arrive while Claude is idle. For the normal send-then-read loop, `send_message` with `waitFor:"drained"` already waits for effect round-trips.',
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
  observe: '/observe',
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
