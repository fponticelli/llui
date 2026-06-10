import type { Send, Signal, TransitionOptions, Mountable, Renderable } from '@llui/dom'
import { show, portal, onMount, div, tagSend } from '@llui/dom'
import { attachFloating, type Placement } from '../utils/floating.js'
import { pushDismissable } from '../utils/dismissable.js'

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
  /** @intent("Show the tooltip") */
  | { type: 'show' }
  /** @intent("Hide the tooltip") */
  | { type: 'hide' }
  /** @intent("Toggle the tooltip's visibility") */
  | { type: 'toggle' }
  /** @intent("Set the tooltip's open state to a specific value") */
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

export interface TooltipParts {
  trigger: {
    id: string
    'aria-describedby': Signal<string | undefined>
    'data-state': Signal<'open' | 'closed'>
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
    'data-state': Signal<'open' | 'closed'>
    'data-scope': 'tooltip'
    'data-part': 'content'
    onPointerEnter: (e: PointerEvent) => void
    onPointerLeave: (e: PointerEvent) => void
    onKeyDown: (e: KeyboardEvent) => void
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

export function connect(
  state: Signal<TooltipState>,
  send: Send<TooltipMsg>,
  opts: ConnectOptions,
): TooltipParts {
  const base = opts.id
  const triggerId = `${base}:trigger`
  const contentId = `${base}:content`
  const delayOpen = opts.delayOpen ?? 300
  const delayClose = opts.delayClose ?? 100
  const openOnFocus = opts.openOnFocus !== false

  let openTimer: ReturnType<typeof setTimeout> | null = null
  let closeTimer: ReturnType<typeof setTimeout> | null = null

  const cancelClose = (): void => {
    if (closeTimer) {
      clearTimeout(closeTimer)
      closeTimer = null
    }
  }

  const clearTimers = (): void => {
    if (openTimer) {
      clearTimeout(openTimer)
      openTimer = null
    }
    cancelClose()
  }

  const dismissOnEscape = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      clearTimers()
      send({ type: 'hide' })
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
      'aria-describedby': state.map((s) => (s.open ? contentId : undefined)),
      'data-state': state.map((s) => (s.open ? 'open' : 'closed')),
      'data-scope': 'tooltip',
      'data-part': 'trigger',
      onPointerEnter: () => scheduleShow(delayOpen),
      onPointerLeave: () => scheduleHide(delayClose),
      onFocus: () => {
        if (openOnFocus) scheduleShow(0)
      },
      onBlur: () => scheduleHide(0),
      onKeyDown: tagSend(send, ['hide'], dismissOnEscape),
    },
    positioner: {
      'data-scope': 'tooltip',
      'data-part': 'positioner',
      style: 'position:absolute;top:0;left:0;pointer-events:none;',
    },
    content: {
      role: 'tooltip',
      id: contentId,
      'data-state': state.map((s) => (s.open ? 'open' : 'closed')),
      'data-scope': 'tooltip',
      'data-part': 'content',
      // Allow pointer to enter content without closing (for interactive tooltips):
      // entering the content cancels the close scheduled when the pointer left
      // the trigger, so trigger→content travel keeps the tooltip open (WCAG 1.4.13).
      onPointerEnter: () => cancelClose(),
      // Leaving the content schedules a close after the grace period, symmetric
      // with the trigger handlers.
      onPointerLeave: () => scheduleHide(delayClose),
      // Escape dismisses even when focus is inside the content.
      onKeyDown: tagSend(send, ['hide'], dismissOnEscape),
    },
    arrow: {
      'data-scope': 'tooltip',
      'data-part': 'arrow',
    },
  }
}

export interface OverlayOptions {
  state: Signal<TooltipState>
  send: Send<TooltipMsg>
  parts: TooltipParts
  content: () => Renderable
  placement?: Placement
  offset?: number
  flip?: boolean
  shift?: boolean
  transition?: TransitionOptions
  target?: string | HTMLElement
  arrowSelector?: string
  /** Dismiss on Escape regardless of where focus is (default: true). */
  closeOnEscape?: boolean
}

export function overlay(opts: OverlayOptions): Mountable {
  const rawTarget = opts.target ?? 'body'
  const placement = opts.placement ?? 'top'
  const offset = opts.offset ?? 6
  const flip = opts.flip !== false
  const shift = opts.shift !== false
  const parts = opts.parts
  const contentId = parts.content.id
  const triggerId = parts.trigger.id
  const closeOnEscape = opts.closeOnEscape !== false

  return show(
    opts.state.map((s) => s.open),
    () => {
      const targetEl =
        typeof rawTarget === 'string'
          ? (document.querySelector(rawTarget) ?? document.body)
          : rawTarget
      return [
        portal(() => {
          const dismissable = onMount(() => {
            const contentEl = document.getElementById(contentId)
            const triggerEl = document.getElementById(triggerId)
            if (!contentEl || !triggerEl) return

            const cleanups: Array<() => void> = []

            const positioner = contentEl.closest('[data-part="positioner"]') as HTMLElement | null
            const floatingEl = positioner ?? contentEl
            const arrow = opts.arrowSelector
              ? (contentEl.querySelector(opts.arrowSelector) as HTMLElement | null)
              : null
            cleanups.push(
              attachFloating({
                anchor: triggerEl,
                floating: floatingEl,
                placement,
                offset,
                flip,
                shift,
                arrow: arrow ?? undefined,
              }),
            )

            // Escape dismisses regardless of where focus sits (trigger, content,
            // or elsewhere). Outside-click is intentionally disabled — tooltips
            // dismiss on blur / pointer-leave, not on clicks elsewhere.
            if (closeOnEscape) {
              cleanups.push(
                pushDismissable({
                  element: contentEl,
                  ignore: () => [triggerEl],
                  disableOutside: true,
                  onDismiss: () => opts.send({ type: 'hide' }),
                }),
              )
            }

            return () => {
              for (let i = cleanups.length - 1; i >= 0; i--) cleanups[i]!()
            }
          })
          return [dismissable, div(parts.positioner, opts.content())]
        }, targetEl),
      ]
    },
  )
}

export const tooltip = { init, update, connect, overlay }
