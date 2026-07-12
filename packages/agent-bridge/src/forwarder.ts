export type ForwardResult =
  | { ok: true; body: unknown }
  | { ok: false; status: number; error: unknown }

export type ForwardDeps = {
  fetch?: typeof fetch
}

/**
 * Per-endpoint request budget in ms. The long-poll LAP endpoints block
 * on the server until something happens — `/message` waits for the
 * message queue to drain, `/wait` for a state change, `/confirm-result`
 * for the user to act — so their budget tracks the caller's own
 * `timeoutMs` plus a transport/server margin. Every other endpoint is a
 * prompt read; a fixed ceiling keeps a hung or unreachable server from
 * wedging the MCP tool call forever (there was previously no timeout, so
 * a stuck LAP endpoint hung the whole tool call indefinitely).
 */
const READ_BUDGET_MS = 20_000
const LONG_POLL_MARGIN_MS = 2_000
const LONG_POLL_DEFAULT_TIMEOUT_MS: Record<string, number> = {
  '/message': 5_000,
  '/wait': 10_000,
  '/confirm-result': 5_000,
}

/**
 * Resolve the abort budget for a LAP call. Long-poll endpoints derive it
 * from the caller-supplied `timeoutMs` (falling back to the endpoint's
 * server-side default) plus a fixed margin; all other endpoints get the
 * flat read ceiling. Exported so the budget policy is unit-testable
 * without spinning up a fake server.
 */
export function budgetForPath(path: string, args: object): number {
  const dfltTimeout = LONG_POLL_DEFAULT_TIMEOUT_MS[path]
  if (dfltTimeout === undefined) return READ_BUDGET_MS
  const caller = (args as { timeoutMs?: unknown }).timeoutMs
  const base = typeof caller === 'number' && caller > 0 ? caller : dfltTimeout
  return base + LONG_POLL_MARGIN_MS
}

/**
 * POST {baseUrl}{path} with Authorization: Bearer {token}, JSON body.
 * Returns a discriminated success/failure envelope. Aborts the request
 * once its per-endpoint budget elapses and maps the abort to the same
 * `{code: 'network'}` shape as any other transport failure.
 * Spec §11.4.
 */
export async function forwardLap(
  baseUrl: string,
  token: string,
  path: string,
  args: object,
  deps: ForwardDeps = {},
): Promise<ForwardResult> {
  const doFetch = deps.fetch ?? fetch.bind(globalThis)
  const url = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) + path : baseUrl + path
  const budgetMs = budgetForPath(path, args)
  try {
    const res = await doFetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(budgetMs),
    })
    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      body = null
    }
    if (!res.ok) return { ok: false, status: res.status, error: body }
    return { ok: true, body }
  } catch (e) {
    const aborted =
      e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')
    const detail = aborted ? `request to ${path} timed out after ${budgetMs}ms` : String(e)
    return { ok: false, status: 0, error: { code: 'network', detail } }
  }
}
