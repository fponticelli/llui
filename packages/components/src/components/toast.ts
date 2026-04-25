import type { Send } from '@llui/dom'
import { useContext } from '@llui/dom'
import { LocaleContext } from '../locale.js'
import type { Locale } from '../locale.js'

/**
 * Toast — ephemeral non-modal notifications rendered in a fixed region.
 * Multiple toasts can be active at once. Each has a duration after which
 * it auto-dismisses (unless paused or persistent).
 *
 * Architecture:
 *   - `toast.toaster` state manages a collection of toasts.
 *   - Duration countdown is handled externally — the consumer schedules
 *     a `dismiss` message via setTimeout (or uses the `scheduleDismiss`
 *     effect-style helper in your onEffect handler).
 */

export type ToastType = 'info' | 'success' | 'warning' | 'error' | 'loading' | 'custom'
export type ToastPlacement =
  | 'top'
  | 'top-start'
  | 'top-end'
  | 'bottom'
  | 'bottom-start'
  | 'bottom-end'

export interface Toast {
  id: string
  type: ToastType
  title?: string
  description?: string
  /** ms until auto-dismiss. Use Infinity for persistent. */
  duration: number
  /** Whether the toast can be manually dismissed. */
  dismissable: boolean
  /** Optional pause flag — consumer sets while user hovers. */
  paused: boolean
}

export interface ToasterState {
  toasts: Toast[]
  max: number
  placement: ToastPlacement
}

export type ToasterMsg =
  /** @intent("Create") */
  | { type: 'create'; toast: Omit<Toast, 'paused'> & { paused?: boolean } }
  /** @intent("Dismiss") */
  | { type: 'dismiss'; id: string }
  /** @intent("Dismiss All") */
  | { type: 'dismissAll' }
  /** @intent("Update") */
  | { type: 'update'; id: string; patch: Partial<Toast> }
  /** @intent("Pause") */
  | { type: 'pause'; id: string }
  /** @intent("Resume") */
  | { type: 'resume'; id: string }
  /** @intent("Pause All") */
  | { type: 'pauseAll' }
  /** @intent("Resume All") */
  | { type: 'resumeAll' }

export interface ToasterInit {
  max?: number
  placement?: ToastPlacement
}

export function init(opts: ToasterInit = {}): ToasterState {
  return {
    toasts: [],
    max: opts.max ?? 5,
    placement: opts.placement ?? 'bottom-end',
  }
}

export function update(state: ToasterState, msg: ToasterMsg): [ToasterState, never[]] {
  switch (msg.type) {
    case 'create': {
      const toast: Toast = { paused: false, ...msg.toast }
      const toasts = [...state.toasts, toast]
      // Enforce max — drop oldest
      const trimmed = toasts.length > state.max ? toasts.slice(-state.max) : toasts
      return [{ ...state, toasts: trimmed }, []]
    }
    case 'dismiss':
      return [{ ...state, toasts: state.toasts.filter((t) => t.id !== msg.id) }, []]
    case 'dismissAll':
      return [{ ...state, toasts: [] }, []]
    case 'update':
      return [
        {
          ...state,
          toasts: state.toasts.map((t) => (t.id === msg.id ? { ...t, ...msg.patch } : t)),
        },
        [],
      ]
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

export interface ToastItemParts<S> {
  root: {
    role: 'status'
    'aria-atomic': 'true'
    'aria-live': 'polite' | 'assertive'
    id: string
    'data-scope': 'toast'
    'data-part': 'root'
    'data-type': ToastType
    'data-id': string
    onPointerEnter: (e: PointerEvent) => void
    onPointerLeave: (e: PointerEvent) => void
    onFocus: (e: FocusEvent) => void
    onBlur: (e: FocusEvent) => void
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
    'aria-label': string | ((s: S) => string)
    'data-scope': 'toast'
    'data-part': 'close-trigger'
    onClick: (e: MouseEvent) => void
  }
}

export interface ToasterParts<S> {
  region: {
    role: 'region'
    'aria-label': string | ((s: S) => string)
    tabIndex: -1
    'data-scope': 'toast'
    'data-part': 'region'
    'data-placement': (s: S) => ToastPlacement
  }
  toast: (toast: Toast) => ToastItemParts<S>
}

export interface ConnectOptions {
  regionLabel?: string
  closeLabel?: string
}

export function connect<S>(
  _get: (s: S) => ToasterState,
  send: Send<ToasterMsg>,
  opts: ConnectOptions = {},
): ToasterParts<S> {
  const locale = useContext<S, Locale>(LocaleContext)
  const regionLabel: string | ((s: S) => string) =
    opts.regionLabel ?? ((s: S) => locale(s).toast.region)
  const closeLabel: string | ((s: S) => string) =
    opts.closeLabel ?? ((s: S) => locale(s).toast.dismiss)

  return {
    region: {
      role: 'region',
      'aria-label': regionLabel,
      tabIndex: -1,
      'data-scope': 'toast',
      'data-part': 'region',
      'data-placement': (s) => _get(s).placement,
    },
    toast: (toast: Toast): ToastItemParts<S> => ({
      root: {
        role: 'status',
        'aria-atomic': 'true',
        'aria-live': toast.type === 'error' ? 'assertive' : 'polite',
        id: `${toast.id}:root`,
        'data-scope': 'toast',
        'data-part': 'root',
        'data-type': toast.type,
        'data-id': toast.id,
        onPointerEnter: () => send({ type: 'pause', id: toast.id }),
        onPointerLeave: () => send({ type: 'resume', id: toast.id }),
        onFocus: () => send({ type: 'pause', id: toast.id }),
        onBlur: () => send({ type: 'resume', id: toast.id }),
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
        onClick: () => send({ type: 'dismiss', id: toast.id }),
      },
    }),
  }
}

export const toast = { init, update, connect, nextToastId }
