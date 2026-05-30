import type { Send, Signal, TransitionOptions } from '@llui/dom'
import { show, portal, onMount, div } from '@llui/dom'
import { attachFloating, type Placement } from '../utils/floating.js'

/**
 * Hover card — richer tooltip-like popup triggered by hover or focus.
 * Unlike tooltip, it uses `role="dialog"` (not `role="tooltip"`) and
 * allows interactive content. Content can be hovered without closing.
 */

export interface HoverCardState {
  open: boolean
}

export type HoverCardMsg = { type: 'show' } | { type: 'hide' } | { type: 'setOpen'; open: boolean }

export interface HoverCardInit {
  open?: boolean
}

export function init(opts: HoverCardInit = {}): HoverCardState {
  return { open: opts.open ?? false }
}

export function update(state: HoverCardState, msg: HoverCardMsg): [HoverCardState, never[]] {
  switch (msg.type) {
    case 'show':
      return [{ ...state, open: true }, []]
    case 'hide':
      return [{ ...state, open: false }, []]
    case 'setOpen':
      return [{ ...state, open: msg.open }, []]
  }
}

export interface HoverCardParts {
  trigger: {
    id: string
    'aria-haspopup': 'dialog'
    'aria-controls': string
    'data-state': Signal<'open' | 'closed'>
    'data-scope': 'hover-card'
    'data-part': 'trigger'
    onPointerEnter: (e: PointerEvent) => void
    onPointerLeave: (e: PointerEvent) => void
    onFocus: (e: FocusEvent) => void
    onBlur: (e: FocusEvent) => void
  }
  positioner: {
    'data-scope': 'hover-card'
    'data-part': 'positioner'
    style: string
  }
  content: {
    role: 'dialog'
    id: string
    'data-state': Signal<'open' | 'closed'>
    'data-scope': 'hover-card'
    'data-part': 'content'
    onPointerEnter: (e: PointerEvent) => void
    onPointerLeave: (e: PointerEvent) => void
  }
  arrow: {
    'data-scope': 'hover-card'
    'data-part': 'arrow'
  }
}

export interface ConnectOptions {
  id: string
  /** ms before showing on hover (default: 700). */
  openDelay?: number
  /** ms before hiding after pointer leaves (default: 300). */
  closeDelay?: number
}

export function connect(
  state: Signal<HoverCardState>,
  send: Send<HoverCardMsg>,
  opts: ConnectOptions,
): HoverCardParts {
  const base = opts.id
  const triggerId = `${base}:trigger`
  const contentId = `${base}:content`
  const openDelay = opts.openDelay ?? 700
  const closeDelay = opts.closeDelay ?? 300

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

  const scheduleOpen = (): void => {
    clearTimers()
    openTimer = setTimeout(() => {
      openTimer = null
      send({ type: 'show' })
    }, openDelay)
  }

  const scheduleClose = (): void => {
    clearTimers()
    closeTimer = setTimeout(() => {
      closeTimer = null
      send({ type: 'hide' })
    }, closeDelay)
  }

  return {
    trigger: {
      id: triggerId,
      'aria-haspopup': 'dialog',
      'aria-controls': contentId,
      'data-state': state.map((s) => (s.open ? 'open' : 'closed')),
      'data-scope': 'hover-card',
      'data-part': 'trigger',
      onPointerEnter: scheduleOpen,
      onPointerLeave: scheduleClose,
      onFocus: scheduleOpen,
      onBlur: scheduleClose,
    },
    positioner: {
      'data-scope': 'hover-card',
      'data-part': 'positioner',
      style: 'position:absolute;top:0;left:0;',
    },
    content: {
      role: 'dialog',
      id: contentId,
      'data-state': state.map((s) => (s.open ? 'open' : 'closed')),
      'data-scope': 'hover-card',
      'data-part': 'content',
      onPointerEnter: () => {
        if (closeTimer) {
          clearTimeout(closeTimer)
          closeTimer = null
        }
      },
      onPointerLeave: scheduleClose,
    },
    arrow: {
      'data-scope': 'hover-card',
      'data-part': 'arrow',
    },
  }
}

export interface OverlayOptions {
  state: Signal<HoverCardState>
  send: Send<HoverCardMsg>
  parts: HoverCardParts
  content: () => Node[]
  placement?: Placement
  offset?: number
  flip?: boolean
  shift?: boolean
  transition?: TransitionOptions
  target?: string | HTMLElement
  arrowSelector?: string
}

export function overlay(opts: OverlayOptions): Node {
  const rawTarget = opts.target ?? 'body'
  const placement = opts.placement ?? 'bottom'
  const offset = opts.offset ?? 8
  const flip = opts.flip !== false
  const shift = opts.shift !== false
  const parts = opts.parts
  const contentId = parts.content.id
  const triggerId = parts.trigger.id

  return show(
    opts.state.map((s) => s.open),
    () => {
      const targetEl =
        typeof rawTarget === 'string'
          ? (document.querySelector(rawTarget) ?? document.body)
          : rawTarget
      return [
        portal(() => {
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
        }, targetEl),
      ]
    },
  )
}

export const hoverCard = { init, update, connect, overlay }
