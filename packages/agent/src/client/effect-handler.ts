import type { AgentEffect } from './effects.js'
import type {
  MintResponse,
  ResumeListResponse,
  ResumeClaimResponse,
  SessionsResponse,
} from '../protocol.js'

export type EffectHandlerHost = {
  send(msg: unknown): void // root app send; wraps agent sub-msgs into the app Msg envelope
  /** Wraps an agentConnect msg into an app-Msg. */
  wrapAgentConnect(m: unknown): unknown
  /** Called for AgentForwardMsg — the payload is re-dispatched via send. */
  forward(payload: unknown): void
  /** fetch for HTTP effects; override in tests. */
  fetch?: typeof fetch
  /** Called before opening WS / on WS lifecycle events. */
  openWs(token: string, wsUrl: string): void
  closeWs(): void
  /**
   * Base path for agent HTTP endpoints. Default: `'/agent'` (matches
   * the canonical paths in `@llui/vite-plugin`'s dev middleware and
   * `@llui/agent/server/http/router.ts`).
   *
   * Override when the consumer ships `@cloudflare/vite-plugin` in
   * dev — that plugin routes every non-`/cdn-cgi/*` path to the
   * worker, shadowing canonical `/agent/*` URLs. The vite-plugin
   * registers a parallel handler at `/cdn-cgi/agent/*`; pass
   * `agentBasePath: '/cdn-cgi/agent'` here so the client hits that.
   *
   * Production deployments without cloudflare-vite leave this
   * unset; the agent server's router serves the canonical paths.
   */
  agentBasePath?: string
}

type Fetch = typeof fetch

/**
 * Top-level dispatcher. The switch is intentionally thin — each
 * `case` delegates to a per-effect function below. Splitting was
 * motivated by the previous 150-line monolith mixing HTTP, WS, and
 * browser-only side effects in one switch; per-effect handlers are
 * directly unit-testable and the dispatcher reads as a flat catalogue
 * of supported effect types.
 */
export function createEffectHandler(host: EffectHandlerHost) {
  const doFetch = host.fetch ?? fetch.bind(globalThis)

  return async function handle(effect: AgentEffect): Promise<void> {
    switch (effect.type) {
      case 'AgentMintRequest':
        return handleMintRequest(host, effect, doFetch)
      case 'AgentOpenWS':
        return handleOpenWs(host, effect)
      case 'AgentCloseWS':
        return handleCloseWs(host)
      case 'AgentResumeCheck':
        return handleResumeCheck(host, effect, doFetch)
      case 'AgentResumeClaim':
        return handleResumeClaim(host, effect, doFetch)
      case 'AgentRevoke':
        return handleRevoke(host, effect, doFetch)
      case 'AgentSessionsList':
        return handleSessionsList(host, doFetch)
      case 'AgentForwardMsg':
        return handleForwardMsg(host, effect)
      case 'AgentClipboardWrite':
        return handleClipboardWrite(effect)
    }
  }
}

// ── HTTP-bound handlers ─────────────────────────────────────────────

async function handleMintRequest(
  host: EffectHandlerHost,
  effect: Extract<AgentEffect, { type: 'AgentMintRequest' }>,
  doFetch: Fetch,
): Promise<void> {
  try {
    const res = await doFetch(effect.mintUrl, { method: 'POST', credentials: 'include' })
    if (!res.ok) {
      const detail = await safeText(res)
      host.send(
        host.wrapAgentConnect({
          type: 'MintFailed',
          error: { code: `http-${res.status}`, detail },
        }),
      )
      return
    }
    const body = (await res.json()) as MintResponse
    host.send(
      host.wrapAgentConnect({
        type: 'MintSucceeded',
        token: body.token,
        tid: body.tid,
        lapUrl: body.lapUrl,
        wsUrl: body.wsUrl,
        expiresAt: body.expiresAt,
      }),
    )
  } catch (e) {
    host.send(
      host.wrapAgentConnect({
        type: 'MintFailed',
        error: { code: 'network', detail: String(e) },
      }),
    )
  }
}

async function handleResumeCheck(
  host: EffectHandlerHost,
  effect: Extract<AgentEffect, { type: 'AgentResumeCheck' }>,
  doFetch: Fetch,
): Promise<void> {
  const origin = deriveOrigin()
  if (!origin) return
  const base = agentBase(host)
  try {
    const res = await doFetch(`${origin}${base}/resume/list`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tids: effect.tids }),
    })
    if (!res.ok) return
    const body = (await res.json()) as ResumeListResponse
    host.send(host.wrapAgentConnect({ type: 'ResumeListLoaded', sessions: body.sessions }))
  } catch {
    /* quiet failure; user can retry */
  }
}

async function handleResumeClaim(
  host: EffectHandlerHost,
  effect: Extract<AgentEffect, { type: 'AgentResumeClaim' }>,
  doFetch: Fetch,
): Promise<void> {
  const origin = deriveOrigin()
  if (!origin) return
  const base = agentBase(host)
  try {
    const res = await doFetch(`${origin}${base}/resume/claim`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tid: effect.tid }),
    })
    if (!res.ok) return
    const body = (await res.json()) as ResumeClaimResponse
    host.openWs(body.token, body.wsUrl)
    host.send(host.wrapAgentConnect({ type: 'WsOpened' }))
  } catch {
    /* quiet */
  }
}

async function handleRevoke(
  host: EffectHandlerHost,
  effect: Extract<AgentEffect, { type: 'AgentRevoke' }>,
  doFetch: Fetch,
): Promise<void> {
  const origin = deriveOrigin()
  if (!origin) return
  const base = agentBase(host)
  try {
    await doFetch(`${origin}${base}/revoke`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tid: effect.tid }),
    })
  } catch {
    /* quiet */
  }
}

async function handleSessionsList(host: EffectHandlerHost, doFetch: Fetch): Promise<void> {
  const origin = deriveOrigin()
  if (!origin) return
  const base = agentBase(host)
  try {
    const res = await doFetch(`${origin}${base}/sessions`, {
      method: 'GET',
      credentials: 'include',
    })
    if (!res.ok) return
    const body = (await res.json()) as SessionsResponse
    host.send(host.wrapAgentConnect({ type: 'SessionsLoaded', sessions: body.sessions }))
  } catch {
    /* quiet */
  }
}

// ── WS-bound handlers ───────────────────────────────────────────────

function handleOpenWs(
  host: EffectHandlerHost,
  effect: Extract<AgentEffect, { type: 'AgentOpenWS' }>,
): void {
  host.openWs(effect.token, effect.wsUrl)
}

function handleCloseWs(host: EffectHandlerHost): void {
  host.closeWs()
}

// ── Local handlers (no network) ─────────────────────────────────────

function handleForwardMsg(
  host: EffectHandlerHost,
  effect: Extract<AgentEffect, { type: 'AgentForwardMsg' }>,
): void {
  host.forward(effect.payload)
}

async function handleClipboardWrite(
  effect: Extract<AgentEffect, { type: 'AgentClipboardWrite' }>,
): Promise<void> {
  // Browser-only — `navigator.clipboard` is undefined in Node/jsdom
  // test environments. Silently no-op rather than throw, matching the
  // rest of the agent effect handlers' failure-quiet pattern.
  if (typeof navigator === 'undefined' || !('clipboard' in navigator)) return
  try {
    await navigator.clipboard.writeText(effect.text)
  } catch {
    /* quiet — clipboard permission denied or document not focused */
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}

function deriveOrigin(): string | null {
  // When running in the browser, `location.origin` is correct (the agent endpoints
  // are same-origin with the app per spec §6.2). When not in a browser (tests),
  // tests can override the host.fetch and short-circuit before this is reached.
  if (typeof location !== 'undefined') return location.origin
  return null
}

/**
 * Resolve the agent endpoint base path. Default `/agent`. Trailing
 * slashes are normalized away so callers can always concatenate with
 * `${base}/resume/list` etc.
 */
function agentBase(host: EffectHandlerHost): string {
  const raw = host.agentBasePath ?? '/agent'
  return raw.endsWith('/') ? raw.slice(0, -1) : raw
}
