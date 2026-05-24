// In-memory registry of LLM-initiated capture requests awaiting a HUD
// (or middleware-side timeout). Each `submit()` returns a promise that
// resolves when the HUD posts back a fulfillment, or when timeout/cancel
// fires — whichever comes first.
//
// The HTTP layer holds the request open (long-poll) and awaits this
// promise; the SSE layer pushes the `capture-request` event to the HUD.

import { randomUUID } from 'node:crypto'

import type { CaptureRequestPayload, CaptureRequestResponse, CreateNoteResponse } from './types.js'

export interface SubmitOptions {
  /** Whether a HUD is currently subscribed. If false, the promise
   *  resolves immediately with status:no-client so the MCP server can
   *  fall through to the Playwright fallback. */
  hudConnected: boolean
  /** ms before the promise resolves with status:timeout. */
  timeoutMs: number
}

export interface SubmitResult {
  requestId: string
  promise: Promise<CaptureRequestResponse>
  payload: CaptureRequestPayload
}

export interface CaptureRegistry {
  submit(payload: CaptureRequestPayload, opts: SubmitOptions): SubmitResult
  fulfill(requestId: string, note: CreateNoteResponse): boolean
  cancel(requestId: string, status: 'timeout' | 'no-client'): boolean
  listPending(): string[]
}

interface PendingEntry {
  resolve: (r: CaptureRequestResponse) => void
  timeout: NodeJS.Timeout | null
}

export function createCaptureRegistry(): CaptureRegistry {
  const pending = new Map<string, PendingEntry>()

  function resolveAndRemove(requestId: string, response: CaptureRequestResponse): boolean {
    const entry = pending.get(requestId)
    if (!entry) return false
    pending.delete(requestId)
    if (entry.timeout) clearTimeout(entry.timeout)
    entry.resolve(response)
    return true
  }

  return {
    submit(payload, opts) {
      const requestId = randomUUID()

      if (!opts.hudConnected) {
        // Fast-path: HUD not connected, resolve immediately. The MCP
        // server reads `no-client` and decides whether to Playwright-
        // fallback or surface the error to the LLM. The middleware
        // never holds the response open in this case.
        return {
          requestId,
          payload,
          promise: Promise.resolve<CaptureRequestResponse>({
            requestId,
            status: 'no-client',
          }),
        }
      }

      let resolveFn!: (r: CaptureRequestResponse) => void
      const promise = new Promise<CaptureRequestResponse>((res) => {
        resolveFn = res
      })

      const entry: PendingEntry = {
        resolve: resolveFn,
        timeout: setTimeout(() => {
          resolveAndRemove(requestId, { requestId, status: 'timeout' })
        }, opts.timeoutMs),
      }
      pending.set(requestId, entry)

      return { requestId, payload, promise }
    },

    fulfill(requestId, note) {
      return resolveAndRemove(requestId, { requestId, status: 'fulfilled', note })
    },

    cancel(requestId, status) {
      return resolveAndRemove(requestId, { requestId, status })
    },

    listPending() {
      return [...pending.keys()]
    },
  }
}
