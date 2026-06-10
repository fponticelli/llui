import type { Send, Signal } from '@llui/dom'
import { useContext, tagSend } from '@llui/dom'
import { LocaleContext } from '../locale.js'
import type { PresenceStatus } from './presence.js'

/**
 * Toast — ephemeral non-modal notifications rendered in a fixed region.
 * Multiple toasts can be active at once. Each has a duration after which
 * it auto-dismisses (unless paused or sticky).
 *
 * Architecture (timer-free, tick-driven — same division of labor as timer.ts):
 *   - `toast.toaster` state manages a collection of toasts. Each toast carries
 *     its own countdown in state: `duration` (null = sticky), `remainingMs`,
 *     and `paused`.
 *   - The machine owns NO interval. The consumer drives the countdown with a
 *     `tick(id, elapsedMs)` message (e.g. via @llui/effects `interval`),
 *     subtracting the elapsed wall time since the last tick. A `paused` toast
 *     freezes its `remainingMs` (ticks are ignored).
 *   - When `remainingMs` hits 0 the REDUCER dismisses that toast itself, so
 *     there is no consumer/runtime race over who removes it.
 *
 * Presence (exit animation) — additive, opt-in via `init({ animated: true })`:
 *   - Each toast carries a presence `status` (closed/opening/open/closing).
 *     A freshly created toast is born `'open'` (no enter-animation gate — toasts
 *     appear immediately).
 *   - Dismissing a toast (manually or when its countdown reaches 0) moves it to
 *     `'closing'` and KEEPS IT MOUNTED so it can play an exit animation; an
 *     `animationEnd(id)` message then removes it from the queue.
 *   - When the toaster is NOT animated, dismiss removes the toast SYNCHRONOUSLY
 *     (today's behavior) — never waiting for an animationend that won't fire.
 */

export type ToastType = 'info' | 'success' | 'warning' | 'error' | 'loading' | 'custom'
export type ToastPlacement =
  | 'top'
  | 'top-start'
  | 'top-end'
  | 'bottom'
  | 'bottom-start'
  | 'bottom-end'

/** aria-live politeness for a toast's announcement region. */
export type ToastPoliteness = 'polite' | 'assertive'

export interface Toast {
  id: string
  type: ToastType
  title?: string
  description?: string
  /** ms until auto-dismiss. `null` = sticky (never auto-dismisses). */
  duration: number | null
  /** ms left before auto-dismiss. Counts down via `tick`. */
  remainingMs: number
  /** Whether the toast can be manually dismissed. */
  dismissable: boolean
  /** Pause flag — frozen countdown while set (consumer sets on hover/focus). */
  paused: boolean
  /** Optional per-toast politeness override; otherwise derived from `type`. */
  ariaLive?: ToastPoliteness
  /**
   * Presence lifecycle for this toast (closed/opening/open/closing). Born
   * `'open'`; a dismiss moves it to `'closing'` (when the toaster is animated)
   * so it can play an exit animation before `animationEnd` removes it.
   */
  status: PresenceStatus
}

export interface ToasterState {
  toasts: Toast[]
  max: number
  placement: ToastPlacement
  /**
   * Whether dismissed toasts play an exit animation. When true a dismiss moves
   * the toast to `'closing'` (kept mounted) until `animationEnd` removes it;
   * when false (default) dismiss removes synchronously — today's behavior, no
   * wait for an animationend that won't fire.
   */
  animated: boolean
}

/** A new toast as supplied to `create`. `remainingMs`/`paused`/`status` are
 * optional — seeded from `duration`/`false`/`'open'` when omitted. */
export type ToastInput = Omit<Toast, 'remainingMs' | 'paused' | 'status'> & {
  remainingMs?: number
  paused?: boolean
  status?: PresenceStatus
}

export type ToasterMsg =
  /** @intent("Show a new toast notification") */
  | { type: 'create'; toast: ToastInput }
  /** @intent("Dismiss the toast with the given id") */
  | { type: 'dismiss'; id: string }
  /** @intent("Dismiss every toast currently visible") */
  | { type: 'dismissAll' }
  /** @intent("Patch fields on the toast with the given id (title, description, type, etc.)") */
  | { type: 'update'; id: string; patch: Partial<Toast> }
  /** @humanOnly Advance the countdown for one toast by `elapsedMs` since the last tick. */
  | { type: 'tick'; id: string; elapsedMs: number }
  /** @intent("Pause auto-dismiss countdown for the toast with the given id") */
  | { type: 'pause'; id: string }
  /** @intent("Resume auto-dismiss countdown for the toast with the given id") */
  | { type: 'resume'; id: string }
  /** @intent("Pause auto-dismiss for every visible toast") */
  | { type: 'pauseAll' }
  /** @intent("Resume auto-dismiss for every visible toast") */
  | { type: 'resumeAll' }
  /** @humanOnly Exit animation finished for the toast with the given id — remove it from the queue. */
  | { type: 'animationEnd'; id: string }

export interface ToasterInit {
  max?: number
  placement?: ToastPlacement
  /** Play an exit animation on dismiss (toasts go to `'closing'` and stay
   * mounted until `animationEnd`). Default false — instant removal. */
  animated?: boolean
}

export function init(opts: ToasterInit = {}): ToasterState {
  return {
    toasts: [],
    max: opts.max ?? 5,
    placement: opts.placement ?? 'bottom-end',
    animated: opts.animated ?? false,
  }
}

/** Whether a toast auto-dismisses (has a finite, non-null duration). */
function isCountingDown(t: Toast): boolean {
  return t.duration !== null
}

/**
 * Close the toasts whose id matches `match`. When the toaster is animated this
 * moves them to `'closing'` (kept mounted, exit animation plays, removed later
 * by `animationEnd`); when not animated they are filtered out synchronously —
 * today's instant unmount, never waiting for an animationend that won't fire.
 * Already-`'closing'` toasts are left untouched so re-dismissing is idempotent.
 */
function closeToasts(state: ToasterState, match: (t: Toast) => boolean): ToasterState {
  if (!state.animated) {
    return { ...state, toasts: state.toasts.filter((t) => !match(t)) }
  }
  return {
    ...state,
    toasts: state.toasts.map((t) =>
      match(t) && t.status !== 'closing' ? { ...t, status: 'closing' } : t,
    ),
  }
}

export function update(state: ToasterState, msg: ToasterMsg): [ToasterState, never[]] {
  switch (msg.type) {
    case 'create': {
      const { remainingMs, paused, status, ...rest } = msg.toast
      const toast: Toast = {
        ...rest,
        paused: paused ?? false,
        remainingMs: remainingMs ?? rest.duration ?? 0,
        status: status ?? 'open',
      }
      const toasts = [...state.toasts, toast]
      // Enforce max — drop oldest
      const trimmed = toasts.length > state.max ? toasts.slice(-state.max) : toasts
      return [{ ...state, toasts: trimmed }, []]
    }
    case 'dismiss':
      return [closeToasts(state, (t) => t.id === msg.id), []]
    case 'dismissAll':
      return [closeToasts(state, () => true), []]
    case 'animationEnd':
      // Exit animation done — remove the now-`'closing'` toast from the queue.
      return [
        {
          ...state,
          toasts: state.toasts.filter((t) => !(t.id === msg.id && t.status === 'closing')),
        },
        [],
      ]
    case 'update':
      return [
        {
          ...state,
          toasts: state.toasts.map((t) => (t.id === msg.id ? { ...t, ...msg.patch } : t)),
        },
        [],
      ]
    case 'tick': {
      const target = state.toasts.find((t) => t.id === msg.id)
      if (!target) return [state, []]
      // Sticky, paused, or already-closing toasts freeze their countdown.
      if (!isCountingDown(target) || target.paused || target.status === 'closing') {
        return [state, []]
      }
      const remainingMs = target.remainingMs - msg.elapsedMs
      // Reducer owns expiry: dismiss self once the countdown is spent (moves to
      // `'closing'` when animated, removes synchronously otherwise).
      if (remainingMs <= 0) {
        return [closeToasts(state, (t) => t.id === msg.id), []]
      }
      return [
        {
          ...state,
          toasts: state.toasts.map((t) => (t.id === msg.id ? { ...t, remainingMs } : t)),
        },
        [],
      ]
    }
    case 'pause':
      return [
        {
          ...state,
          toasts: state.toasts.map((t) => (t.id === msg.id ? { ...t, paused: true } : t)),
        },
        [],
      ]
    case 'resume':
      return [
        {
          ...state,
          toasts: state.toasts.map((t) => (t.id === msg.id ? { ...t, paused: false } : t)),
        },
        [],
      ]
    case 'pauseAll':
      return [{ ...state, toasts: state.toasts.map((t) => ({ ...t, paused: true })) }, []]
    case 'resumeAll':
      return [{ ...state, toasts: state.toasts.map((t) => ({ ...t, paused: false })) }, []]
  }
}

let toastIdCounter = 0
export function nextToastId(): string {
  return `toast-${++toastIdCounter}`
}

/** Resolve the announcement politeness for a toast: explicit override, else
 * `error` → assertive, everything else → polite. */
export function politeness(toast: Pick<Toast, 'type' | 'ariaLive'>): ToastPoliteness {
  if (toast.ariaLive) return toast.ariaLive
  return toast.type === 'error' ? 'assertive' : 'polite'
}

/** Fraction of the countdown remaining for a given toast, in [0,1]. Sticky
 * toasts report 1; a missing toast reports 0. */
export function progress(state: ToasterState, id: string): number {
  const t = state.toasts.find((x) => x.id === id)
  if (!t) return 0
  if (t.duration === null || t.duration <= 0) return 1
  const frac = t.remainingMs / t.duration
  return frac < 0 ? 0 : frac > 1 ? 1 : frac
}

export interface ToastItemParts {
  root: {
    role: 'status' | 'alert'
    'aria-atomic': 'true'
    'aria-live': ToastPoliteness
    id: string
    'data-scope': 'toast'
    'data-part': 'root'
    'data-type': ToastType
    'data-id': string
    /** Reactive presence status (closed/opening/open/closing) for CSS-driven
     * enter/exit animations. */
    'data-state': Signal<PresenceStatus>
    onPointerEnter: (e: PointerEvent) => void
    onPointerLeave: (e: PointerEvent) => void
    onFocus: (e: FocusEvent) => void
    onBlur: (e: FocusEvent) => void
    /** Advance past the exit animation: a `'closing'` toast is removed from the
     * queue once its animation/transition ends. */
    onAnimationEnd: (e: AnimationEvent) => void
    onTransitionEnd: (e: TransitionEvent) => void
  }
  title: {
    id: string
    'data-scope': 'toast'
    'data-part': 'title'
  }
  description: {
    id: string
    'data-scope': 'toast'
    'data-part': 'description'
  }
  closeTrigger: {
    type: 'button'
    'aria-label': string
    'data-scope': 'toast'
    'data-part': 'close-trigger'
    onClick: (e: MouseEvent) => void
  }
}

export interface ToasterParts {
  region: {
    role: 'region'
    'aria-label': string
    tabindex: -1
    'data-scope': 'toast'
    'data-part': 'region'
    'data-placement': Signal<ToastPlacement>
  }
  /**
   * Build the per-row part descriptors for one toast. Takes the row's
   * `Signal<Toast>` (e.g. the `item` from `each`) rather than a snapshot, so
   * consumers don't `.peek()` in a reactive slot (which the signal compiler
   * rejects). A toast's `id`/`type`/`ariaLive` are immutable for its lifetime —
   * created then dismissed, never structurally replaced — so this reads the
   * value once internally to build the id/role wiring; the keyed `each`
   * rebuilds the row if `id` changes.
   */
  toast: (toast: Signal<Toast>) => ToastItemParts
  /**
   * Reactive fraction (in [0,1]) of the countdown remaining for the toast with
   * `id` — for a countdown progress bar. Sticky toasts report 1; a dismissed /
   * missing toast reports 0.
   */
  progress: (id: string) => Signal<number>
  /**
   * Reactive presence: whether the toast with `id` is still in the queue (i.e.
   * should be mounted). Stays true through `'closing'` so the exit animation can
   * play; flips false once `animationEnd` removes it. The keyed `each` over
   * `toasts` already handles the actual mount/unmount — this is for consumers
   * coordinating other elements off a single toast's lifecycle.
   */
  isPresent: (id: string) => Signal<boolean>
}

export interface ConnectOptions {
  regionLabel?: string
  closeLabel?: string
}

export function connect(
  state: Signal<ToasterState>,
  send: Send<ToasterMsg>,
  opts: ConnectOptions = {},
): ToasterParts {
  const locale = useContext(LocaleContext)
  const regionLabel = opts.regionLabel ?? locale.toast.region
  const closeLabel = opts.closeLabel ?? locale.toast.dismiss

  return {
    region: {
      role: 'region',
      'aria-label': regionLabel,
      tabindex: -1,
      'data-scope': 'toast',
      'data-part': 'region',
      'data-placement': state.map((s) => s.placement),
    },
    toast: (toastSig: Signal<Toast>): ToastItemParts => {
      // A toast's identity-bearing fields (id, type, ariaLive) are immutable for
      // its id's lifetime (created → dismissed, never structurally replaced), so
      // read it once to build the id/role-derived descriptors. The keyed `each`
      // rebuilds this row if `id` changes.
      const toast = toastSig.peek()
      const live = politeness(toast)
      const onEnd = (): void => send({ type: 'animationEnd', id: toast.id })
      return {
        root: {
          role: live === 'assertive' ? 'alert' : 'status',
          'aria-atomic': 'true',
          'aria-live': live,
          id: `${toast.id}:root`,
          'data-scope': 'toast',
          'data-part': 'root',
          'data-type': toast.type,
          'data-id': toast.id,
          'data-state': toastSig.map((t) => t.status),
          onPointerEnter: tagSend(send, ['pause'], () => send({ type: 'pause', id: toast.id })),
          onPointerLeave: tagSend(send, ['resume'], () => send({ type: 'resume', id: toast.id })),
          onFocus: tagSend(send, ['pause'], () => send({ type: 'pause', id: toast.id })),
          onBlur: tagSend(send, ['resume'], () => send({ type: 'resume', id: toast.id })),
          onAnimationEnd: onEnd,
          onTransitionEnd: onEnd,
        },
        title: {
          id: `${toast.id}:title`,
          'data-scope': 'toast',
          'data-part': 'title',
        },
        description: {
          id: `${toast.id}:description`,
          'data-scope': 'toast',
          'data-part': 'description',
        },
        closeTrigger: {
          type: 'button',
          'aria-label': closeLabel,
          'data-scope': 'toast',
          'data-part': 'close-trigger',
          onClick: tagSend(send, ['dismiss'], () => send({ type: 'dismiss', id: toast.id })),
        },
      }
    },
    progress: (id: string): Signal<number> => state.map((s) => progress(s, id)),
    isPresent: (id: string): Signal<boolean> => state.map((s) => s.toasts.some((t) => t.id === id)),
  }
}

/** Whether a toast with the given id is in the queue (mounted). Stays true
 * through `'closing'`; false once `animationEnd` removes it. */
export function isPresent(state: ToasterState, id: string): boolean {
  return state.toasts.some((t) => t.id === id)
}

export const toast = {
  init,
  update,
  connect,
  nextToastId,
  politeness,
  progress,
  isPresent,
}
