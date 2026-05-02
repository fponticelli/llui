import type { AgentEffect } from './effects.js'
import type {
  MintResponse,
  ResumeListResponse,
  ResumeClaimResponse,
  SessionsResponse,
} from '../protocol.js'
import type { AgentSessionStorage } from './factory.js'

export type EffectHandlerHost = {
  send(msg: unknown): void // root app send; wraps agent sub-msgs into the app Msg envelope
  /** Wraps an agentConnect msg into an app-Msg. */
  wrapAgentConnect(m: unknown): unknown
  /**
   * Wraps an agentAttention msg into an app-Msg. Optional; when
   * undefined, the `AgentAttentionFlashTimeout` effect no-ops on
   * fire and the attention spotlight stays set until the next
   * dispatch replaces it. Hosts that wire the attention slice
   * provide this; hosts that don't can leave it unset.
   */
  wrapAgentAttention?(m: unknown): unknown
  /** Called for AgentForwardMsg — the payload is re-dispatched via send. */
  forward(payload: unknown): void
  /** fetch for HTTP effects; override in tests. */
  fetch?: typeof fetch
  /** Called before opening WS / on WS lifecycle events. */
  openWs(token: string, wsUrl: string): void
  closeWs(): void
  /**
   * Optional storage adapter. When set, `AgentSessionPersist` writes
   * to it and `AgentSessionClear` clears it; the host doesn't need
   * to handle these effects itself. When `null` or `undefined`, the
   * effects no-op here and host code (if any) handles them in the
   * outer effect router. The factory passes
   * `defaultSessionStorage()` by default, so the framework is
   * refresh-survival-ready out of the box.
   */
  sessionStorage?: AgentSessionStorage | null
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
      case 'AgentSessionPersist':
        // Framework-owned when a storage adapter is configured;
        // otherwise no-op and let the host's outer effect router
        // handle it (the legacy contract). See factory.ts'
        // `sessionStorage` option.
        if (host.sessionStorage) {
          host.sessionStorage.write({
            token: effect.token,
            tid: effect.tid,
            lapUrl: effect.lapUrl,
            wsUrl: effect.wsUrl,
            expiresAt: effect.expiresAt,
          })
        }
        return
      case 'AgentSessionClear':
        if (host.sessionStorage) host.sessionStorage.clear()
        return
      case 'AgentReconnectSchedule':
        return handleReconnectSchedule(host, effect)
      case 'AgentAttentionFlashTimeout':
        return handleAttentionFlashTimeout(host, effect)
    }
  }
}

async function handleReconnectSchedule(
  host: EffectHandlerHost,
  effect: Extract<AgentEffect, { type: 'AgentReconnectSchedule' }>,
): Promise<void> {
  // Single-shot timer. The reducer owns cancellation semantics via
  // the status guard in `ReconnectAttempt` — if the user dispatches
  // `Disconnect` while we're sleeping, the dispatched message hits
  // an `idle` reducer and is a no-op. No cancel handle needed.
  await new Promise<void>((resolve) => setTimeout(resolve, effect.delayMs))
  host.send(host.wrapAgentConnect({ type: 'ReconnectAttempt', elapsedMs: effect.delayMs }))
}

async function handleAttentionFlashTimeout(
  host: EffectHandlerHost,
  effect: Extract<AgentEffect, { type: 'AgentAttentionFlashTimeout' }>,
): Promise<void> {
  // Mirror of handleReconnectSchedule's race-tolerant pattern: timer
  // fires, the reducer's `Clear { entryId }` guard handles the case
  // where a newer dispatch already replaced the spotlight. No cancel
  // handle — keeping the timer-cancel logic out of the effect handler
  // simplifies it and reduces the surface area for bugs.
  if (!host.wrapAgentAttention) return // Host opted out — graceful degradation.
  await new Promise<void>((resolve) => setTimeout(resolve, effect.delayMs))
  host.send(host.wrapAgentAttention({ type: 'Clear', entryId: effect.entryId }))
}

// ── HTTP-bound handlers ─────────────────────────────────────────────

async function handleMintRequest(
  host: EffectHandlerHost,
  effect: Extract<AgentEffect, { type: 'AgentMintRequest' }>,
  doFetch: Fetch,
): Promise<void> {
  // Derive a default `mintUrl` from `agentBasePath` so consumers can
  // change the base path in one place (the effect handler) without
  // also having to keep the `agentConnect` opts in sync. `agentBase`
  // accepts both absolute paths and full URLs.
  const base = agentBase(host)
  if (!base) return
  const mintUrl = effect.mintUrl ?? `${base}/mint`
  try {
    const res = await doFetch(mintUrl, { method: 'POST', credentials: 'include' })
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
  const base = agentBase(host)
  if (!base) return
  try {
    const res = await doFetch(`${base}/resume/list`, {
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
  const base = agentBase(host)
  if (!base) return
  try {
    const res = await doFetch(`${base}/resume/claim`, {
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
  const base = agentBase(host)
  if (!base) return
  try {
    await doFetch(`${base}/revoke`, {
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
  const base = agentBase(host)
  if (!base) return
  try {
    const res = await doFetch(`${base}/sessions`, {
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
  // When running in the browser, `location.origin` is correct for
  // same-origin agent endpoints. Tests override `host.fetch` and
  // short-circuit before this is reached.
  if (typeof location !== 'undefined') return location.origin
  return null
}

const ABSOLUTE_URL_RE = /^https?:\/\//i

/**
 * Resolve the absolute base URL for agent HTTP endpoints. Accepts both
 * absolute paths (`/agent`) and full URLs (`https://api.example/agent`)
 * — the absolute URL form lets consumers point at a cross-origin agent
 * server without pre-composing every endpoint URL. Trailing slashes
 * are normalized so callers can always concatenate `${base}/mint`.
 */
function agentBase(host: EffectHandlerHost): string | null {
  const raw = host.agentBasePath ?? '/agent'
  const trimmed = raw.endsWith('/') ? raw.slice(0, -1) : raw
  if (ABSOLUTE_URL_RE.test(trimmed)) return trimmed
  const origin = deriveOrigin()
  if (!origin) return null
  return `${origin}${trimmed}`
}
