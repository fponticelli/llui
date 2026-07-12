import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { LapDescribeResponse, LapObserveResponse } from '../protocol.js'
import type { McpForwardedToolDescriptor } from './tools.js'

/**
 * Shared MCP tool executor. Both agent surfaces — the in-process
 * `@llui/agent` server-side MCP (`createAgentMcpServer`) and the
 * `llui-agent` HTTP bridge (`createBridgeServer`) — drive their
 * forwarded tools and connect flow through this module, parameterized
 * over a `LapCaller`. Previously each surface hand-rolled the
 * registration loop, `okResult`/`errorResult`, the connect prefetch, the
 * describe cache, and the schemaHash invalidation — and they had drifted
 * (different error phrasing; only the bridge cached describe + short-
 * circuited `describe_app`). Centralizing here makes both behave
 * identically.
 */

// ── CallToolResult builders ─────────────────────────────────────────

/**
 * `structuredContent` is what current Claude clients (Desktop + Claude
 * Code) consume preferentially when present — typed JSON instead of a
 * stringified blob. The `content` array stays as a `text` fallback so
 * older clients still see something sensible.
 */
export function okResult(body: unknown): CallToolResult {
  return {
    structuredContent: body as Record<string, unknown>,
    content: [{ type: 'text', text: JSON.stringify(body) }],
  }
}

export function errorResult(msg: string): CallToolResult {
  return {
    content: [{ type: 'text', text: msg }],
    isError: true,
  }
}

// ── LAP transport abstraction ───────────────────────────────────────

/** Discriminated result of one LAP call, transport-independent. */
export type LapEnvelope =
  | { ok: true; body: unknown }
  | { ok: false; status: number; error: unknown }

/**
 * Call a LAP endpoint. The server surface routes a synthetic WHATWG
 * Request through the agent core (`coreRouter`); the bridge surface
 * POSTs over HTTP (`forwardLap`). Both collapse to this shape.
 */
export type LapCaller = (path: string, args: object) => Promise<LapEnvelope>

// ── Per-session describe cache ──────────────────────────────────────

/**
 * A per-session cache of the app `description`. Populated on connect
 * (from the `/observe` bundle) and on every `describe_app` / `observe`
 * call; read to serve `describe_app` from cache and to diff schemaHash
 * for staleness. Each surface backs this with its own session store
 * (bridge: `BindingMap`; server: `McpSessionMap`).
 */
export interface DescribeCache {
  get(): LapDescribeResponse | null
  set(d: LapDescribeResponse): void
}

// ── schemaHash invalidation ─────────────────────────────────────────

/**
 * Compare a freshly-fetched app description against the cached one and
 * decide whether the cached schema is now stale. A changed `schemaHash`
 * means the app's Msg/State schema was recompiled — cached
 * affordances/examples/payload shapes may no longer be valid, so the
 * caller is told to re-read before dispatching. Exported so the
 * invalidation policy is unit-testable in isolation.
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

// ── Error formatting ────────────────────────────────────────────────

type LapErrorBody = { code?: unknown; detail?: unknown }

/** Pull `{ code, detail }` out of a LAP error payload, which is either
 *  `{ error: { code, detail } }` (LAP handler response) or a bare
 *  `{ code, detail }` (transport failure envelope from `forwardLap`). */
function readLapError(error: unknown): LapErrorBody {
  if (error && typeof error === 'object') {
    const outer = error as { error?: unknown }
    if (outer.error && typeof outer.error === 'object') return outer.error as LapErrorBody
    return error as LapErrorBody
  }
  return {}
}

/** Uniform tool-error text for a failed forwarded LAP call. Replaces the
 *  two surfaces' divergent phrasings (server: `name: status=… code=…`;
 *  bridge: `LAP path failed: status=… {json}`). */
function formatForwardError(
  desc: McpForwardedToolDescriptor,
  res: {
    status: number
    error: unknown
  },
): string {
  const { code, detail } = readLapError(res.error)
  const codeStr = code !== undefined ? String(code) : String(res.status)
  const detailStr = detail !== undefined ? ` — ${String(detail)}` : ''
  return `${desc.name} (${desc.lapPath}) failed: status=${res.status} code=${codeStr}${detailStr}`
}

// ── Forwarded-tool executor ─────────────────────────────────────────

/**
 * Run one forwarded tool: serve `describe_app` from cache when warm,
 * otherwise dispatch to LAP, then cache + schemaHash-diff the
 * description-bearing responses (`describe_app`, `observe`) so a
 * mid-session recompile is surfaced to the LLM.
 */
export async function executeForwardedTool(
  desc: McpForwardedToolDescriptor,
  args: object,
  call: LapCaller,
  cache: DescribeCache,
): Promise<CallToolResult> {
  // describe_app can serve from cache when one is available.
  if (desc.name === 'describe_app') {
    const cached = cache.get()
    if (cached) return okResult(cached)
  }

  const res = await call(desc.lapPath, args)
  if (!res.ok) return errorResult(formatForwardError(desc, res))

  // describe_app on a cache miss: no prior hash to diff against (the warm
  // path short-circuited above), but route it through the same detector
  // for uniformity, then cache.
  if (desc.name === 'describe_app') {
    const d = res.body as LapDescribeResponse
    const change = detectSchemaChange(cache.get(), d)
    cache.set(d)
    if (change.changed) {
      return okResult({ ...(d as object), schemaChanged: true, schemaChangedNote: change.note })
    }
    return okResult(d)
  }

  // observe returns description on every call; it's the invalidation path
  // for the describe cache. Diff the incoming schemaHash against the
  // cached one, replace the cache, and surface a note when the app's
  // schema changed under a live session so the LLM re-reads before
  // trusting stale affordances.
  if (desc.name === 'observe') {
    const obs = res.body as LapObserveResponse
    if (obs?.description) {
      const change = detectSchemaChange(cache.get(), obs.description)
      cache.set(obs.description)
      if (change.changed) {
        return okResult({ ...(obs as object), schemaChanged: true, schemaChangedNote: change.note })
      }
    }
  }

  return okResult(res.body)
}

// ── connect_session prefetch flow ───────────────────────────────────

/**
 * Shared tail of `connect_session`, after each surface has recorded its
 * own binding (bridge: url+token; server: tid+token). Prefetch the
 * `/observe` bundle so the LLM gets `{state, actions, description,
 * context}` in one call — no follow-up `observe` / `describe_app` /
 * `get_state` / `list_actions` on the first turn — cache the
 * description, and return the connected result. On failure, `onFailure`
 * unwinds the binding the caller set.
 */
export async function executeConnect(
  call: LapCaller,
  cache: DescribeCache,
  onFailure: () => void,
): Promise<CallToolResult> {
  const res = await call('/observe', {})
  if (!res.ok) {
    onFailure()
    return errorResult(`connect_session failed: observe ${formatEnvelopeError(res)}`)
  }
  const observe = res.body as LapObserveResponse
  cache.set(observe.description)
  return okResult({
    status: 'connected',
    appName: observe.description.name,
    appVersion: observe.description.version,
    // Full observe payload — same shape the `observe` tool returns — so a
    // describe_app / get_state / list_actions / describe_context
    // follow-up is unnecessary on the first turn.
    state: observe.state,
    actions: observe.actions,
    description: observe.description,
    context: observe.context,
  })
}

function formatEnvelopeError(res: { status: number; error: unknown }): string {
  const { code, detail } = readLapError(res.error)
  const codeStr = code !== undefined ? String(code) : String(res.status)
  const detailStr = detail !== undefined ? ` — ${String(detail)}` : ''
  return `failed: status=${res.status} code=${codeStr}${detailStr}`
}
