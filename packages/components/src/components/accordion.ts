import { tagSend } from '@llui/dom'
import type { Send, Signal } from '@llui/dom'
import { focusRovingItem } from '../utils/roving.js'
import {
  retainedExitGeneration,
  retainedExits,
  type RetainedExitGeneration,
} from '../internal/retained-exit.js'
import { createDisclosureExitTracker } from '../internal/disclosure-motion.js'

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
  /** Presentation-only items retained while their opted-in exit animation runs. */
  closing: string[]
  /** Monotonic exit generation per item, used to reject stale end events. */
  exitGenerations: RetainedExitGeneration<string>[]
  /** Monotonic source for collision-free exit generations; never grows by id. */
  exitSequence: number
  /** Whether closed content is retained until its own animation end/cancel event. */
  animated: boolean
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
  /** @humanOnly — sent by the retained content's own animation end/cancel event. */
  | { type: 'exitComplete'; value: string; generation: number }

export interface AccordionInit {
  value?: string[]
  multiple?: boolean
  collapsible?: boolean
  disabled?: boolean
  items?: string[]
  /**
   * Retain closing content for an exit animation. Off by default so a missing
   * stylesheet/event cannot leave hidden semantic content mounted forever.
   */
  animated?: boolean
}

export function init(opts: AccordionInit = {}): AccordionState {
  return {
    value: opts.value ?? [],
    multiple: opts.multiple ?? false,
    collapsible: opts.collapsible ?? true,
    disabled: opts.disabled ?? false,
    items: opts.items ?? [],
    closing: [],
    exitGenerations: [],
    exitSequence: 0,
    animated: opts.animated ?? false,
  }
}

function withValue(state: AccordionState, value: string[]): AccordionState {
  const retained = retainedExits(
    state.value,
    value,
    state.closing,
    state.exitGenerations,
    state.exitSequence,
    state.animated,
  )
  return {
    ...state,
    value,
    closing: retained.exiting,
    exitGenerations: retained.generations,
    exitSequence: retained.sequence,
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
  if (msg.type === 'exitComplete') {
    if (
      !state.closing.includes(msg.value) ||
      retainedExitGeneration(state.exitGenerations, msg.value) !== msg.generation
    )
      return [state, []]
    return [
      {
        ...state,
        closing: state.closing.filter((value) => value !== msg.value),
        exitGenerations: state.exitGenerations.filter((entry) => entry.value !== msg.value),
      },
      [],
    ]
  }
  if (state.disabled) return [state, []]
  switch (msg.type) {
    case 'toggle':
      return [withValue(state, toggleValue(state, msg.value)), []]
    case 'open':
      if (state.value.includes(msg.value) && !state.closing.includes(msg.value)) return [state, []]
      return [withValue(state, state.multiple ? [...state.value, msg.value] : [msg.value]), []]
    case 'close':
      if (!state.value.includes(msg.value)) return [state, []]
      if (!state.multiple && !state.collapsible) return [state, []]
      return [
        withValue(
          state,
          state.value.filter((v) => v !== msg.value),
        ),
        [],
      ]
    case 'setValue':
      return [withValue(state, msg.value), []]
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

export interface AccordionItemParts {
  trigger: {
    type: 'button'
    'aria-expanded': Signal<boolean>
    'aria-controls': string
    id: string
    'data-state': Signal<'open' | 'closed'>
    'data-disabled': Signal<'' | undefined>
    disabled: Signal<boolean>
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
    'data-state': Signal<'open' | 'closing' | 'closed'>
    'data-scope': 'accordion'
    'data-part': 'content'
    hidden: Signal<boolean>
    'aria-hidden': Signal<'true' | undefined>
    inert: Signal<boolean>
    onAnimationStart: (e: AnimationEvent) => void
    onAnimationEnd: (e: AnimationEvent) => void
    onAnimationCancel: (e: AnimationEvent) => void
  }
  item: {
    'data-state': Signal<'open' | 'closed'>
    'data-disabled': Signal<'' | undefined>
    'data-scope': 'accordion'
    'data-part': 'item'
    'data-value': string
  }
}

export interface AccordionParts {
  root: {
    // No role on the root: an accordion is a set of disclosure buttons, and
    // labelling the whole container `region` (without an accessible name) just
    // adds an unlabeled landmark. The meaningful regions are the per-item
    // panels, each a `role="region"` with `aria-labelledby` its trigger.
    'data-scope': 'accordion'
    'data-part': 'root'
    'data-orientation': 'vertical'
  }
  item: (value: string) => AccordionItemParts
}

export interface ConnectOptions {
  /** Namespace prefix for part ids (for ARIA wiring). Should be unique per instance. */
  id: string
}

export function connect(
  state: Signal<AccordionState>,
  send: Send<AccordionMsg>,
  opts: ConnectOptions,
): AccordionParts {
  const base = opts.id
  const triggerId = (v: string): string => `${base}:trigger:${v}`
  const contentId = (v: string): string => `${base}:content:${v}`
  const exitTracker = createDisclosureExitTracker()
  const armExit = (value: string, e: AnimationEvent): void => {
    const current = state.peek()
    exitTracker.armExit(e, {
      closing: current.closing.includes(value),
      generation: retainedExitGeneration(current.exitGenerations, value) ?? 0,
    })
  }
  const completeExit = (value: string, e: AnimationEvent): void => {
    const current = state.peek()
    const generation = retainedExitGeneration(current.exitGenerations, value) ?? 0
    if (exitTracker.completeExit(e, { closing: current.closing.includes(value), generation })) {
      send({ type: 'exitComplete', value, generation })
    }
  }
  // Safety net for the "opted into animated exit, but the skin runs no exit
  // animation at all" case — see collapsible.ts's identical comment and the
  // README for what this covers (a user-initiated close via the trigger) and
  // does not (a programmatic `close`/`setValue` message).
  const completeIfUnanimatedAfterToggle = (value: string, origin: Element | null): void => {
    const content = origin?.ownerDocument.getElementById(contentId(value)) ?? null
    // Unreachable in a unit test that invokes the handler directly with no
    // currentTarget, and there is nothing to check without an element: avoid
    // peeking so `rootSignal()`-backed structural tests (which have no live
    // state to peek) keep working unchanged.
    if (content === null) return
    const current = state.peek()
    const generation = retainedExitGeneration(current.exitGenerations, value) ?? 0
    if (
      exitTracker.completeIfUnanimated(content, {
        closing: current.closing.includes(value),
        generation,
      })
    ) {
      send({ type: 'exitComplete', value, generation })
    }
  }

  return {
    root: {
      'data-scope': 'accordion',
      'data-part': 'root',
      'data-orientation': 'vertical',
    },
    item: (value: string): AccordionItemParts => ({
      trigger: {
        type: 'button',
        'aria-expanded': state.map((st) => st.value.includes(value)),
        'aria-controls': contentId(value),
        id: triggerId(value),
        'data-state': state.map((st) => (st.value.includes(value) ? 'open' : 'closed')),
        'data-disabled': state.map((st) => (st.disabled ? '' : undefined)),
        disabled: state.map((st) => st.disabled),
        'data-scope': 'accordion',
        'data-part': 'trigger',
        'data-value': value,
        onClick: tagSend(send, ['toggle'], (e: MouseEvent) => {
          send({ type: 'toggle', value })
          completeIfUnanimatedAfterToggle(
            value,
            e.currentTarget instanceof Element ? e.currentTarget : null,
          )
        }),
        onKeyDown: tagSend(
          send,
          ['focusNext', 'focusPrev', 'focusFirst', 'focusLast', 'toggle'],
          (e: KeyboardEvent) => {
            const origin = e.currentTarget as Element | null
            // Focus messages don't mutate state; the target trigger is derived
            // from the current items. Move real DOM focus there so arrow keys
            // work for assistive tech (roving via tabindex is not enough).
            const moveFocus = (msg: Extract<AccordionMsg, { type: `focus${string}` }>): void => {
              const s = state.peek()
              if (s == null) return
              const target = focusTarget(s, msg)
              if (target !== null)
                focusRovingItem(origin, 'accordion', target, { itemPart: 'trigger' })
            }
            switch (e.key) {
              case 'ArrowDown':
                e.preventDefault()
                send({ type: 'focusNext', value })
                moveFocus({ type: 'focusNext', value })
                return
              case 'ArrowUp':
                e.preventDefault()
                send({ type: 'focusPrev', value })
                moveFocus({ type: 'focusPrev', value })
                return
              case 'Home':
                e.preventDefault()
                send({ type: 'focusFirst' })
                moveFocus({ type: 'focusFirst' })
                return
              case 'End':
                e.preventDefault()
                send({ type: 'focusLast' })
                moveFocus({ type: 'focusLast' })
                return
              case ' ':
              case 'Enter':
                e.preventDefault()
                send({ type: 'toggle', value })
                completeIfUnanimatedAfterToggle(value, origin)
                return
            }
          },
        ),
      },
      content: {
        role: 'region',
        id: contentId(value),
        'aria-labelledby': triggerId(value),
        'data-state': state.map((st) =>
          st.value.includes(value) ? 'open' : st.closing.includes(value) ? 'closing' : 'closed',
        ),
        'data-scope': 'accordion',
        'data-part': 'content',
        hidden: state.map((st) => !st.value.includes(value) && !st.closing.includes(value)),
        'aria-hidden': state.map((st) => (st.value.includes(value) ? undefined : 'true')),
        inert: state.map((st) => !st.value.includes(value)),
        onAnimationStart: (e) => armExit(value, e),
        onAnimationEnd: tagSend(send, ['exitComplete'], (e) => completeExit(value, e)),
        onAnimationCancel: tagSend(send, ['exitComplete'], (e) => completeExit(value, e)),
      },
      item: {
        'data-state': state.map((st) => (st.value.includes(value) ? 'open' : 'closed')),
        'data-disabled': state.map((st) => (st.disabled ? '' : undefined)),
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
