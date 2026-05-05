import { z } from 'zod'

/**
 * Shared MCP tool catalogue for the LLui agent. Consumed by both:
 *  - `@llui/agent` server-side MCP router (routes to LAP handlers internally)
 *  - `llui-agent` bridge (forwards to remote LAP over HTTP)
 *
 * `connect_session` is intentionally absent — the two surfaces have
 * different signatures (bridge needs `url` + `token`; server only needs
 * `token`). Each defines its own.
 */

const empty = z.object({})

export interface McpForwardedToolDescriptor {
  kind: 'forward'
  name: string
  description: string
  schema: z.ZodObject<z.ZodRawShape>
  /** LAP endpoint path relative to the base path, e.g. '/observe'. */
  lapPath: string
}

export interface McpMetaToolDescriptor {
  kind: 'meta'
  name: string
  description: string
  schema: z.ZodObject<z.ZodRawShape>
}

export type McpToolDescriptor = McpForwardedToolDescriptor | McpMetaToolDescriptor

export const DISCONNECT_SESSION_DESCRIPTOR: McpMetaToolDescriptor = {
  kind: 'meta',
  name: 'disconnect_session',
  description: 'Clear the session binding. Subsequent tool calls will fail until reconnected.',
  schema: empty,
}

export const FORWARDED_TOOL_DESCRIPTORS: McpForwardedToolDescriptor[] = [
  {
    kind: 'forward',
    name: 'observe',
    description:
      'Unified snapshot — returns {state, actions, description, context} in one call. Use this as the default "what can I see, what can I do" read; prefer it over describe_app + get_state + list_actions. Typical flow: observe → send_message → (repeat). The response includes the static app description (name, version, msgSchema, docs) on every call so first-time callers do not need a separate describe_app.',
    schema: empty,
    lapPath: '/observe',
  },
  {
    kind: 'forward',
    name: 'describe_app',
    description:
      "Return the bound app's name, version, state/message schemas, annotations, and static docs. Legacy — prefer `observe`, which includes this as `description`.",
    schema: empty,
    lapPath: '/describe',
  },
  {
    kind: 'forward',
    name: 'get_state',
    description:
      'Return the current app state. Optional `path` (JSON-pointer) to narrow the slice. Legacy for full-state reads — prefer `observe`. Still useful for scoped reads via JSON pointer.',
    schema: z.object({
      path: z.string().optional().describe('Optional JSON-pointer, e.g. "/user/name"'),
    }),
    lapPath: '/state',
  },
  {
    kind: 'forward',
    name: 'query_state',
    description:
      'Read a single slice of state via JSON-pointer path. Returns `{found: true, value}` on hit or `{found: false, detail}` on miss (missing key, walking through null, etc.). Cheaper than `observe` when checking one field. Path syntax: `""` (whole state), `"/auth/user"`, `"/items/0/id"`, `"/key~1with~1slash"` (escaped `/`), `"/key~0tilde"` (escaped `~`).',
    schema: z.object({
      path: z.string().describe('JSON-pointer (RFC 6901) — `/auth/user` or `""` for whole state'),
    }),
    lapPath: '/query-state',
  },
  {
    kind: 'forward',
    name: 'describe_recent_actions',
    description:
      'Return the most recent log entries for this session (newest first). Each `dispatched` entry includes a `stateDiff` showing what changed. Useful for self-correction over multi-step flows — read your own past dispatches without re-querying full state. Filter by `kind` (e.g. `"dispatched"`) to skip read-only entries.',
    schema: z.object({
      n: z.number().int().positive().optional().describe('How many entries to return (default 10)'),
      kind: z
        .string()
        .optional()
        .describe('Filter to a specific kind (e.g. "dispatched", "read", "error")'),
    }),
    lapPath: '/recent-actions',
  },
  {
    kind: 'forward',
    name: 'would_dispatch',
    description:
      'Predict what dispatching `msg` would do without committing it. Runs the reducer in isolation against current state and returns `{stateDiff, effects}`. Effects are listed but NOT executed — the cloud is not hit, analytics do not fire. Use this to weigh a candidate action before sending: "if I dispatch X, will it change Y?" Pure-reducer assumption: if the reducer branches on Date.now() / localStorage / random, prediction drifts from real dispatch by exactly that impurity.',
    schema: z.object({
      msg: z
        .object({ type: z.string() })
        .passthrough()
        .describe('The candidate message; must have a `type` string'),
    }),
    lapPath: '/would-dispatch',
  },
  {
    kind: 'forward',
    name: 'list_actions',
    description:
      'Return the currently-affordable actions: visible UI bindings plus agent-affordable registry entries, filtered by annotation gates. Legacy — prefer `observe`, which includes this as `actions`.',
    schema: empty,
    lapPath: '/actions',
  },
  {
    kind: 'forward',
    name: 'send_message',
    description:
      'Dispatch a message to the app. Blocks by default until the message queue goes idle (drain semantics — captures http/delay/debounce round-trips that feed back as messages). Returns {status, stateDiff, actions, drain} on dispatched, {status: "pending-confirmation", confirmId} when the variant is @requiresConfirm, or {status: "rejected", reason} on validation failures. By default the response carries `stateDiff` (a JSON-Patch-shaped delta) and not the full post-state — apply the diff to the snapshot you got from `connect`/`observe`. Pass `includeState: true` if you want the full snapshot back (rare; expensive on bandwidth and context for large states). `drain.timedOut: true` means the 5s cap was hit while messages were still arriving — follow up with `observe` to resync. `actions` in the response reflects the new state, so you normally do not need a separate `observe` after a send.',
    schema: z.object({
      msg: z
        .object({ type: z.string() })
        .passthrough()
        .describe('The message to dispatch; must have a `type` string'),
      reason: z
        .string()
        .optional()
        .describe('User-facing rationale (required for confirm-gated variants)'),
      waitFor: z
        .enum(['drained', 'idle', 'none'])
        .optional()
        .describe(
          '"drained" (default) waits for the message queue to go idle; "idle" flushes the update cycle only (no async effects); "none" is fire-and-forget.',
        ),
      drainQuietMs: z
        .number()
        .optional()
        .describe(
          'Quiescence window for waitFor:"drained". Drain completes when no commit fires for this many ms. Default 100.',
        ),
      timeoutMs: z
        .number()
        .optional()
        .describe(
          'Hard cap on total wait. Default 5000. For waitFor:"drained", this bounds how long the drain loop runs; for pending-confirmation, how long to wait for user approval.',
        ),
      includeState: z
        .boolean()
        .optional()
        .describe(
          'Include the full post-drain `stateAfter` snapshot in the response. Default false — `stateDiff` is what callers normally need, and resending the full state on every dispatch wastes bandwidth and context. Set true only when you need a fresh snapshot back (e.g., after a long-running effect that may have produced changes the diff misses).',
        ),
    }),
    lapPath: '/message',
  },
  {
    kind: 'forward',
    name: 'get_confirm_result',
    description:
      'Poll a pending-confirmation by confirmId. Returns confirmed / rejected / still-pending.',
    schema: z.object({
      confirmId: z.string(),
      timeoutMs: z.number().optional(),
    }),
    lapPath: '/confirm-result',
  },
  {
    kind: 'forward',
    name: 'wait_for_change',
    description:
      'Long-poll for a state change. Returns changed / timeout. Specialized — use for external state pushes (WebSocket messages, timers) that arrive while Claude is idle. For the normal send-then-read loop, `send_message` with `waitFor:"drained"` already waits for effect round-trips.',
    schema: z.object({
      path: z
        .string()
        .optional()
        .describe('Optional JSON-pointer to narrow which state changes trigger resolution'),
      timeoutMs: z.number().optional(),
    }),
    lapPath: '/wait',
  },
  {
    kind: 'forward',
    name: 'narrate',
    description:
      'Push a one-line prose update into the in-app activity feed without dispatching a Msg. Use BEFORE long-running actions ("Looking at your cart now…", "Calling the pricing API — should take ~2s"), to surface inferred reasoning ("I notice you have an unsaved draft in `notes` — assuming you want to keep it"), or to acknowledge user input before acting on it. Keep narration single-line and present-tense; the user reads it in the activity panel inline with your dispatched actions. The text shows up as a `narrate`-kind entry — distinct from `dispatched` and `read`. Returns { ok: true } once the host runtime has the entry.',
    schema: z.object({
      text: z.string().describe('The narration prose, ideally one sentence. Required.'),
      intent: z
        .string()
        .optional()
        .describe(
          'Short label shown next to the narration (e.g. "Thinking", "Notice", "Plan"). Defaults to "Agent narrated".',
        ),
    }),
    lapPath: '/narrate',
  },
  {
    kind: 'forward',
    name: 'query_dom',
    description: 'Read elements tagged with data-agent="<name>" in the rendered UI.',
    schema: z.object({
      name: z.string(),
      multiple: z.boolean().optional(),
    }),
    lapPath: '/query-dom',
  },
  {
    kind: 'forward',
    name: 'describe_visible_content',
    description: 'Return a structured outline of the currently-visible data-agent-tagged subtrees.',
    schema: empty,
    lapPath: '/describe-visible',
  },
  {
    kind: 'forward',
    name: 'describe_context',
    description:
      'Return the current per-state narrative docs (agentContext) — what the user is trying to do right now.',
    schema: empty,
    lapPath: '/context',
  },
]
