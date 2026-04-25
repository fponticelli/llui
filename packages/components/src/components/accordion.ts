import type { Send } from '@llui/dom'

/**
 * Accordion — a stack of expandable panels. Items are identified by a string
 * value. Either a single item is expandable at a time (default) or many
 * (`multiple: true`). `collapsible: false` prevents closing the only open
 * item in single mode.
 *
 * Items themselves are provided by the user's view (accordion is agnostic to
 * item data). The `connect()` API returns a `root` prop set and an `item(value)`
 * factory that produces `trigger` and `content` prop sets scoped to that item.
 */

export interface AccordionState {
  /** Values of currently-expanded items. */
  value: string[]
  multiple: boolean
  collapsible: boolean
  disabled: boolean
  /** Ordered list of item values (for keyboard navigation). */
  items: string[]
}

export type AccordionMsg =
  /** @intent("Toggle the named accordion item open/closed") */
  | { type: 'toggle'; value: string }
  /** @intent("Open the named accordion item") */
  | { type: 'open'; value: string }
  /** @intent("Close the named accordion item") */
  | { type: 'close'; value: string }
  /** @intent("Replace the set of currently-open items with the provided values") */
  | { type: 'setValue'; value: string[] }
  /** @humanOnly */
  | { type: 'setItems'; items: string[] }
  /** @humanOnly */
  | { type: 'focusNext'; value: string }
  /** @humanOnly */
  | { type: 'focusPrev'; value: string }
  /** @humanOnly */
  | { type: 'focusFirst' }
  /** @humanOnly */
  | { type: 'focusLast' }

export interface AccordionInit {
  value?: string[]
  multiple?: boolean
  collapsible?: boolean
  disabled?: boolean
  items?: string[]
}

export function init(opts: AccordionInit = {}): AccordionState {
  return {
    value: opts.value ?? [],
    multiple: opts.multiple ?? false,
    collapsible: opts.collapsible ?? true,
    disabled: opts.disabled ?? false,
    items: opts.items ?? [],
  }
}

function toggleValue(state: AccordionState, value: string): string[] {
  const isOpen = state.value.includes(value)
  if (state.multiple) {
    return isOpen ? state.value.filter((v) => v !== value) : [...state.value, value]
  }
  // single mode
  if (isOpen) {
    return state.collapsible ? [] : state.value
  }
  return [value]
}

export function update(state: AccordionState, msg: AccordionMsg): [AccordionState, never[]] {
  if (state.disabled) return [state, []]
  switch (msg.type) {
    case 'toggle':
      return [{ ...state, value: toggleValue(state, msg.value) }, []]
    case 'open':
      if (state.value.includes(msg.value)) return [state, []]
      return [{ ...state, value: state.multiple ? [...state.value, msg.value] : [msg.value] }, []]
    case 'close':
      if (!state.value.includes(msg.value)) return [state, []]
      if (!state.multiple && !state.collapsible) return [state, []]
      return [{ ...state, value: state.value.filter((v) => v !== msg.value) }, []]
    case 'setValue':
      return [{ ...state, value: msg.value }, []]
    case 'setItems':
      return [{ ...state, items: msg.items }, []]
    // Focus messages don't mutate state but are emitted so user handlers can respond.
    case 'focusNext':
    case 'focusPrev':
    case 'focusFirst':
    case 'focusLast':
      return [state, []]
  }
}

export interface AccordionItemParts<S> {
  trigger: {
    type: 'button'
    'aria-expanded': (s: S) => boolean
    'aria-controls': string
    id: string
    'data-state': (s: S) => 'open' | 'closed'
    'data-disabled': (s: S) => '' | undefined
    disabled: (s: S) => boolean
    'data-scope': 'accordion'
    'data-part': 'trigger'
    'data-value': string
    onClick: (e: MouseEvent) => void
    onKeyDown: (e: KeyboardEvent) => void
  }
  content: {
    role: 'region'
    id: string
    'aria-labelledby': string
    'data-state': (s: S) => 'open' | 'closed'
    'data-scope': 'accordion'
    'data-part': 'content'
    hidden: (s: S) => boolean
  }
  item: {
    'data-state': (s: S) => 'open' | 'closed'
    'data-disabled': (s: S) => '' | undefined
    'data-scope': 'accordion'
    'data-part': 'item'
    'data-value': string
  }
}

export interface AccordionParts<S> {
  root: {
    role: 'region'
    'data-scope': 'accordion'
    'data-part': 'root'
    'data-orientation': 'vertical'
  }
  item: (value: string) => AccordionItemParts<S>
}

export interface ConnectOptions {
  /** Namespace prefix for part ids (for ARIA wiring). Should be unique per instance. */
  id: string
}

export function connect<S>(
  get: (s: S) => AccordionState,
  send: Send<AccordionMsg>,
  opts: ConnectOptions,
): AccordionParts<S> {
  const base = opts.id
  const triggerId = (v: string): string => `${base}:trigger:${v}`
  const contentId = (v: string): string => `${base}:content:${v}`

  return {
    root: {
      role: 'region',
      'data-scope': 'accordion',
      'data-part': 'root',
      'data-orientation': 'vertical',
    },
    item: (value: string): AccordionItemParts<S> => ({
      trigger: {
        type: 'button',
        'aria-expanded': (s) => get(s).value.includes(value),
        'aria-controls': contentId(value),
        id: triggerId(value),
        'data-state': (s) => (get(s).value.includes(value) ? 'open' : 'closed'),
        'data-disabled': (s) => (get(s).disabled ? '' : undefined),
        disabled: (s) => get(s).disabled,
        'data-scope': 'accordion',
        'data-part': 'trigger',
        'data-value': value,
        onClick: () => send({ type: 'toggle', value }),
        onKeyDown: (e: KeyboardEvent) => {
          switch (e.key) {
            case 'ArrowDown':
              e.preventDefault()
              send({ type: 'focusNext', value })
              return
            case 'ArrowUp':
              e.preventDefault()
              send({ type: 'focusPrev', value })
              return
            case 'Home':
              e.preventDefault()
              send({ type: 'focusFirst' })
              return
            case 'End':
              e.preventDefault()
              send({ type: 'focusLast' })
              return
            case ' ':
            case 'Enter':
              e.preventDefault()
              send({ type: 'toggle', value })
              return
          }
        },
      },
      content: {
        role: 'region',
        id: contentId(value),
        'aria-labelledby': triggerId(value),
        'data-state': (s) => (get(s).value.includes(value) ? 'open' : 'closed'),
        'data-scope': 'accordion',
        'data-part': 'content',
        hidden: (s) => !get(s).value.includes(value),
      },
      item: {
        'data-state': (s) => (get(s).value.includes(value) ? 'open' : 'closed'),
        'data-disabled': (s) => (get(s).disabled ? '' : undefined),
        'data-scope': 'accordion',
        'data-part': 'item',
        'data-value': value,
      },
    }),
  }
}

/**
 * Helper: compute the next/prev item value given a focus message + current state.
 * Users' view/onMount can use this to move DOM focus to the correct trigger.
 */
export function focusTarget(
  state: AccordionState,
  msg: Extract<AccordionMsg, { type: `focus${string}` }>,
): string | null {
  const items = state.items
  if (items.length === 0) return null
  if (msg.type === 'focusFirst') return items[0]!
  if (msg.type === 'focusLast') return items[items.length - 1]!
  const idx = items.indexOf(msg.value)
  if (idx === -1) return null
  if (msg.type === 'focusNext') return items[(idx + 1) % items.length]!
  // focusPrev
  return items[(idx - 1 + items.length) % items.length]!
}

export const accordion = { init, update, connect, focusTarget }
