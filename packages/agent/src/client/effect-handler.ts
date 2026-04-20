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
}

export function createEffectHandler(host: EffectHandlerHost) {
  const doFetch = host.fetch ?? fetch.bind(globalThis)

  return async function handle(effect: AgentEffect): Promise<void> {
    switch (effect.type) {
      case 'AgentMintRequest': {
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
        return
      }
      case 'AgentOpenWS': {
        host.openWs(effect.token, effect.wsUrl)
        return
      }
      case 'AgentCloseWS': {
        host.closeWs()
        return
      }
      case 'AgentResumeCheck': {
        // For v1 we call /agent/resume/list via the mint URL's origin; the mintUrl is a POST
        // endpoint at `/agent/mint`, so we derive the origin and hit `/agent/resume/list`.
        const origin = deriveOrigin(host)
        if (!origin) return
        try {
          const res = await doFetch(`${origin}/agent/resume/list`, {
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
        return
      }
      case 'AgentResumeClaim': {
        const origin = deriveOrigin(host)
        if (!origin) return
        try {
          const res = await doFetch(`${origin}/agent/resume/claim`, {
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
        return
      }
      case 'AgentRevoke': {
        const origin = deriveOrigin(host)
        if (!origin) return
        try {
          await doFetch(`${origin}/agent/revoke`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ tid: effect.tid }),
          })
        } catch {
          /* quiet */
        }
        return
      }
      case 'AgentSessionsList': {
        const origin = deriveOrigin(host)
        if (!origin) return
        try {
          const res = await doFetch(`${origin}/agent/sessions`, {
            method: 'GET',
            credentials: 'include',
          })
          if (!res.ok) return
          const body = (await res.json()) as SessionsResponse
          host.send(host.wrapAgentConnect({ type: 'SessionsLoaded', sessions: body.sessions }))
        } catch {
          /* quiet */
        }
        return
      }
      case 'AgentForwardMsg': {
        host.forward(effect.payload)
        return
      }
    }
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}

function deriveOrigin(_host: EffectHandlerHost): string | null {
  // When running in the browser, `location.origin` is correct (the agent endpoints
  // are same-origin with the app per spec §6.2). When not in a browser (tests),
  // the test-side host can override by monkeypatching in its own effect handler.
  if (typeof location !== 'undefined') return location.origin
  return null
}
