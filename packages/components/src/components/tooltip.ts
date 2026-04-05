import type { Send, TransitionOptions } from '@llui/dom'
import { show, portal, onMount, div } from '@llui/dom'
import { attachFloating, type Placement } from '../utils/floating'

/**
 * Tooltip — hover / focus-triggered, positioned. Opens after a short delay
 * to avoid flicker from passing pointers, closes immediately on blur or
 * after a grace period on pointer leave.
 *
 * Pure reducer handles only the boolean `open` state; timing (delays,
 * debouncing) lives in the event handlers returned from `connect()`, which
 * close over per-instance timers.
 */

export interface TooltipState {
  open: boolean
}

export type TooltipMsg =
  | { type: 'show' }
  | { type: 'hide' }
  | { type: 'toggle' }
  | { type: 'setOpen'; open: boolean }

export interface TooltipInit {
  open?: boolean
}

export function init(opts: TooltipInit = {}): TooltipState {
  return { open: opts.open ?? false }
}

export function update(state: TooltipState, msg: TooltipMsg): [TooltipState, never[]] {
  switch (msg.type) {
    case 'show':
      return [{ ...state, open: true }, []]
    case 'hide':
      return [{ ...state, open: false }, []]
    case 'toggle':
      return [{ ...state, open: !state.open }, []]
    case 'setOpen':
      return [{ ...state, open: msg.open }, []]
  }
}

export interface TooltipParts<S> {
  trigger: {
    id: string
    'aria-describedby': (s: S) => string | undefined
    'data-state': (s: S) => 'open' | 'closed'
    'data-scope': 'tooltip'
    'data-part': 'trigger'
    onPointerEnter: (e: PointerEvent) => void
    onPointerLeave: (e: PointerEvent) => void
    onFocus: (e: FocusEvent) => void
    onBlur: (e: FocusEvent) => void
    onKeyDown: (e: KeyboardEvent) => void
  }
  positioner: {
    'data-scope': 'tooltip'
    'data-part': 'positioner'
    style: string
  }
  content: {
    role: 'tooltip'
    id: string
    'data-state': (s: S) => 'open' | 'closed'
    'data-scope': 'tooltip'
    'data-part': 'content'
    onPointerEnter: (e: PointerEvent) => void
    onPointerLeave: (e: PointerEvent) => void
  }
  arrow: {
    'data-scope': 'tooltip'
    'data-part': 'arrow'
  }
}

export interface ConnectOptions {
  id: string
  /** ms to wait before opening (default: 300). */
  delayOpen?: number
  /** ms to wait before closing after pointer leaves (default: 100). */
  delayClose?: number
  /** Open immediately on focus without delay (default: true). */
  openOnFocus?: boolean
}

export function connect<S>(
  get: (s: S) => TooltipState,
  send: Send<TooltipMsg>,
  opts: ConnectOptions,
): TooltipParts<S> {
  const base = opts.id
  const triggerId = `${base}:trigger`
  const contentId = `${base}:content`
  const delayOpen = opts.delayOpen ?? 300
  const delayClose = opts.delayClose ?? 100
  const openOnFocus = opts.openOnFocus !== false

  let openTimer: ReturnType<typeof setTimeout> | null = null
  let closeTimer: ReturnType<typeof setTimeout> | null = null

  const clearTimers = (): void => {
    if (openTimer) {
      clearTimeout(openTimer)
      openTimer = null
    }
    if (closeTimer) {
      clearTimeout(closeTimer)
      closeTimer = null
    }
  }

  const scheduleShow = (delay: number): void => {
    clearTimers()
    if (delay <= 0) {
      send({ type: 'show' })
      return
    }
    openTimer = setTimeout(() => {
      openTimer = null
      send({ type: 'show' })
    }, delay)
  }

  const scheduleHide = (delay: number): void => {
    clearTimers()
    if (delay <= 0) {
      send({ type: 'hide' })
      return
    }
    closeTimer = setTimeout(() => {
      closeTimer = null
      send({ type: 'hide' })
    }, delay)
  }

  return {
    trigger: {
      id: triggerId,
      'aria-describedby': (s) => (get(s).open ? contentId : undefined),
      'data-state': (s) => (get(s).open ? 'open' : 'closed'),
      'data-scope': 'tooltip',
      'data-part': 'trigger',
      onPointerEnter: () => scheduleShow(delayOpen),
      onPointerLeave: () => scheduleHide(delayClose),
      onFocus: () => {
        if (openOnFocus) scheduleShow(0)
      },
      onBlur: () => scheduleHide(0),
      onKeyDown: (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          clearTimers()
          send({ type: 'hide' })
        }
      },
    },
    positioner: {
      'data-scope': 'tooltip',
      'data-part': 'positioner',
      style: 'position:absolute;top:0;left:0;pointer-events:none;',
    },
    content: {
      role: 'tooltip',
      id: contentId,
      'data-state': (s) => (get(s).open ? 'open' : 'closed'),
      'data-scope': 'tooltip',
      'data-part': 'content',
      // Allow pointer to enter content without closing (for interactive tooltips)
      onPointerEnter: () => {
        if (closeTimer) {
          clearTimeout(closeTimer)
          closeTimer = null
        }
      },
      onPointerLeave: () => scheduleHide(delayClose),
    },
    arrow: {
      'data-scope': 'tooltip',
      'data-part': 'arrow',
    },
  }
}

export interface OverlayOptions<S> {
  get: (s: S) => TooltipState
  send: Send<TooltipMsg>
  parts: TooltipParts<S>
  content: () => Node[]
  placement?: Placement
  offset?: number
  flip?: boolean
  shift?: boolean
  transition?: TransitionOptions
  target?: string | HTMLElement
  arrowSelector?: string
}

export function overlay<S>(opts: OverlayOptions<S>): Node[] {
  const target = opts.target ?? 'body'
  const placement = opts.placement ?? 'top'
  const offset = opts.offset ?? 6
  const flip = opts.flip !== false
  const shift = opts.shift !== false
  const parts = opts.parts
  const contentId = parts.content.id
  const triggerId = parts.trigger.id

  return show<S, TooltipMsg>({
    when: (s) => opts.get(s).open,
    render: () =>
      portal({
        target,
        render: () => {
          onMount(() => {
            const contentEl = document.getElementById(contentId)
            const triggerEl = document.getElementById(triggerId)
            if (!contentEl || !triggerEl) return

            const positioner = contentEl.closest('[data-part="positioner"]') as HTMLElement | null
            const floatingEl = positioner ?? contentEl
            const arrow = opts.arrowSelector
              ? (contentEl.querySelector(opts.arrowSelector) as HTMLElement | null)
              : null
            return attachFloating({
              anchor: triggerEl,
              floating: floatingEl,
              placement,
              offset,
              flip,
              shift,
              arrow: arrow ?? undefined,
            })
          })
          return [div(parts.positioner, opts.content())]
        },
      }),
    enter: opts.transition?.enter,
    leave: opts.transition?.leave,
  })
}

export const tooltip = { init, update, connect, overlay }
