import { tagSend } from '@llui/dom'
import type { Send, Signal } from '@llui/dom'

/**
 * Collapsible — a single expandable/collapsible section. Simpler than
 * accordion (no grouping, no keyboard navigation between siblings).
 */

export interface CollapsibleState {
  open: boolean
  disabled: boolean
}

export type CollapsibleMsg =
  /** @intent("Toggle the collapsible panel open/closed") */
  | { type: 'toggle' }
  /** @intent("Expand the collapsible panel") */
  | { type: 'open' }
  /** @intent("Collapse the panel") */
  | { type: 'close' }
  /** @intent("Set the panel's open state to a specific value") */
  | { type: 'setOpen'; open: boolean }

export interface CollapsibleInit {
  open?: boolean
  disabled?: boolean
}

export function init(opts: CollapsibleInit = {}): CollapsibleState {
  return { open: opts.open ?? false, disabled: opts.disabled ?? false }
}

export function update(state: CollapsibleState, msg: CollapsibleMsg): [CollapsibleState, never[]] {
  if (state.disabled) return [state, []]
  switch (msg.type) {
    case 'toggle':
      return [{ ...state, open: !state.open }, []]
    case 'open':
      return [{ ...state, open: true }, []]
    case 'close':
      return [{ ...state, open: false }, []]
    case 'setOpen':
      return [{ ...state, open: msg.open }, []]
  }
}

export interface CollapsibleParts {
  root: {
    'data-state': Signal<'open' | 'closed'>
    'data-disabled': Signal<'' | undefined>
    'data-scope': 'collapsible'
    'data-part': 'root'
  }
  trigger: {
    type: 'button'
    'aria-expanded': Signal<boolean>
    'aria-controls': string
    id: string
    disabled: Signal<boolean>
    'data-state': Signal<'open' | 'closed'>
    'data-disabled': Signal<'' | undefined>
    'data-scope': 'collapsible'
    'data-part': 'trigger'
    onClick: (e: MouseEvent) => void
  }
  content: {
    role: 'region'
    id: string
    'aria-labelledby': string
    hidden: Signal<boolean>
    'data-state': Signal<'open' | 'closed'>
    'data-scope': 'collapsible'
    'data-part': 'content'
  }
}

export interface ConnectOptions {
  id: string
}

export function connect(
  state: Signal<CollapsibleState>,
  send: Send<CollapsibleMsg>,
  opts: ConnectOptions,
): CollapsibleParts {
  const triggerId = `${opts.id}:trigger`
  const contentId = `${opts.id}:content`

  return {
    root: {
      'data-state': state.map((s) => (s.open ? 'open' : 'closed')),
      'data-disabled': state.map((s) => (s.disabled ? '' : undefined)),
      'data-scope': 'collapsible',
      'data-part': 'root',
    },
    trigger: {
      type: 'button',
      'aria-expanded': state.map((s) => s.open),
      'aria-controls': contentId,
      id: triggerId,
      disabled: state.map((s) => s.disabled),
      'data-state': state.map((s) => (s.open ? 'open' : 'closed')),
      'data-disabled': state.map((s) => (s.disabled ? '' : undefined)),
      'data-scope': 'collapsible',
      'data-part': 'trigger',
      onClick: tagSend(send, ['toggle'], () => send({ type: 'toggle' })),
    },
    content: {
      role: 'region',
      id: contentId,
      'aria-labelledby': triggerId,
      hidden: state.map((s) => !s.open),
      'data-state': state.map((s) => (s.open ? 'open' : 'closed')),
      'data-scope': 'collapsible',
      'data-part': 'content',
    },
  }
}

export const collapsible = { init, update, connect }
