import { randomUUID } from '../uuid.js'
import { handleListActions, type ListActionsHost } from './list-actions.js'
import { computeStateDiff } from '../../state-diff.js'
import type { MsgSchemaField } from '../factory.js'
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

  if (ann?.dispatchMode === 'human-only') {
    return { status: 'rejected', reason: 'human-only' }
  }

  // Schema validation: when the compiler emitted a `__msgSchema`,
  // check the payload against this variant's field shape before
  // dispatch. Catches the everyday agent bug — missing required
  // field, type-mismatched value, typo in a key name — early, with a
  // structured error the LLM can correct from. The reducer is the
  // last line of defense; this is the first.
  const schema = host.getMsgSchema?.()
  const schemaVariant = schema?.variants[args.msg.type]
  if (schemaVariant !== undefined) {
    const violation = validatePayload(args.msg, schemaVariant)
    if (violation !== null) {
      return { status: 'rejected', reason: 'invalid', detail: violation }
    }
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

  // Snapshot pre-dispatch state for diffing. The host's `getState`
  // returns a reference; capturing it here keeps a pre-mutation
  // pointer even after `host.send` triggers reducer-driven state
  // replacement (state itself is immutable per LLui's TEA contract,
  // so the reference stays valid).
  const prevState = host.getState()

  if (waitFor === 'none') {
    host.send(args.msg)
    return dispatched(host, emptyDrain(), prevState)
  }

  if (waitFor === 'idle') {
    host.send(args.msg)
    host.flush()
    await Promise.resolve()
    return dispatched(
      host,
      { effectsObserved: 1, durationMs: 0, timedOut: false, errors: [] },
      prevState,
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
  try {
    host.send(args.msg)
    host.flush()

    while (true) {
      const elapsed = now() - t0
      if (elapsed >= capMs) {
        return dispatched(
          host,
          {
            effectsObserved: observed,
            durationMs: elapsed,
            timedOut: true,
            errors: host.getAndClearDrainErrors?.() ?? [],
          },
          prevState,
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
            errors: host.getAndClearDrainErrors?.() ?? [],
          },
          prevState,
        )
      }
      // A commit fired during the wait — flush any queued follow-ups so
      // effects dispatched by that cycle run before we re-check.
      host.flush()
    }
  } finally {
    unsub()
  }
}

function dispatched(
  host: SendMessageHost,
  drain: LapDrainMeta,
  prevState: unknown,
): LapMessageResponse {
  const stateAfter = host.getState()
  return {
    status: 'dispatched',
    stateAfter,
    stateDiff: computeStateDiff(prevState, stateAfter),
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

/**
 * Validate `msg` against the variant's field schema. Returns null on
 * pass, a human-readable error string on fail. The check is shallow:
 * only top-level fields are walked, and `'unknown'` types pass any
 * value (the compiler couldn't statically resolve the type, so the
 * agent has to take what update() will accept on faith).
 *
 * Extra fields not in the schema are tolerated. TypeScript's structural
 * subtyping is permissive here too, and Msg payloads often carry
 * fields the discriminator didn't list (analytics tags, request IDs,
 * etc.). Rejecting them would be both surprising and blocked by edits
 * to update.ts that add fields ahead of the schema regenerating.
 */
function validatePayload(
  msg: { type: string; [k: string]: unknown },
  fields: Record<string, MsgSchemaField>,
): string | null {
  for (const [name, descriptor] of Object.entries(fields)) {
    const fieldType = unwrapFieldType(descriptor)
    const optional = isFieldOptional(descriptor)
    const present = name in msg
    if (!present) {
      if (!optional) {
        return `${msg.type}: missing required field '${name}' (expected ${formatType(fieldType)})`
      }
      continue
    }
    const value = msg[name]
    const typeError = checkType(value, fieldType)
    if (typeError !== null) {
      return `${msg.type}: field '${name}' ${typeError}`
    }
  }
  return null
}

type BareType = Exclude<MsgSchemaField, { type: unknown }>

function unwrapFieldType(d: MsgSchemaField): BareType {
  return typeof d === 'object' && d !== null && 'type' in d ? (d.type as BareType) : (d as BareType)
}

function isFieldOptional(d: MsgSchemaField): boolean {
  return typeof d === 'object' && d !== null && 'type' in d && d.optional === true
}

function checkType(value: unknown, t: BareType): string | null {
  if (typeof t === 'string') {
    if (t === 'unknown') return null
    if (t === 'string')
      return typeof value === 'string' ? null : `expected string, got ${typeof value}`
    if (t === 'number')
      return typeof value === 'number' ? null : `expected number, got ${typeof value}`
    if (t === 'boolean')
      return typeof value === 'boolean' ? null : `expected boolean, got ${typeof value}`
    // Unknown literal type code — be lenient. The compiler emits these
    // for keywords the resolver doesn't recognize; rejecting would
    // false-positive on every release that added a new primitive.
    return null
  }
  if ('enum' in t) {
    // Enum: value must be one of the listed strings.
    if (typeof value !== 'string') {
      return `expected one of ${formatEnum(t)}, got ${typeof value}`
    }
    if (!t.enum.includes(value)) {
      return `expected one of ${formatEnum(t)}, got ${JSON.stringify(value)}`
    }
    return null
  }
  // Object/array nested types — defer to the reducer for deep
  // validation. The compiler chased the shape into the schema for
  // synthesis purposes only; deep-checking every nested field would
  // be slow, hard to express good errors for, and duplicates what
  // TypeScript already does at the call site.
  if (t.kind === 'object') {
    return value === null || typeof value !== 'object'
      ? `expected object, got ${value === null ? 'null' : typeof value}`
      : null
  }
  // 'array'
  return Array.isArray(value) ? null : `expected array, got ${typeof value}`
}

function formatType(t: BareType): string {
  if (typeof t === 'string') return t
  if ('enum' in t) return formatEnum(t)
  return t.kind
}

function formatEnum(t: { enum: string[] }): string {
  return `[${t.enum.map((v) => JSON.stringify(v)).join(', ')}]`
}
