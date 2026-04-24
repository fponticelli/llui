import { randomUUID } from '../uuid.js'
import { handleListActions, type ListActionsHost } from './list-actions.js'
import type {
  LapActionsResponse,
  LapDrainMeta,
  LapMessageResponse,
  MessageAnnotations,
} from '../../protocol.js'

export type SendMessageArgs = {
  msg: { type: string; [k: string]: unknown }
  reason?: string
  /** See LapMessageRequest['waitFor']. Default: 'drained'. */
  waitFor?: 'drained' | 'idle' | 'none'
  /** See LapMessageRequest['drainQuietMs']. Default: 100ms. */
  drainQuietMs?: number
  /** See LapMessageRequest['timeoutMs']. Default: 5000ms. */
  timeoutMs?: number
}

export type SendMessageHost = ListActionsHost & {
  getState(): unknown
  send(msg: unknown): void
  flush(): void
  /**
   * Register a listener called after every update cycle commits —
   * backed by `AppHandle.subscribe`. Returns an unsubscribe function.
   * The drain loop uses this to detect message-queue quiescence: each
   * listener fire resets the quiet-window timer; no fires for
   * `drainQuietMs` means the loop has gone idle and async effects (if
   * any) have either completed or are persistent
   * (websocket/interval/storageWatch).
   */
  subscribe(listener: () => void): () => void
  getMsgAnnotations(): Record<string, MessageAnnotations> | null
  /**
   * Snapshot and clear the drain-error buffer. The agent factory
   * installs persistent `window.error` / `unhandledrejection`
   * listeners that accumulate into this buffer; calling this at the
   * start of a drain discards stale errors from prior windows, and
   * calling it at the end yields just the errors that fired during
   * this drain. Optional — when omitted (e.g., Node test harness
   * without `window`), the drain envelope records an empty array.
   */
  getAndClearDrainErrors?: () => LapDrainMeta['errors']
  /** Called when @requiresConfirm; caller stores a ConfirmEntry in state. */
  proposeConfirm(entry: {
    id: string
    variant: string
    payload: unknown
    intent: string
    reason: string | null
    proposedAt: number
    status: 'pending'
  }): void
}

const DEFAULT_QUIET_MS = 100
const DEFAULT_TIMEOUT_MS = 5_000

export async function handleSendMessage(
  host: SendMessageHost,
  args: SendMessageArgs,
): Promise<LapMessageResponse> {
  if (!args.msg || typeof args.msg.type !== 'string') {
    return { status: 'rejected', reason: 'invalid' }
  }
  const annotations = host.getMsgAnnotations() ?? {}
  const ann = annotations[args.msg.type]

  // If annotations map is non-empty and this variant isn't in it, it's an
  // unknown msg type that the app never declared — reject early so the
  // browser never dispatches an unrecognised variant into update().
  const hasAnnotations = Object.keys(annotations).length > 0
  if (hasAnnotations && !ann) {
    return { status: 'rejected', reason: 'invalid', detail: `unknown variant: ${args.msg.type}` }
  }

  if (ann?.humanOnly) {
    return { status: 'rejected', reason: 'humanOnly' }
  }
  if (ann?.requiresConfirm) {
    const id = randomUUID()
    const { type: _type, ...payload } = args.msg
    host.proposeConfirm({
      id,
      variant: args.msg.type,
      payload,
      intent: ann?.intent ?? args.msg.type,
      reason: args.reason ?? null,
      proposedAt: Date.now(),
      status: 'pending',
    })
    return { status: 'pending-confirmation', confirmId: id }
  }

  const waitFor = args.waitFor ?? 'drained'
  const quietMs = Math.max(0, args.drainQuietMs ?? DEFAULT_QUIET_MS)
  const capMs = Math.max(0, args.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  if (waitFor === 'none') {
    host.send(args.msg)
    return dispatched(host, emptyDrain())
  }

  if (waitFor === 'idle') {
    host.send(args.msg)
    host.flush()
    await Promise.resolve()
    return dispatched(host, { effectsObserved: 1, durationMs: 0, timedOut: false, errors: [] })
  }

  // waitFor === 'drained' — message-queue quiescence detection.
  // Clear any errors buffered before this call so `drain.errors`
  // attributes only to this window.
  host.getAndClearDrainErrors?.()

  const t0 = now()
  let observed = 0
  let wake: ((reason: 'msg' | 'timeout') => void) | null = null
  const unsub = host.subscribe(() => {
    observed++
    const w = wake
    wake = null
    w?.('msg')
  })
  try {
    host.send(args.msg)
    host.flush()

    while (true) {
      const elapsed = now() - t0
      if (elapsed >= capMs) {
        return dispatched(host, {
          effectsObserved: observed,
          durationMs: elapsed,
          timedOut: true,
          errors: host.getAndClearDrainErrors?.() ?? [],
        })
      }
      const budget = Math.min(quietMs, capMs - elapsed)
      // When the cap is within `quietMs` of `elapsed`, the quiet
      // window is truncated. In that case a timeout resolution does
      // NOT mean we detected quiescence — it means the cap cut the
      // window short. Only a full-length quiet window that elapses
      // without a new commit counts as real idle.
      const fullQuiet = budget >= quietMs
      const reason = await awaitQuietOrMsg(budget, (resolve) => {
        wake = resolve
      })
      if (reason === 'timeout') {
        return dispatched(host, {
          effectsObserved: observed,
          durationMs: now() - t0,
          timedOut: !fullQuiet,
          errors: host.getAndClearDrainErrors?.() ?? [],
        })
      }
      // A commit fired during the wait — flush any queued follow-ups so
      // effects dispatched by that cycle run before we re-check.
      host.flush()
    }
  } finally {
    unsub()
  }
}

function dispatched(host: SendMessageHost, drain: LapDrainMeta): LapMessageResponse {
  return {
    status: 'dispatched',
    stateAfter: host.getState(),
    actions: handleListActions(host).actions,
    drain,
  }
}

function emptyDrain(): LapDrainMeta {
  return { effectsObserved: 0, durationMs: 0, timedOut: false, errors: [] }
}

function awaitQuietOrMsg(
  budgetMs: number,
  registerWake: (resolve: (r: 'msg' | 'timeout') => void) => void,
): Promise<'msg' | 'timeout'> {
  return new Promise<'msg' | 'timeout'>((resolve) => {
    let settled = false
    const guarded = (r: 'msg' | 'timeout') => {
      if (settled) return
      settled = true
      resolve(r)
    }
    registerWake(guarded)
    setTimeout(() => guarded('timeout'), budgetMs)
  })
}

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}

// Helper types for external callers that want the dispatched envelope.
export type DispatchedEnvelope = Extract<LapMessageResponse, { status: 'dispatched' }>
export type { LapActionsResponse }
