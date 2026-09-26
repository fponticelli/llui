import { onMount, tagSend, type Mountable } from '@llui/dom'
import type { Send, Signal } from '@llui/dom'
import { retainedExit } from '../internal/retained-exit.js'
import {
  createDisclosureExitCompletionMount,
  createDisclosureExitTracker,
  type DisclosureExitWatchEntry,
  type MotionEvent,
} from '../internal/disclosure-motion.js'
import { getElementByIdInScope } from '../utils/root-scope.js'

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
    onTransitionStart: (e: TransitionEvent) => void
    onTransitionEnd: (e: TransitionEvent) => void
    onTransitionCancel: (e: TransitionEvent) => void
  }
  /**
   * Settles a PROGRAMMATIC `close`/`toggle`/`setOpen` (sent directly by the
   * host app, bypassing the trigger's click handler) once the content's own
   * exit animation/transition ends — or immediately, if the skin runs no
   * exit motion at all. MUST be placed in the rendered view (`#264` review
   * item 1); a click-driven close is still safety-netted synchronously
   * inside the trigger regardless of whether this is placed, but nothing
   * else settles a programmatic close on a no-motion skin, which otherwise
   * hangs `closing` + `inert` forever.
   */
  exitCompletion: Mountable
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
  const exitTracker = createDisclosureExitTracker()
  const exitWatchEntries = (): readonly DisclosureExitWatchEntry[] => {
    const current = state.peek()
    return current.closing
      ? [{ key: 'root', closing: true, generation: current.exitGeneration, contentId }]
      : []
  }
  const armExit = (e: MotionEvent): void => {
    const current = state.peek()
    exitTracker.armExit(e, { closing: current.closing, generation: current.exitGeneration })
  }
  const completeExit = (e: MotionEvent): void => {
    const current = state.peek()
    if (
      exitTracker.completeExit(e, { closing: current.closing, generation: current.exitGeneration })
    ) {
      send({ type: 'exitComplete', generation: current.exitGeneration })
    }
  }
  // Safety net for the "opted into animated exit, but the skin runs no exit
  // animation at all" case (a dropped rule, a media query that doesn't
  // match, `animation: none`): no animationstart/animationend event would
  // ever fire, so the event-driven path above never completes it. Checked
  // synchronously right after a user-initiated close via the trigger, which
  // is the only place `content`'s own element is reachable without a new
  // Mountable placement — see the README for what this covers (and does not).
  const completeIfUnanimatedAfterToggle = (e: { currentTarget: EventTarget | null }): void => {
    const trigger = e.currentTarget instanceof Element ? e.currentTarget : null
    // `getElementByIdInScope`, not `ownerDocument.getElementById` (#264
    // review item 4): a shadow-root-mounted instance's `contentId` lives in
    // the shadow root's OWN id scope, which `ownerDocument` cannot see —
    // silently missing `content` and leaving it stuck `closing` forever.
    const content = trigger === null ? null : getElementByIdInScope(trigger, contentId)
    // Unreachable in a unit test that dispatches a bare event with no
    // currentTarget, and there is nothing to check without an element:
    // avoid peeking so `rootSignal()`-backed structural tests (which have no
    // live state to peek) keep working unchanged.
    if (content === null) return
    const current = state.peek()
    if (
      exitTracker.completeIfUnanimated(content, {
        closing: current.closing,
        generation: current.exitGeneration,
      })
    ) {
      send({ type: 'exitComplete', generation: current.exitGeneration })
    }
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
      onClick: tagSend(send, ['toggle'], (e: MouseEvent) => {
        send({ type: 'toggle' })
        completeIfUnanimatedAfterToggle(e)
      }),
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
      onTransitionStart: armExit,
      onTransitionEnd: tagSend(send, ['exitComplete'], completeExit),
      onTransitionCancel: tagSend(send, ['exitComplete'], completeExit),
    },
    exitCompletion: onMount(
      createDisclosureExitCompletionMount(
        getElementByIdInScope,
        exitWatchEntries,
        (_key, generation) => send({ type: 'exitComplete', generation }),
        { describe: () => 'Collapsible' },
      ),
    ),
  }
}

export const collapsible = { init, update, connect }
