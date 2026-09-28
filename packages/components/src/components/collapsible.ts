import { onMount, tagSend, type Mountable } from '@llui/dom'
import type { Send, ReadSignal } from '@llui/dom'
import { retainedExit } from '../internal/retained-exit.js'
import {
  createDisclosureExitCompletionMount,
  createDisclosureExitTracker,
  stampExitWatcherRetain,
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

/**
 * Stamped by `connect()`'s trigger click handler from the runtime watcher
 * registry (`isExitWatcherAttached(id)`) at dispatch time — DO NOT SEND
 * THIS MANUALLY. It is the ONE fact the reducer needs to decide `closing`
 * vs an instant close (`animated && retain === true`); anything else about
 * "is a watcher mounted" lives outside state entirely (#264 review-264j —
 * see `disclosure-motion.ts`'s header). A raw `send({ type: 'close' })`
 * from app/agent code with no `retain` always closes INSTANTLY, even with
 * `animated: true` and `exitCompletion` placed — for an animated
 * PROGRAMMATIC close, `parts.close()` is the ONLY supported helper: it
 * stamps `retain` from the same registry.
 */
type Retain = { retain?: boolean }

export type CollapsibleMsg =
  /** @intent("Toggle the collapsible panel open/closed") */
  | ({ type: 'toggle' } & Retain)
  /** @intent("Expand the collapsible panel") */
  | ({ type: 'open' } & Retain)
  /** @intent("Collapse the panel") */
  | ({ type: 'close' } & Retain)
  /** @intent("Set the panel's open state to a specific value") */
  | ({ type: 'setOpen'; open: boolean } & Retain)
  /** @humanOnly — sent by the retained content's own animation end/cancel event,
   * or by `exitCompletion`'s own cleanup settling a still-closing panel once
   * the last watcher for this `id` detaches. */
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

/**
 * Pure — no `console.warn`, no read of anything outside `state`/`msg` (#264
 * review-264j, FINAL). See `accordion.ts`'s identical note: `retain` is
 * stamped onto the message by `connect()`'s trigger handlers from a runtime
 * registry, never read here — "is a watcher mounted" is a view fact, not
 * domain state.
 */
function withOpen(
  state: CollapsibleState,
  open: boolean,
  retain: boolean | undefined,
): CollapsibleState {
  const retained = retainedExit(
    state.open,
    open,
    state.closing,
    state.exitGeneration,
    state.animated && retain === true,
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
      return [withOpen(state, !state.open, msg.retain), []]
    case 'open':
      return [withOpen(state, true, msg.retain), []]
    case 'close':
      return [withOpen(state, false, msg.retain), []]
    case 'setOpen':
      return [withOpen(state, msg.open, msg.retain), []]
  }
}

export interface CollapsibleParts {
  root: {
    'data-state': ReadSignal<'open' | 'closed'>
    'data-disabled': ReadSignal<'' | undefined>
    'data-scope': 'collapsible'
    'data-part': 'root'
  }
  trigger: {
    type: 'button'
    'aria-expanded': ReadSignal<boolean>
    'aria-controls': string
    id: string
    disabled: ReadSignal<boolean>
    'data-state': ReadSignal<'open' | 'closed'>
    'data-disabled': ReadSignal<'' | undefined>
    'data-scope': 'collapsible'
    'data-part': 'trigger'
    onClick: (e: MouseEvent) => void
  }
  content: {
    role: 'region'
    id: string
    'aria-labelledby': string
    hidden: ReadSignal<boolean>
    'data-state': ReadSignal<'open' | 'closing' | 'closed'>
    'data-scope': 'collapsible'
    'data-part': 'content'
    'aria-hidden': ReadSignal<'true' | undefined>
    inert: ReadSignal<boolean>
    onAnimationStart: (e: AnimationEvent) => void
    onAnimationEnd: (e: AnimationEvent) => void
    onAnimationCancel: (e: AnimationEvent) => void
    onTransitionStart: (e: TransitionEvent) => void
    onTransitionEnd: (e: TransitionEvent) => void
    onTransitionCancel: (e: TransitionEvent) => void
  }
  /**
   * Settles a retained `closing` panel once the content's own exit
   * animation/transition ends — or immediately, if the skin runs no exit
   * motion at all. This only ever has anything to settle for a
   * PROGRAMMATIC close/toggle/setOpen when that message carried
   * `retain: true`, which `parts.close()` stamps for you; a raw
   * `send({ type: 'close' })` with no `retain` closes instantly and never
   * enters `closing` at all. Its mount ALSO reports whether it is placed at
   * all: `animated: true` only ever retains `closing` while this is mounted
   * (#264 item F1) — forgetting to place it degrades gracefully to an
   * instant close (with a one-time dev warning) rather than hanging
   * `closing` + `inert` forever, so placing it is no longer required for
   * SAFETY, only for the requested exit animation to actually run on a
   * retained close. A click-driven close is still safety-netted
   * synchronously inside the trigger regardless of whether this is placed.
   */
  exitCompletion: Mountable
  /**
   * An animated-aware programmatic close (#264 review-264j) — see
   * `accordion.ts`'s identical part for the full rationale. A raw
   * `send({ type: 'close' })` carries no `retain` and closes INSTANTLY;
   * `parts.close()` stamps `retain` from the runtime registry.
   */
  close: () => void
}

export interface ConnectOptions {
  id: string
}

export function connect(
  state: ReadSignal<CollapsibleState>,
  send: Send<CollapsibleMsg>,
  opts: ConnectOptions,
): CollapsibleParts {
  const id = opts.id
  const triggerId = `${id}:trigger`
  const contentId = `${id}:content`
  // Namespaced by SCOPE, not just `id` (#264 review-264k) — see
  // accordion.ts's identical note: the runtime watcher registry is a single
  // module-wide `Map`, so an accordion and a collapsible sharing a caller-
  // chosen `id` would otherwise collide in it.
  const registryId = `collapsible:${id}`
  const exitTracker = createDisclosureExitTracker()
  const MISSING_WATCHER_MESSAGE =
    '[llui/components] Collapsible was configured `animated: true` but `parts.exitCompletion` ' +
    'was never placed in the rendered view (or has not mounted yet), so a closing panel cannot ' +
    'be retained for its exit animation and closes instantly instead. Place `parts.' +
    "exitCompletion` in the component's view, or pass `animated: false` if no exit motion is " +
    'intended.'
  const stampRetain = (animated: boolean): boolean =>
    stampExitWatcherRetain(registryId, animated, MISSING_WATCHER_MESSAGE)
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
        // Peeking is unreachable in a unit test with no `currentTarget` —
        // see `completeIfUnanimatedAfterToggle`'s identical note.
        const animated = e.currentTarget instanceof Element ? state.peek().animated : false
        send({ type: 'toggle', retain: stampRetain(animated) })
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
        registryId,
        getElementByIdInScope,
        exitWatchEntries,
        (_key, generation) => send({ type: 'exitComplete', generation }),
      ),
    ),
    close: (): void => {
      send({ type: 'close', retain: stampRetain(state.peek().animated) })
    },
  }
}

export const collapsible = { init, update, connect }
