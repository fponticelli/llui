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
  /**
   * Whether `parts.exitCompletion` is CURRENTLY placed/mounted (#264 item
   * F1). `closing` retention only ever engages when `animated && exitWatcher`
   * both hold — never `animated` alone — so a forgotten `exitCompletion`
   * placement closes instantly instead of hanging `closing` + `inert`
   * forever. Flipped by the `exitWatcherAttach`/`exitWatcherDetach` messages
   * that mount sends on mount/cleanup; never a caller-facing init option.
   */
  exitWatcher: boolean
  /**
   * Set once a close was reduced with `animated: true` but `exitWatcher:
   * false` — throttles the dev-mode "you forgot to place exitCompletion"
   * warning to fire at most once per instance. Never reset back to `false`.
   */
  exitWarned: boolean
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
  /** @humanOnly — sent by `parts.exitCompletion`'s own mount, once placed. */
  | { type: 'exitWatcherAttach' }
  /** @humanOnly — sent by `parts.exitCompletion`'s own cleanup, on unmount. */
  | { type: 'exitWatcherDetach' }

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
    exitWatcher: false,
    exitWarned: false,
  }
}

/**
 * Dev-mode message for a close reduced with `animated: true` but no
 * `exitCompletion` mount attached (#264 item F1) — see the identical helper
 * on `accordion.ts` for why it lives in the reducer rather than a mount/timer.
 */
function warnMissingExitWatcher(): void {
  if (import.meta.env?.DEV !== true) return
  console.warn(
    '[llui/components] Collapsible was configured `animated: true` but `parts.exitCompletion` ' +
      'was never placed in the rendered view (or has not mounted yet), so a closing panel cannot ' +
      'be retained for its exit animation and closes instantly instead. Place `parts.' +
      "exitCompletion` in the component's view, or pass `animated: false` if no exit motion is " +
      'intended.',
  )
}

function withOpen(state: CollapsibleState, open: boolean): CollapsibleState {
  const closingNow = state.open && !open
  const watcherMissing = state.animated && closingNow && !state.exitWatcher
  if (watcherMissing && !state.exitWarned) warnMissingExitWatcher()
  const retained = retainedExit(
    state.open,
    open,
    state.closing,
    state.exitGeneration,
    state.animated && state.exitWatcher,
  )
  return {
    ...state,
    open,
    closing: retained.exiting,
    exitGeneration: retained.generation,
    exitWarned: state.exitWarned || watcherMissing,
  }
}

export function update(state: CollapsibleState, msg: CollapsibleMsg): [CollapsibleState, never[]] {
  if (msg.type === 'exitWatcherAttach') {
    return state.exitWatcher ? [state, []] : [{ ...state, exitWatcher: true }, []]
  }
  if (msg.type === 'exitWatcherDetach') {
    // Settle a currently-retained exit immediately: with the watcher gone,
    // nothing will ever send the `exitComplete` that would otherwise clear
    // it (#264 item F1 — "detach mid-closing settles").
    if (!state.exitWatcher && !state.closing) return [state, []]
    return [{ ...state, exitWatcher: false, closing: false }, []]
  }
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
   * exit motion at all. Its mount ALSO reports whether it is placed at all:
   * `animated: true` only ever retains `closing` while this is mounted
   * (#264 item F1) — forgetting to place it degrades gracefully to an
   * instant close (with a one-time dev warning) rather than hanging
   * `closing` + `inert` forever, so placing it is no longer required for
   * SAFETY, only for the requested exit animation to actually run on a
   * programmatic close. A click-driven close is still safety-netted
   * synchronously inside the trigger regardless of whether this is placed.
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
    exitCompletion: onMount((container: Element) => {
      send({ type: 'exitWatcherAttach' })
      const dispose = createDisclosureExitCompletionMount(
        getElementByIdInScope,
        exitWatchEntries,
        (_key, generation) => send({ type: 'exitComplete', generation }),
      )(container)
      return () => {
        dispose?.()
        send({ type: 'exitWatcherDetach' })
      }
    }),
  }
}

export const collapsible = { init, update, connect }
