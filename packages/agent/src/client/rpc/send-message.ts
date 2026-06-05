import { randomUUID } from '../uuid.js'
import { handleListActions, type ListActionsHost } from './list-actions.js'
import { computeStateDiff } from '../../state-diff.js'
import { validatePayload } from './validate-payload.js'
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
  /** See LapMessageRequest['includeState']. Default: false. */
  includeState?: boolean
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
  /**
   * Optional dispatch-policy accessor — when defined, returns the
   * server's configured `'strict' | 'lenient'` policy for payload
   * validation. Strict mode rejects fields not in the schema and
   * emits warnings for `'unknown'`-typed fields the agent provided
   * values for. Default is lenient (omit / undefined).
   */
  getDispatchPolicy?: () => 'strict' | 'lenient'
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

  if (ann?.dispatchMode === 'human-only') {
    // Enrich the rejection with a human-readable reason so the agent learns
    // WHY (not just the bare `human-only` code). Route-gate enforcement is
    // deliberately NOT applied on dispatch: `@routeGated` is an affordance-
    // visibility concern (surfaced in list_actions as available:false), and a
    // broken/throwing predicate must never be able to block a real dispatch.
    return {
      status: 'rejected',
      reason: 'human-only',
      detail: ann.intent
        ? `"${ann.intent}" can only be triggered by the user (human-only action)`
        : 'this action can only be triggered by the user (human-only)',
    }
  }

  // Schema validation: when the compiler emitted a `__msgSchema`,
  // check the payload against this variant's field shape before
  // dispatch. Catches the everyday agent bug — missing required
  // field, wrong enum value, missing discriminant on a tagged union,
  // typo in a key name — early, with structured errors the LLM can
  // correct from in one round trip. Reducers stay the last line of
  // defense; this is the first.
  const schema = host.getMsgSchema?.() ?? null
  const policy = host.getDispatchPolicy?.() ?? 'lenient'
  const validation = validatePayload(args.msg, schema, { policy })
  if (!validation.ok) {
    return {
      status: 'rejected',
      reason: 'invalid',
      detail: validation.errors.map((e) => `${e.path}: ${e.message}`).join('; '),
    }
  }
  // Warnings from the validator (strict-mode `untyped-field` flags etc.)
  // ride along to `drain.warnings` so the agent sees them on the
  // dispatched envelope. Lenient mode never emits warnings; this is
  // a no-op array for the default path.
  const validationWarnings = validation.warnings ?? []

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

  // Snapshot pre-dispatch state for diffing. The host's `getState`
  // returns a reference; capturing it here keeps a pre-mutation
  // pointer even after `host.send` triggers reducer-driven state
  // replacement (state itself is immutable per LLui's TEA contract,
  // so the reference stays valid).
  const prevState = host.getState()

  const includeState = args.includeState === true

  if (waitFor === 'none') {
    safeSend(host, args.msg, [])
    return dispatched(host, emptyDrain(), prevState, includeState, validationWarnings)
  }

  if (waitFor === 'idle') {
    const dispatchErrors: LapDrainMeta['errors'] = []
    safeSendAndFlush(host, args.msg, dispatchErrors)
    await Promise.resolve()
    return dispatched(
      host,
      { effectsObserved: 1, durationMs: 0, timedOut: false, errors: dispatchErrors },
      prevState,
      includeState,
      validationWarnings,
    )
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
  // Synchronous throws during send/flush — captured here and folded
  // into drain.errors. Async post-flush errors come in via
  // `getAndClearDrainErrors` (effect handler crashes, async rejections
  // observed by the runtime) and are merged at response time.
  const dispatchErrors: LapDrainMeta['errors'] = []
  try {
    safeSendAndFlush(host, args.msg, dispatchErrors)

    while (true) {
      const elapsed = now() - t0
      if (elapsed >= capMs) {
        return dispatched(
          host,
          {
            effectsObserved: observed,
            durationMs: elapsed,
            timedOut: true,
            errors: mergeDrainErrors(dispatchErrors, host.getAndClearDrainErrors?.()),
          },
          prevState,
          includeState,
          validationWarnings,
        )
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
        return dispatched(
          host,
          {
            effectsObserved: observed,
            durationMs: now() - t0,
            timedOut: !fullQuiet,
            errors: mergeDrainErrors(dispatchErrors, host.getAndClearDrainErrors?.()),
          },
          prevState,
          includeState,
          validationWarnings,
        )
      }
      // A commit fired during the wait — flush any queued follow-ups so
      // effects dispatched by that cycle run before we re-check.
      try {
        host.flush()
      } catch (e) {
        dispatchErrors.push(toDrainError(e))
      }
    }
  } finally {
    unsub()
  }
}

/**
 * Send a Msg and capture any synchronous throw into `errors` rather
 * than letting it propagate to the WS RPC layer. By the time `send`
 * has thrown, the reducer may have partially run (state can advance),
 * but bindings or downstream effects on the same commit may have
 * crashed mid-flight. From the agent's POV: the dispatch IS dispatched,
 * the state diff reflects what actually changed, and `drain.errors`
 * reports the in-flight crash. That's strictly more useful than HTTP
 * 500, which the agent reads as "the dispatch never happened."
 */
function safeSend(
  host: SendMessageHost,
  msg: { type: string; [k: string]: unknown },
  errors: LapDrainMeta['errors'],
): void {
  try {
    host.send(msg)
  } catch (e) {
    errors.push(toDrainError(e))
  }
}

function safeSendAndFlush(
  host: SendMessageHost,
  msg: { type: string; [k: string]: unknown },
  errors: LapDrainMeta['errors'],
): void {
  try {
    host.send(msg)
  } catch (e) {
    errors.push(toDrainError(e))
    return // can't flush something we never sent
  }
  try {
    host.flush()
  } catch (e) {
    errors.push(toDrainError(e))
  }
}

function toDrainError(e: unknown): LapDrainMeta['errors'][number] {
  if (e instanceof Error) {
    const stack = e.stack ? e.stack.split('\n').slice(0, 8).join('\n') : undefined
    return stack !== undefined
      ? { kind: 'error', message: `${e.name}: ${e.message}`, stack }
      : { kind: 'error', message: `${e.name}: ${e.message}` }
  }
  return { kind: 'error', message: String(e) }
}

function mergeDrainErrors(
  fromDispatch: LapDrainMeta['errors'],
  fromHost: LapDrainMeta['errors'] | undefined,
): LapDrainMeta['errors'] {
  if (!fromHost || fromHost.length === 0) return fromDispatch
  if (fromDispatch.length === 0) return fromHost
  return [...fromDispatch, ...fromHost]
}

function dispatched(
  host: SendMessageHost,
  drain: LapDrainMeta,
  prevState: unknown,
  includeState: boolean,
  validationWarnings: NonNullable<LapDrainMeta['warnings']> = [],
): LapMessageResponse {
  const stateAfter = host.getState()
  const drainWithWarnings: LapDrainMeta =
    validationWarnings.length === 0 ? drain : { ...drain, warnings: validationWarnings }
  const base = {
    status: 'dispatched' as const,
    stateDiff: computeStateDiff(prevState, stateAfter),
    actions: handleListActions(host).actions,
    drain: drainWithWarnings,
  }
  return includeState ? { ...base, stateAfter } : base
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
