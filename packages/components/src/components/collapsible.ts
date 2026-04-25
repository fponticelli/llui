import type { Send } from '@llui/dom'

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

export interface CollapsibleParts<S> {
  root: {
    'data-state': (s: S) => 'open' | 'closed'
    'data-disabled': (s: S) => '' | undefined
    'data-scope': 'collapsible'
    'data-part': 'root'
  }
  trigger: {
    type: 'button'
    'aria-expanded': (s: S) => boolean
    'aria-controls': string
    id: string
    disabled: (s: S) => boolean
    'data-state': (s: S) => 'open' | 'closed'
    'data-disabled': (s: S) => '' | undefined
    'data-scope': 'collapsible'
    'data-part': 'trigger'
    onClick: (e: MouseEvent) => void
  }
  content: {
    role: 'region'
    id: string
    'aria-labelledby': string
    hidden: (s: S) => boolean
    'data-state': (s: S) => 'open' | 'closed'
    'data-scope': 'collapsible'
    'data-part': 'content'
  }
}

export interface ConnectOptions {
  id: string
}

export function connect<S>(
  get: (s: S) => CollapsibleState,
  send: Send<CollapsibleMsg>,
  opts: ConnectOptions,
): CollapsibleParts<S> {
  const triggerId = `${opts.id}:trigger`
  const contentId = `${opts.id}:content`

  return {
    root: {
      'data-state': (s) => (get(s).open ? 'open' : 'closed'),
      'data-disabled': (s) => (get(s).disabled ? '' : undefined),
      'data-scope': 'collapsible',
      'data-part': 'root',
    },
    trigger: {
      type: 'button',
      'aria-expanded': (s) => get(s).open,
      'aria-controls': contentId,
      id: triggerId,
      disabled: (s) => get(s).disabled,
      'data-state': (s) => (get(s).open ? 'open' : 'closed'),
      'data-disabled': (s) => (get(s).disabled ? '' : undefined),
      'data-scope': 'collapsible',
      'data-part': 'trigger',
      onClick: () => send({ type: 'toggle' }),
    },
    content: {
      role: 'region',
      id: contentId,
      'aria-labelledby': triggerId,
      hidden: (s) => !get(s).open,
      'data-state': (s) => (get(s).open ? 'open' : 'closed'),
      'data-scope': 'collapsible',
      'data-part': 'content',
    },
  }
}

export const collapsible = { init, update, connect }
