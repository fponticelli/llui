import type { Send, Signal, TransitionOptions, Mountable, Renderable } from '@llui/dom'
import { show, portal, onMount, div, useContext, tagSend } from '@llui/dom'
import { LocaleContext } from '../locale.js'
import { pushDismissable } from '../utils/dismissable.js'
import { resolvePortalTarget } from '../utils/portal-target.js'
import { pushFocusTrap } from '../utils/focus-trap.js'
import { setAriaHiddenOutside } from '../utils/aria-hidden.js'
import { lockBodyScroll } from '../utils/remove-scroll.js'

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
  /** @intent("Open the drawer") */
  | { type: 'open' }
  /** @intent("Close the drawer") */
  | { type: 'close' }
  /** @intent("Toggle the drawer open/closed") */
  | { type: 'toggle' }
  /** @intent("Set the drawer's open state to a specific value") */
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

export interface DrawerParts {
  trigger: {
    type: 'button'
    'aria-haspopup': 'dialog'
    'aria-expanded': Signal<boolean>
    'aria-controls': string
    id: string
    'data-state': Signal<'open' | 'closed'>
    'data-scope': 'drawer'
    'data-part': 'trigger'
    onClick: (e: MouseEvent) => void
  }
  backdrop: {
    'data-state': Signal<'open' | 'closed'>
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
    'data-state': Signal<'open' | 'closed'>
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
    'aria-label': string
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

export function connect(
  state: Signal<DrawerState>,
  send: Send<DrawerMsg>,
  opts: ConnectOptions,
): DrawerParts {
  const locale = useContext(LocaleContext)
  const side = opts.side ?? 'right'
  const base = opts.id
  const contentId = `${base}:content`
  const titleId = `${base}:title`
  const descId = `${base}:description`
  const triggerId = `${base}:trigger`
  const closeLabel = opts.closeLabel ?? locale.drawer.close

  return {
    trigger: {
      type: 'button',
      'aria-haspopup': 'dialog',
      'aria-expanded': state.map((s) => s.open),
      'aria-controls': contentId,
      id: triggerId,
      'data-state': state.map((s) => (s.open ? 'open' : 'closed')),
      'data-scope': 'drawer',
      'data-part': 'trigger',
      onClick: tagSend(send, ['open'], () => send({ type: 'open' })),
    },
    backdrop: {
      'data-state': state.map((s) => (s.open ? 'open' : 'closed')),
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
      'data-state': state.map((s) => (s.open ? 'open' : 'closed')),
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
      onClick: tagSend(send, ['close'], () => send({ type: 'close' })),
    },
  }
}

export interface OverlayOptions {
  state: Signal<DrawerState>
  send: Send<DrawerMsg>
  parts: DrawerParts
  content: () => Renderable
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

export function overlay(opts: OverlayOptions): Mountable {
  const targetOpt = opts.target ?? 'body'
  const closeOnEscape = opts.closeOnEscape !== false
  const closeOnOutsideClick = opts.closeOnOutsideClick !== false
  const trapFocus = opts.trapFocus !== false
  const lockScroll = opts.lockScroll !== false
  const hideSiblings = opts.hideSiblings !== false
  const restoreFocus = opts.restoreFocus !== false
  const parts = opts.parts
  const contentId = parts.content.id
  const triggerId = parts.trigger.id
  const host = resolvePortalTarget(targetOpt)

  return show(
    opts.state.map((s) => s.open),
    () => [
      portal(() => {
        const dismissable = onMount(() => {
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
        return [dismissable, div(parts.positioner, opts.content())]
      }, host),
    ],
  )
}

export const drawer = { init, update, connect, overlay }
