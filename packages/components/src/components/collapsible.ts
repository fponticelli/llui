import { tagSend } from '@llui/dom'
import type { Send, Signal } from '@llui/dom'
import { retainedExit } from '../internal/retained-exit.js'
import {
  armDisclosureExit,
  matchesArmedDisclosureExit,
  measureDisclosureBlockSize,
  type ArmedDisclosureExit,
} from '../internal/disclosure-motion.js'

/**
 * Collapsible — a single expandable/collapsible section. Simpler than
 * accordion (no grouping, no keyboard navigation between siblings).
 */

export interface CollapsibleState {
  open: boolean
  disabled: boolean
  /** Presentation-only retention while an opted-in exit animation runs. */
  closing: boolean
  /** Monotonic generation used to reject stale animation completion events. */
  exitGeneration: number
  /** Whether close waits for the content's own animation end/cancel event. */
  animated: boolean
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
  /** @humanOnly */
  | { type: 'exitComplete'; generation: number }

export interface CollapsibleInit {
  open?: boolean
  disabled?: boolean
  /** Opt into retained exit motion. Defaults off to guarantee no event/no hang. */
  animated?: boolean
}

export function init(opts: CollapsibleInit = {}): CollapsibleState {
  return {
    open: opts.open ?? false,
    disabled: opts.disabled ?? false,
    closing: false,
    exitGeneration: 0,
    animated: opts.animated ?? false,
  }
}

function withOpen(state: CollapsibleState, open: boolean): CollapsibleState {
  const retained = retainedExit(
    state.open,
    open,
    state.closing,
    state.exitGeneration,
    state.animated,
  )
  return {
    ...state,
    open,
    closing: retained.exiting,
    exitGeneration: retained.generation,
  }
}

export function update(state: CollapsibleState, msg: CollapsibleMsg): [CollapsibleState, never[]] {
  if (msg.type === 'exitComplete') {
    return state.closing && state.exitGeneration === msg.generation
      ? [{ ...state, closing: false }, []]
      : [state, []]
  }
  if (state.disabled) return [state, []]
  switch (msg.type) {
    case 'toggle':
      return [withOpen(state, !state.open), []]
    case 'open':
      return [withOpen(state, true), []]
    case 'close':
      return [withOpen(state, false), []]
    case 'setOpen':
      return [withOpen(state, msg.open), []]
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
    'data-state': Signal<'open' | 'closing' | 'closed'>
    'data-scope': 'collapsible'
    'data-part': 'content'
    'aria-hidden': Signal<'true' | undefined>
    inert: Signal<boolean>
    onAnimationStart: (e: AnimationEvent) => void
    onAnimationEnd: (e: AnimationEvent) => void
    onAnimationCancel: (e: AnimationEvent) => void
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
  const armedExits = new WeakMap<EventTarget, ArmedDisclosureExit>()
  const armExit = (e: AnimationEvent): void => {
    const target = e.currentTarget
    if (target === null || target !== e.target) return
    const current = state.peek()
    if (current.closing) {
      const armed = armDisclosureExit(e, current.exitGeneration)
      if (armed !== undefined) armedExits.set(target, armed)
    } else {
      measureDisclosureBlockSize(e)
      armedExits.delete(target)
    }
  }
  const completeExit = (e: AnimationEvent): void => {
    const target = e.currentTarget
    if (target === null) return
    const current = state.peek()
    if (
      !current.closing ||
      !matchesArmedDisclosureExit(e, current.exitGeneration, armedExits.get(target))
    )
      return
    armedExits.delete(target)
    send({ type: 'exitComplete', generation: current.exitGeneration })
  }

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
      hidden: state.map((s) => !s.open && !s.closing),
      'data-state': state.map((s) => (s.open ? 'open' : s.closing ? 'closing' : 'closed')),
      'data-scope': 'collapsible',
      'data-part': 'content',
      'aria-hidden': state.map((s) => (s.open ? undefined : 'true')),
      inert: state.map((s) => !s.open),
      onAnimationStart: armExit,
      onAnimationEnd: tagSend(send, ['exitComplete'], completeExit),
      onAnimationCancel: tagSend(send, ['exitComplete'], completeExit),
    },
  }
}

export const collapsible = { init, update, connect }
