import { onMount, tagSend, type Mountable } from '@llui/dom'
import type { Send, Signal } from '@llui/dom'
import { focusRovingItem } from '../utils/roving.js'
import { getElementByIdInScope } from '../utils/root-scope.js'
import {
  retainedExitGeneration,
  retainedExits,
  type RetainedExitGeneration,
} from '../internal/retained-exit.js'
import {
  createDisclosureExitCompletionMount,
  createDisclosureExitTracker,
  stampExitWatcherRetain,
  type DisclosureExitWatchEntry,
  type MotionEvent,
} from '../internal/disclosure-motion.js'

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

/**
 * Stamped by `connect()`'s trigger click/keydown handlers from the runtime
 * watcher registry (`isExitWatcherAttached(id)`) at dispatch time — DO NOT
 * SEND THIS MANUALLY. It is the ONE fact the reducer needs to decide
 * `closing` vs an instant close (`animated && retain === true`); anything
 * else about "is a watcher mounted" lives outside state entirely (#264
 * review-264j — see `disclosure-motion.ts`'s header). A raw
 * `send({ type: 'close', value })` from app/agent code with no `retain`
 * always closes INSTANTLY, even with `animated: true` and `exitCompletion`
 * placed — for an animated PROGRAMMATIC close, `parts.close(value)` is the
 * ONLY supported helper: it stamps `retain` from the same registry.
 */
type Retain = { retain?: boolean }

export type AccordionMsg =
  /** @intent("Toggle the named accordion item open/closed") */
  | ({ type: 'toggle'; value: string } & Retain)
  /** @intent("Open the named accordion item") */
  | ({ type: 'open'; value: string } & Retain)
  /** @intent("Close the named accordion item") */
  | ({ type: 'close'; value: string } & Retain)
  /** @intent("Replace the set of currently-open items with the provided values") */
  | ({ type: 'setValue'; value: string[] } & Retain)
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
  /** @humanOnly — sent by the retained content's own animation end/cancel event,
   * or by `exitCompletion`'s own cleanup settling every still-closing item once
   * the last watcher for this `id` detaches. */
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

/**
 * Pure — no `console.warn`, no other side effect, no read of anything outside
 * `state`/`msg` (#264 review-264j, FINAL: "is a watcher mounted" is a
 * RUNTIME/VIEW fact, never domain state — see `disclosure-motion.ts`'s
 * header comment on `createDisclosureExitCompletionMount` for the full
 * history of why. `retain` is the ONE bit the reducer needs, stamped onto
 * the message itself by `connect()`'s trigger handlers at DISPATCH time from
 * a runtime registry keyed by `opts.id` — never read here). This keeps
 * `update()` fully pure and `init()` fully deterministic, so `@llui/test`'s
 * `replayTrace`/`propertyTest` reproduce byte-identically regardless of
 * which mounts happen to be live during a replay (see
 * `test/components/disclosure-exit-replay.test.ts`).
 */
function withValue(
  state: AccordionState,
  value: string[],
  retain: boolean | undefined,
): AccordionState {
  const retained = retainedExits(
    state.value,
    value,
    state.closing,
    state.exitGenerations,
    state.exitSequence,
    state.animated && retain === true,
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
      return [withValue(state, toggleValue(state, msg.value), msg.retain), []]
    case 'open':
      if (state.value.includes(msg.value) && !state.closing.includes(msg.value)) return [state, []]
      return [
        withValue(state, state.multiple ? [...state.value, msg.value] : [msg.value], msg.retain),
        [],
      ]
    case 'close':
      if (!state.value.includes(msg.value)) return [state, []]
      if (!state.multiple && !state.collapsible) return [state, []]
      return [
        withValue(
          state,
          state.value.filter((v) => v !== msg.value),
          msg.retain,
        ),
        [],
      ]
    case 'setValue':
      return [withValue(state, msg.value, msg.retain), []]
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
    'data-value': string
    hidden: Signal<boolean>
    'aria-hidden': Signal<'true' | undefined>
    inert: Signal<boolean>
    onAnimationStart: (e: AnimationEvent) => void
    onAnimationEnd: (e: AnimationEvent) => void
    onAnimationCancel: (e: AnimationEvent) => void
    onTransitionStart: (e: TransitionEvent) => void
    onTransitionEnd: (e: TransitionEvent) => void
    onTransitionCancel: (e: TransitionEvent) => void
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
  /**
   * Settles a retained `closing` item once its content's own exit
   * animation/transition ends — or immediately, if the skin runs no exit
   * motion at all. This only ever has anything to settle for a
   * PROGRAMMATIC close/toggle/setValue when that message carried
   * `retain: true`, which `parts.close(value)` stamps for you; a raw
   * `send({ type: 'close', value })` with no `retain` closes instantly and
   * never enters `closing` at all, so there is nothing here to settle for
   * it. Its mount ALSO reports whether it is placed at all (#264 item F1):
   * `animated: true` only ever retains `closing` content while this is
   * mounted — forgetting to place it degrades gracefully to an instant
   * close (with a one-time dev warning) rather than hanging `closing` +
   * `inert` forever, so placing it is no longer required for SAFETY, only
   * for the requested exit animation to actually run on a retained close.
   * A click-driven close is still safety-netted synchronously inside the
   * trigger regardless of whether this is placed.
   */
  exitCompletion: Mountable
  /**
   * An animated-aware programmatic close (#264 review-264j): a raw
   * `send({ type: 'close', value })` from app/agent code carries no
   * `retain` and therefore closes INSTANTLY, even with `animated: true` and
   * `exitCompletion` placed — documented, fail-safe behavior, since a bare
   * message has no way to know whether a watcher happens to be mounted.
   * `parts.close(value)` is the correct way for a host to close an item
   * programmatically and still get the animated exit: it stamps `retain`
   * from the SAME runtime registry the trigger handlers read.
   */
  close: (value: string) => void
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
  // Namespaced by SCOPE, not just `id` (#264 review-264k): the runtime
  // watcher registry is a single module-wide `Map`, so an accordion and a
  // collapsible that happen to share the same caller-chosen `id` string
  // would otherwise collide in it — `opts.id` only has to be unique WITHIN
  // one component kind, matching the DOM id convention above.
  const registryId = `accordion:${base}`
  const exitTracker = createDisclosureExitTracker()
  const MISSING_WATCHER_MESSAGE =
    '[llui/components] Accordion was configured `animated: true` but `parts.exitCompletion` ' +
    'was never placed in the rendered view (or has not mounted yet), so a closing item cannot ' +
    'be retained for its exit animation and closes instantly instead. Place `parts.' +
    "exitCompletion` in the component's view, or pass `animated: false` if no exit motion is " +
    'intended.'
  // `animated` must be pre-peeked by the CALLER: peeking is unreachable in a
  // unit test that invokes the click/keydown handlers directly with no
  // `currentTarget` (`rootSignal()`-backed structural tests, which have no
  // live value to peek) — those call sites guard with the same `origin`
  // `completeIfUnanimatedAfterToggle` does, passing `false` when unsafe.
  // `close()` is a genuine programmatic API assumed to run against a real
  // live signal, exactly like `exitWatchEntries`/`armExit` elsewhere in this
  // file, so it peeks unconditionally.
  const stampRetain = (animated: boolean): boolean =>
    stampExitWatcherRetain(registryId, animated, MISSING_WATCHER_MESSAGE)
  const exitWatchEntries = (): readonly DisclosureExitWatchEntry[] =>
    state.peek().closing.map((value) => ({
      key: value,
      closing: true,
      generation: retainedExitGeneration(state.peek().exitGenerations, value) ?? 0,
      contentId: contentId(value),
    }))
  const armExit = (value: string, e: MotionEvent): void => {
    const current = state.peek()
    exitTracker.armExit(e, {
      closing: current.closing.includes(value),
      generation: retainedExitGeneration(current.exitGenerations, value) ?? 0,
    })
  }
  const completeExit = (value: string, e: MotionEvent): void => {
    const current = state.peek()
    const generation = retainedExitGeneration(current.exitGenerations, value) ?? 0
    if (exitTracker.completeExit(e, { closing: current.closing.includes(value), generation })) {
      send({ type: 'exitComplete', value, generation })
    }
  }
  // Safety net for the "opted into animated exit, but the skin runs no exit
  // animation at all" case — see collapsible.ts's identical comment. Checks
  // EVERY value the just-applied transition put into `closing`, not only the
  // clicked one: in SINGLE mode, opening item y while x was open closes x as
  // a side effect of the SAME `toggle` message, and a caller that only
  // safety-nets the clicked value (y) leaves x permanently stuck `closing` +
  // `inert` whenever the skin runs no exit animation at all (#264 review
  // item 4). `origin` is used only to resolve the enclosing DOM scope
  // (`getElementByIdInScope`, so a shadow-root-mounted instance's ids
  // resolve correctly rather than through the top-level `ownerDocument`,
  // which cannot see into a shadow tree) — it is not tied to any one value's
  // own element, so the same origin is reused for every closing value here.
  const completeIfUnanimatedAfterToggle = (origin: Element | null): void => {
    // Unreachable in a unit test that invokes the handler directly with no
    // currentTarget, and there is nothing to check without an element: avoid
    // peeking so `rootSignal()`-backed structural tests (which have no live
    // state to peek) keep working unchanged.
    if (origin === null) return
    const current = state.peek()
    for (const value of current.closing) {
      const content = getElementByIdInScope(origin, contentId(value))
      if (content === null) continue
      const generation = retainedExitGeneration(current.exitGenerations, value) ?? 0
      if (exitTracker.completeIfUnanimated(content, { closing: true, generation })) {
        send({ type: 'exitComplete', value, generation })
      }
    }
  }

  return {
    root: {
      'data-scope': 'accordion',
      'data-part': 'root',
      'data-orientation': 'vertical',
    },
    exitCompletion: onMount(
      createDisclosureExitCompletionMount(
        registryId,
        getElementByIdInScope,
        exitWatchEntries,
        (value, generation) => send({ type: 'exitComplete', value, generation }),
      ),
    ),
    close: (value: string): void => {
      // No DOM origin for a programmatic call, so the in-handler unanimated
      // safety net (`completeIfUnanimatedAfterToggle`, which needs a real
      // element to resolve the enclosing scope from) does not apply here —
      // `exitCompletion`'s own mounted `check()`/`MutationObserver` already
      // covers the unanimated-skin case for any placed watcher.
      send({ type: 'close', value, retain: stampRetain(state.peek().animated) })
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
          // Peeking is unreachable in a unit test that invokes the handler
          // directly with no `currentTarget` — see
          // `completeIfUnanimatedAfterToggle`'s identical note; guarding on
          // the same `origin` keeps `rootSignal()`-backed structural tests
          // (no live state to peek) working unchanged.
          const origin = e.currentTarget instanceof Element ? e.currentTarget : null
          const animated = origin === null ? false : state.peek().animated
          send({ type: 'toggle', value, retain: stampRetain(animated) })
          completeIfUnanimatedAfterToggle(origin)
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
              case 'Enter': {
                e.preventDefault()
                const animated = origin === null ? false : state.peek().animated
                send({ type: 'toggle', value, retain: stampRetain(animated) })
                completeIfUnanimatedAfterToggle(origin)
                return
              }
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
        'data-value': value,
        hidden: state.map((st) => !st.value.includes(value) && !st.closing.includes(value)),
        'aria-hidden': state.map((st) => (st.value.includes(value) ? undefined : 'true')),
        inert: state.map((st) => !st.value.includes(value)),
        onAnimationStart: (e) => armExit(value, e),
        onAnimationEnd: tagSend(send, ['exitComplete'], (e) => completeExit(value, e)),
        onAnimationCancel: tagSend(send, ['exitComplete'], (e) => completeExit(value, e)),
        onTransitionStart: (e) => armExit(value, e),
        onTransitionEnd: tagSend(send, ['exitComplete'], (e) => completeExit(value, e)),
        onTransitionCancel: tagSend(send, ['exitComplete'], (e) => completeExit(value, e)),
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
