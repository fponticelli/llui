import type { Send, Signal, TransitionOptions, Renderable } from '@llui/dom'
import { show, portal, onMount, div, useContext, tagSend } from '@llui/dom'
import { LocaleContext } from '../locale.js'
import { pushDismissable } from '../utils/dismissable.js'
import { pushFocusTrap } from '../utils/focus-trap.js'
import { attachFloating, type Placement } from '../utils/floating.js'
import type { PresenceStatus } from './presence.js'

/**
 * Popover — click-triggered, non-modal floating overlay anchored to its
 * trigger. Use for menus, date pickers, color pickers, filters, etc.
 *
 * Like dialog, has a pure state machine + a view helper (`overlay()`) that
 * wires floating-ui positioning, dismissable, and optional focus trapping.
 */

export interface PopoverState {
  open: boolean
  /** Presence lifecycle — drives data-state and keeps the node mounted through exit animations. */
  status: PresenceStatus
  /** When true, close transitions go straight to 'closed' (no exit-animation wait). */
  skipAnimations: boolean
}

export type PopoverMsg =
  /** @intent("Open the popover") */
  | { type: 'open' }
  /** @intent("Close the popover") */
  | { type: 'close' }
  /** @intent("Toggle the popover open/closed") */
  | { type: 'toggle' }
  /** @intent("Set the popover's open state to a specific value") */
  | { type: 'setOpen'; open: boolean }
  /** @humanOnly */
  | { type: 'animationEnd' }
  /** @humanOnly */
  | { type: 'transitionEnd' }

export interface PopoverInit {
  open?: boolean
  /** Skip enter/exit animations — close unmounts synchronously (default: true). */
  skipAnimations?: boolean
}

export function init(opts: PopoverInit = {}): PopoverState {
  const open = opts.open ?? false
  return {
    open,
    status: open ? 'open' : 'closed',
    skipAnimations: opts.skipAnimations ?? true,
  }
}

function openTo(state: PopoverState): PopoverState {
  if (state.open && (state.status === 'open' || state.status === 'opening')) return state
  return { ...state, open: true, status: state.skipAnimations ? 'open' : 'opening' }
}

function closeTo(state: PopoverState): PopoverState {
  if (!state.open && (state.status === 'closed' || state.status === 'closing')) return state
  return { ...state, open: false, status: state.skipAnimations ? 'closed' : 'closing' }
}

export function update(state: PopoverState, msg: PopoverMsg): [PopoverState, never[]] {
  switch (msg.type) {
    case 'open':
      return [openTo(state), []]
    case 'close':
      return [closeTo(state), []]
    case 'toggle':
      return [state.open ? closeTo(state) : openTo(state), []]
    case 'setOpen':
      return [msg.open ? openTo(state) : closeTo(state), []]
    case 'animationEnd':
    case 'transitionEnd':
      if (state.status === 'opening') return [{ ...state, status: 'open' }, []]
      if (state.status === 'closing') return [{ ...state, status: 'closed' }, []]
      return [state, []]
  }
}

/** Whether the popover node should be in the DOM — true through the exit animation. */
export function isMounted(state: PopoverState): boolean {
  return state.status !== 'closed'
}

/** Alias of {@link isMounted} — whether the popover is currently present in the DOM. */
export function isPresent(state: PopoverState): boolean {
  return isMounted(state)
}

export interface PopoverParts {
  trigger: {
    type: 'button'
    'aria-haspopup': 'dialog'
    'aria-expanded': Signal<boolean>
    'aria-controls': string
    id: string
    'data-state': Signal<'open' | 'closed'>
    'data-scope': 'popover'
    'data-part': 'trigger'
    onClick: (e: MouseEvent) => void
  }
  positioner: {
    'data-scope': 'popover'
    'data-part': 'positioner'
    style: string
  }
  content: {
    role: 'dialog'
    id: string
    'aria-labelledby': string
    tabindex: -1
    'data-state': Signal<PresenceStatus>
    'data-scope': 'popover'
    'data-part': 'content'
    onAnimationEnd: (e: AnimationEvent) => void
    onTransitionEnd: (e: TransitionEvent) => void
  }
  title: {
    id: string
    'data-scope': 'popover'
    'data-part': 'title'
  }
  description: {
    id: string
    'data-scope': 'popover'
    'data-part': 'description'
  }
  arrow: {
    'data-scope': 'popover'
    'data-part': 'arrow'
  }
  closeTrigger: {
    type: 'button'
    'aria-label': string
    'data-scope': 'popover'
    'data-part': 'close-trigger'
    onClick: (e: MouseEvent) => void
  }
}

export interface ConnectOptions {
  id: string
  closeLabel?: string
}

export function connect(
  state: Signal<PopoverState>,
  send: Send<PopoverMsg>,
  opts: ConnectOptions,
): PopoverParts {
  const locale = useContext(LocaleContext)
  const base = opts.id
  const triggerId = `${base}:trigger`
  const contentId = `${base}:content`
  const titleId = `${base}:title`
  const descId = `${base}:description`
  const closeLabel = opts.closeLabel ?? locale.popover.close

  return {
    trigger: {
      type: 'button',
      'aria-haspopup': 'dialog',
      'aria-expanded': state.map((st) => st.open),
      'aria-controls': contentId,
      id: triggerId,
      'data-state': state.map((st) => (st.open ? 'open' : 'closed')),
      'data-scope': 'popover',
      'data-part': 'trigger',
      onClick: tagSend(send, ['toggle'], () => send({ type: 'toggle' })),
    },
    positioner: {
      'data-scope': 'popover',
      'data-part': 'positioner',
      style: 'position:absolute;top:0;left:0;',
    },
    content: {
      role: 'dialog',
      id: contentId,
      'aria-labelledby': titleId,
      tabindex: -1,
      'data-state': state.map((st) => st.status),
      'data-scope': 'popover',
      'data-part': 'content',
      onAnimationEnd: () => send({ type: 'animationEnd' }),
      onTransitionEnd: () => send({ type: 'transitionEnd' }),
    },
    title: {
      id: titleId,
      'data-scope': 'popover',
      'data-part': 'title',
    },
    description: {
      id: descId,
      'data-scope': 'popover',
      'data-part': 'description',
    },
    arrow: {
      'data-scope': 'popover',
      'data-part': 'arrow',
    },
    closeTrigger: {
      type: 'button',
      'aria-label': closeLabel,
      'data-scope': 'popover',
      'data-part': 'close-trigger',
      onClick: tagSend(send, ['close'], () => send({ type: 'close' })),
    },
  }
}

export interface OverlayOptions {
  state: Signal<PopoverState>
  send: Send<PopoverMsg>
  parts: PopoverParts
  content: () => Renderable
  /** Placement preference — bottom | top | right | left with -start/-end variants. */
  placement?: Placement
  /** Offset between trigger and content, px (default: 8). */
  offset?: number
  /** Auto-flip to opposite side (default: true). */
  flip?: boolean
  /** Shift to keep in viewport (default: true). */
  shift?: boolean
  /** Optional transition. */
  transition?: TransitionOptions
  /** Close on Escape (default: true). */
  closeOnEscape?: boolean
  /** Close on outside click (default: true). */
  closeOnOutsideClick?: boolean
  /** Trap focus inside popover while open (default: false — non-modal). */
  trapFocus?: boolean
  /** Restore focus to trigger on close (default: true). */
  restoreFocus?: boolean
  /** Portal target (default: 'body'). */
  target?: string | HTMLElement
  /** Arrow element selector within content (optional). */
  arrowSelector?: string
}

export function overlay(opts: OverlayOptions): Renderable {
  const rawTarget = opts.target ?? 'body'
  const placement = opts.placement ?? 'bottom'
  const offset = opts.offset ?? 8
  const flip = opts.flip !== false
  const shift = opts.shift !== false
  const closeOnEscape = opts.closeOnEscape !== false
  const closeOnOutsideClick = opts.closeOnOutsideClick !== false
  const trapFocus = opts.trapFocus === true
  const restoreFocus = opts.restoreFocus !== false
  const parts = opts.parts
  const contentId = parts.content.id
  const triggerId = parts.trigger.id

  // Outer block stays mounted through the exit animation (status !== 'closed');
  // inner block tracks visibility (open) so interaction wiring tears down at the
  // close REQUEST while the node lingers for the exit transition.
  return [
    show(
      opts.state.map((st) => isMounted(st)),
      () => {
        const targetEl =
          typeof rawTarget === 'string'
            ? (document.querySelector(rawTarget) ?? document.body)
            : rawTarget
        return [
          portal(() => {
            // Floating positioning lives with the mounted node so the content
            // stays anchored while the exit animation plays.
            const floating = onMount(() => {
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
            // Dismissable + focus-trap are interaction concerns: they unwind at
            // the close REQUEST (visibility false), not at DOM removal.
            const interaction = show(
              opts.state.map((st) => st.open),
              () => [
                onMount(() => {
                  const contentEl = document.getElementById(contentId)
                  const triggerEl = document.getElementById(triggerId)
                  if (!contentEl || !triggerEl) return

                  const cleanups: Array<() => void> = []

                  if (trapFocus) {
                    cleanups.push(
                      pushFocusTrap({
                        container: contentEl,
                        restoreFocus,
                      }),
                    )
                  }

                  if (closeOnEscape || closeOnOutsideClick) {
                    cleanups.push(
                      pushDismissable({
                        element: contentEl,
                        ignore: () => [triggerEl],
                        disableEscape: !closeOnEscape,
                        disableOutside: !closeOnOutsideClick,
                        onDismiss: () => {
                          opts.send({ type: 'close' })
                          if (restoreFocus) triggerEl.focus()
                        },
                      }),
                    )
                  }

                  return () => {
                    for (let i = cleanups.length - 1; i >= 0; i--) cleanups[i]!()
                  }
                }),
              ],
            )
            return [floating, interaction, div(parts.positioner, opts.content())]
          }, targetEl),
        ]
      },
    ),
  ]
}

export const popover = { init, update, connect, overlay, isMounted, isPresent }
