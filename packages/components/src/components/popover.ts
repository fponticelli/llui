import type { Send, TransitionOptions } from '@llui/dom'
import { show, portal, onMount, div, useContext } from '@llui/dom'
import { LocaleContext } from '../locale.js'
import type { Locale } from '../locale.js'
import { pushDismissable } from '../utils/dismissable.js'
import { pushFocusTrap } from '../utils/focus-trap.js'
import { attachFloating, type Placement } from '../utils/floating.js'

/**
 * Popover — click-triggered, non-modal floating overlay anchored to its
 * trigger. Use for menus, date pickers, color pickers, filters, etc.
 *
 * Like dialog, has a pure state machine + a view helper (`overlay()`) that
 * wires floating-ui positioning, dismissable, and optional focus trapping.
 */

export interface PopoverState {
  open: boolean
}

export type PopoverMsg =
  /** @intent("Open") */
  | { type: 'open' }
  /** @intent("Close") */
  | { type: 'close' }
  /** @intent("Toggle") */
  | { type: 'toggle' }
  /** @intent("Set Open") */
  | { type: 'setOpen'; open: boolean }

export interface PopoverInit {
  open?: boolean
}

export function init(opts: PopoverInit = {}): PopoverState {
  return { open: opts.open ?? false }
}

export function update(state: PopoverState, msg: PopoverMsg): [PopoverState, never[]] {
  switch (msg.type) {
    case 'open':
      return [{ ...state, open: true }, []]
    case 'close':
      return [{ ...state, open: false }, []]
    case 'toggle':
      return [{ ...state, open: !state.open }, []]
    case 'setOpen':
      return [{ ...state, open: msg.open }, []]
  }
}

export interface PopoverParts<S> {
  trigger: {
    type: 'button'
    'aria-haspopup': 'dialog'
    'aria-expanded': (s: S) => boolean
    'aria-controls': string
    id: string
    'data-state': (s: S) => 'open' | 'closed'
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
    tabIndex: -1
    'data-state': (s: S) => 'open' | 'closed'
    'data-scope': 'popover'
    'data-part': 'content'
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
    'aria-label': string | ((s: S) => string)
    'data-scope': 'popover'
    'data-part': 'close-trigger'
    onClick: (e: MouseEvent) => void
  }
}

export interface ConnectOptions {
  id: string
  closeLabel?: string
}

export function connect<S>(
  get: (s: S) => PopoverState,
  send: Send<PopoverMsg>,
  opts: ConnectOptions,
): PopoverParts<S> {
  const locale = useContext<S, Locale>(LocaleContext)
  const base = opts.id
  const triggerId = `${base}:trigger`
  const contentId = `${base}:content`
  const titleId = `${base}:title`
  const descId = `${base}:description`
  const closeLabel: string | ((s: S) => string) =
    opts.closeLabel ?? ((s: S) => locale(s).popover.close)

  return {
    trigger: {
      type: 'button',
      'aria-haspopup': 'dialog',
      'aria-expanded': (s) => get(s).open,
      'aria-controls': contentId,
      id: triggerId,
      'data-state': (s) => (get(s).open ? 'open' : 'closed'),
      'data-scope': 'popover',
      'data-part': 'trigger',
      onClick: () => send({ type: 'toggle' }),
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
      tabIndex: -1,
      'data-state': (s) => (get(s).open ? 'open' : 'closed'),
      'data-scope': 'popover',
      'data-part': 'content',
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
      onClick: () => send({ type: 'close' }),
    },
  }
}

export interface OverlayOptions<S> {
  get: (s: S) => PopoverState
  send: Send<PopoverMsg>
  parts: PopoverParts<S>
  content: () => Node[]
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

export function overlay<S>(opts: OverlayOptions<S>): Node[] {
  const target = opts.target ?? 'body'
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

  return show<S, PopoverMsg>({
    when: (s) => opts.get(s).open,
    render: () =>
      portal({
        target,
        render: () => {
          onMount(() => {
            const contentEl = document.getElementById(contentId)
            const triggerEl = document.getElementById(triggerId)
            if (!contentEl || !triggerEl) return

            const cleanups: Array<() => void> = []

            // Position content relative to trigger
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
          })
          return [div(parts.positioner, opts.content())]
        },
      }),
    enter: opts.transition?.enter,
    leave: opts.transition?.leave,
  })
}

export const popover = { init, update, connect, overlay }
