import { withLapGates, type LapGateDeps } from './gate.js'

/** @deprecated Use `LapGateDeps` from `./gate.js`. */
export type ForwardDeps = LapGateDeps

/**
 * Generic LAP forward handler. `parseArgs` is called with the parsed
 * body (may be null for empty bodies); it returns the args object to
 * forward or null to reject as invalid. `tool` is the browser-side tool
 * name. The shared auth/paused/rate-limit gate + activation/touch/audit
 * suffix are supplied by `withLapGates`.
 */
export function makeForwardHandler(
  tool: string,
  parseArgs: (body: unknown) => object | null,
  auditDetail: (tid: string, args: object) => Record<string, unknown> = () => ({}),
) {
  return withLapGates({ touchOn: 'completion' }, async (ctx) => {
    const rawBody = ctx.req.method === 'POST' ? await ctx.req.json().catch(() => null) : null
    const args = parseArgs(rawBody)
    if (args === null) return ctx.json({ error: { code: 'invalid' } }, 400)

    try {
      const result = await ctx.deps.registry.rpc(ctx.tid, tool, args)
      return ctx.finish(result, { detail: { tool, ...auditDetail(ctx.tid, args) } })
    } catch (e: unknown) {
      const err = e as { code?: string; detail?: string }
      const code = err.code ?? 'internal'
      // Paused mid-RPC means the WS dropped between the isPaired check
      // and the response — same advisory headers help the agent decide
      // whether to retry.
      if (code === 'paused') return ctx.paused()
      const status = code === 'timeout' ? 504 : 500
      return ctx.json({ error: { code, detail: err.detail } }, status)
    }
  })
}

// Concrete handlers:
export const handleLapState = makeForwardHandler('get_state', (body) => {
  const b = (body ?? {}) as { path?: unknown }
  if (b.path !== undefined && typeof b.path !== 'string') return null
  return { path: b.path }
})

export const handleLapQueryState = makeForwardHandler('query_state', (body) => {
  const b = (body ?? {}) as { path?: unknown }
  if (typeof b.path !== 'string') return null
  return { path: b.path }
})

export const handleLapActions = makeForwardHandler('list_actions', () => ({}))

export const handleLapQueryDom = makeForwardHandler('query_dom', (body) => {
  const b = (body ?? {}) as { name?: unknown; multiple?: unknown }
  if (typeof b.name !== 'string') return null
  return { name: b.name, multiple: !!b.multiple }
})

export const handleLapDescribeVisible = makeForwardHandler('describe_visible_content', () => ({}))

export const handleLapContext = makeForwardHandler('describe_context', () => ({}))

export const handleLapWouldDispatch = makeForwardHandler('would_dispatch', (body) => {
  const b = (body ?? {}) as { msg?: unknown }
  if (
    b.msg === null ||
    b.msg === undefined ||
    typeof b.msg !== 'object' ||
    typeof (b.msg as { type?: unknown }).type !== 'string'
  ) {
    return null
  }
  return { msg: b.msg }
})

/**
 * Read recent log entries from the pairing registry's ring buffer.
 * Server-side only — no round-trip to the browser. Used by the agent's
 * `describe_recent_actions` tool to introspect its own activity history
 * without re-fetching state.
 *
 * Shares the same gate as `makeForwardHandler`; it just reads
 * registry-owned data instead of forwarding an RPC to the browser.
 */
export const handleLapRecentActions = withLapGates({ touchOn: 'completion' }, async (ctx) => {
  const body = ctx.req.method === 'POST' ? await ctx.req.json().catch(() => null) : null
  const b = (body ?? {}) as { n?: unknown; kind?: unknown }
  const n = typeof b.n === 'number' && b.n > 0 ? Math.floor(b.n) : 10
  // Allow filtering by kind so the agent can ask for "just dispatches"
  // without sifting through reads. Default `null` returns all kinds.
  const kindFilter = typeof b.kind === 'string' ? b.kind : null

  // When filtering, pull the whole buffer (up to the registry's cap) so
  // the post-filter `slice(0, n)` still has enough candidates.
  let entries = ctx.deps.registry.getRecentLog(
    ctx.tid,
    kindFilter !== null ? ctx.deps.registry.recentLogCap : n,
  )
  if (kindFilter !== null) {
    entries = entries.filter((e) => e.kind === kindFilter).slice(0, n)
  }

  return ctx.finish(
    { entries },
    { detail: { tool: 'describe_recent_actions', count: entries.length, kindFilter } },
  )
})
