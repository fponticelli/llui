import type { Send, TransitionOptions } from '@llui/dom'
import { show, portal, onMount, div, useContext } from '@llui/dom'
import { LocaleContext } from '../locale'
import type { Locale } from '../locale'
import { pushDismissable } from '../utils/dismissable'
import { pushFocusTrap } from '../utils/focus-trap'
import { setAriaHiddenOutside } from '../utils/aria-hidden'
import { lockBodyScroll } from '../utils/remove-scroll'

/**
 * Drawer — a panel that slides in from a screen edge. Structurally
 * identical to dialog (portal + focus trap + dismissable + aria-hidden +
 * scroll lock), but adds a `side` so styling can animate from that edge.
 */

export type DrawerSide = 'left' | 'right' | 'top' | 'bottom'

export interface DrawerState {
  open: boolean
}

export type DrawerMsg =
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'toggle' }
  | { type: 'setOpen'; open: boolean }

export interface DrawerInit {
  open?: boolean
}

export function init(opts: DrawerInit = {}): DrawerState {
  return { open: opts.open ?? false }
}

export function update(state: DrawerState, msg: DrawerMsg): [DrawerState, never[]] {
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

export interface DrawerParts<S> {
  trigger: {
    type: 'button'
    'aria-haspopup': 'dialog'
    'aria-expanded': (s: S) => boolean
    'aria-controls': string
    id: string
    'data-state': (s: S) => 'open' | 'closed'
    'data-scope': 'drawer'
    'data-part': 'trigger'
    onClick: (e: MouseEvent) => void
  }
  backdrop: {
    'data-state': (s: S) => 'open' | 'closed'
    'data-scope': 'drawer'
    'data-part': 'backdrop'
    'aria-hidden': 'true'
  }
  positioner: {
    'data-scope': 'drawer'
    'data-part': 'positioner'
    'data-side': DrawerSide
  }
  content: {
    role: 'dialog'
    id: string
    'aria-modal': 'true'
    'aria-labelledby': string
    tabIndex: -1
    'data-state': (s: S) => 'open' | 'closed'
    'data-scope': 'drawer'
    'data-part': 'content'
    'data-side': DrawerSide
  }
  title: {
    id: string
    'data-scope': 'drawer'
    'data-part': 'title'
  }
  description: {
    id: string
    'data-scope': 'drawer'
    'data-part': 'description'
  }
  closeTrigger: {
    type: 'button'
    'aria-label': string | ((s: S) => string)
    'data-scope': 'drawer'
    'data-part': 'close-trigger'
    onClick: (e: MouseEvent) => void
  }
}

export interface ConnectOptions {
  id: string
  side?: DrawerSide
  closeLabel?: string
}

export function connect<S>(
  get: (s: S) => DrawerState,
  send: Send<DrawerMsg>,
  opts: ConnectOptions,
): DrawerParts<S> {
  const locale = useContext<S, Locale>(LocaleContext)
  const side = opts.side ?? 'right'
  const base = opts.id
  const contentId = `${base}:content`
  const titleId = `${base}:title`
  const descId = `${base}:description`
  const triggerId = `${base}:trigger`
  const closeLabel: string | ((s: S) => string) =
    opts.closeLabel ?? ((s: S) => locale(s).drawer.close)

  return {
    trigger: {
      type: 'button',
      'aria-haspopup': 'dialog',
      'aria-expanded': (s) => get(s).open,
      'aria-controls': contentId,
      id: triggerId,
      'data-state': (s) => (get(s).open ? 'open' : 'closed'),
      'data-scope': 'drawer',
      'data-part': 'trigger',
      onClick: () => send({ type: 'open' }),
    },
    backdrop: {
      'data-state': (s) => (get(s).open ? 'open' : 'closed'),
      'data-scope': 'drawer',
      'data-part': 'backdrop',
      'aria-hidden': 'true',
    },
    positioner: {
      'data-scope': 'drawer',
      'data-part': 'positioner',
      'data-side': side,
    },
    content: {
      role: 'dialog',
      id: contentId,
      'aria-modal': 'true',
      'aria-labelledby': titleId,
      tabIndex: -1,
      'data-state': (s) => (get(s).open ? 'open' : 'closed'),
      'data-scope': 'drawer',
      'data-part': 'content',
      'data-side': side,
    },
    title: {
      id: titleId,
      'data-scope': 'drawer',
      'data-part': 'title',
    },
    description: {
      id: descId,
      'data-scope': 'drawer',
      'data-part': 'description',
    },
    closeTrigger: {
      type: 'button',
      'aria-label': closeLabel,
      'data-scope': 'drawer',
      'data-part': 'close-trigger',
      onClick: () => send({ type: 'close' }),
    },
  }
}

export interface OverlayOptions<S> {
  get: (s: S) => DrawerState
  send: Send<DrawerMsg>
  parts: DrawerParts<S>
  content: () => Node[]
  transition?: TransitionOptions
  closeOnEscape?: boolean
  closeOnOutsideClick?: boolean
  trapFocus?: boolean
  lockScroll?: boolean
  hideSiblings?: boolean
  target?: string | HTMLElement
  initialFocus?: Element | (() => Element | null)
  restoreFocus?: boolean
}

export function overlay<S>(opts: OverlayOptions<S>): Node[] {
  const target = opts.target ?? 'body'
  const closeOnEscape = opts.closeOnEscape !== false
  const closeOnOutsideClick = opts.closeOnOutsideClick !== false
  const trapFocus = opts.trapFocus !== false
  const lockScroll = opts.lockScroll !== false
  const hideSiblings = opts.hideSiblings !== false
  const restoreFocus = opts.restoreFocus !== false
  const parts = opts.parts
  const contentId = parts.content.id
  const triggerId = parts.trigger.id

  return show<S, DrawerMsg>({
    when: (s) => opts.get(s).open,
    render: () =>
      portal({
        target,
        render: () => {
          onMount(() => {
            const contentEl = document.getElementById(contentId)
            if (!contentEl) return
            const triggerEl = document.getElementById(triggerId)

            const cleanups: Array<() => void> = []
            if (lockScroll) cleanups.push(lockBodyScroll())
            if (hideSiblings) cleanups.push(setAriaHiddenOutside(contentEl))
            if (trapFocus) {
              cleanups.push(
                pushFocusTrap({
                  container: contentEl,
                  initialFocus: opts.initialFocus,
                  restoreFocus,
                }),
              )
            }
            if (closeOnEscape || closeOnOutsideClick) {
              cleanups.push(
                pushDismissable({
                  element: contentEl,
                  ignore: () => (triggerEl ? [triggerEl] : []),
                  disableEscape: !closeOnEscape,
                  disableOutside: !closeOnOutsideClick,
                  onDismiss: () => opts.send({ type: 'close' }),
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

export const drawer = { init, update, connect, overlay }
