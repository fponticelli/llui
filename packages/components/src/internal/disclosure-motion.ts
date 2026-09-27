/**
 * A disclosure exit can be driven by a CSS `@keyframes` animation OR a plain
 * CSS transition — a skin author reasonably reaches for either, and nothing
 * here should care which. `AnimationEvent` and `TransitionEvent` carry the
 * motion's name under different fields (`animationName` vs `propertyName`),
 * and the running effect objects `Element.getAnimations()` returns are
 * `CSSAnimation`/`CSSTransition` respectively, which likewise expose the name
 * under different properties. Every function below is written once against
 * this shared vocabulary instead of twice against each concrete type — a
 * transition-only skin used to leave the exit tracker permanently stuck
 * `closing` + `inert` because only `onAnimationStart`/`onAnimationEnd`/
 * `onAnimationCancel` were ever wired, so `getAnimations()` saw the running
 * CSSTransition (declining the "nothing is running" safety net, correctly)
 * while no event the component listened for ever told it the transition had
 * ENDED (#264 review item 4a).
 */
export type MotionEvent = AnimationEvent | TransitionEvent

function isAnimationEvent(event: MotionEvent): event is AnimationEvent {
  return 'animationName' in event
}

/** The motion's name, whichever concrete event kind fired. */
function motionName(event: MotionEvent): string {
  return isAnimationEvent(event) ? event.animationName : event.propertyName
}

interface NamedEffect extends Animation {
  readonly animationName?: string
  readonly transitionProperty?: string
}

/** The name a running effect object (`CSSAnimation`/`CSSTransition`) carries,
 * matching whichever field `motionName` would read off the corresponding
 * event. A plain Web Animations `Animation` (neither) has no name and never
 * matches. */
function effectName(effect: NamedEffect): string | undefined {
  return effect.animationName ?? effect.transitionProperty
}

/**
 * Measure the content's natural logical block size at the animation boundary.
 *
 * CSS cannot interpolate from `0` to `auto`. Both supported skins instead
 * animate to this pixel custom property, which is refreshed for every enter
 * and exit so dynamic content never reuses a stale endpoint.
 */
export function measureDisclosureBlockSize(event: MotionEvent): void {
  if (event.currentTarget !== event.target || !(event.currentTarget instanceof HTMLElement)) return
  const element = event.currentTarget
  const style = getComputedStyle(element)
  const writingMode = style.writingMode
  const vertical = writingMode.startsWith('vertical') || writingMode.startsWith('sideways')
  const scrollSize = vertical ? element.scrollWidth : element.scrollHeight
  const paddingStart = Number.parseFloat(style.paddingBlockStart) || 0
  const paddingEnd = Number.parseFloat(style.paddingBlockEnd) || 0
  const borderStart = Number.parseFloat(style.borderBlockStartWidth) || 0
  const borderEnd = Number.parseFloat(style.borderBlockEndWidth) || 0
  const blockSize =
    style.boxSizing === 'border-box'
      ? scrollSize + borderStart + borderEnd
      : scrollSize - paddingStart - paddingEnd
  if (!Number.isFinite(blockSize) || blockSize < 0) return
  element.style.setProperty('--llui-disclosure-block-size', `${blockSize}px`)
}

export interface ArmedDisclosureExit {
  readonly name: string
  readonly generation: number
  readonly effect?: Animation
}

function liveEffects(element: HTMLElement): readonly NamedEffect[] {
  return typeof element.getAnimations === 'function'
    ? (element.getAnimations({ subtree: false }) as NamedEffect[])
    : []
}

/**
 * Arm the concrete CSS animation/transition that began for one exit
 * generation.
 *
 * A skin's `[data-state='closing']` rule publishing `--llui-disclosure-exit-
 * animation: <name>` disambiguates WHICH of possibly several simultaneous
 * effects on the element is the exit — required when the skin animates more
 * than one property with more than one keyframe/transition. When no name is
 * published, the browser's own name is trusted directly: this element is
 * only ever animated by disclosure motion, so any effect starting while the
 * item is `closing` IS the exit. Requiring the named variable unconditionally
 * used to mean a custom skin with a perfectly real exit animation — just
 * without that one custom property — never armed at all, leaving the item
 * `closing` + `inert` forever once its animation ended (the end event had
 * nothing armed to complete).
 *
 * `enterEffect` is the concrete effect object captured for this element's
 * most recent ENTER (tracked by the caller), excluded from the candidate
 * search so a same-named, still-lingering enter effect can never be mistaken
 * for the exit that just started.
 */
export function armDisclosureExit(
  event: MotionEvent,
  generation: number,
  enterEffect?: Animation,
): ArmedDisclosureExit | undefined {
  measureDisclosureBlockSize(event)
  if (event.currentTarget !== event.target || !(event.currentTarget instanceof HTMLElement))
    return undefined
  const element = event.currentTarget
  const expectedName = getComputedStyle(element)
    .getPropertyValue('--llui-disclosure-exit-animation')
    .trim()
  const name = motionName(event)
  if (expectedName !== '' && name !== expectedName) return undefined
  const effect = liveEffects(element).find(
    (candidate) =>
      effectName(candidate) === name &&
      candidate.playState !== 'finished' &&
      candidate.playState !== 'idle' &&
      candidate !== enterEffect,
  )
  return {
    name,
    generation,
    ...(effect === undefined ? {} : { effect }),
  }
}

/**
 * Match completion to the exact armed generation and, when Web Animations is
 * available, the concrete effect object. A stale same-name cancel sees the
 * newer effect still running and cannot consume it.
 */
export function matchesArmedDisclosureExit(
  event: MotionEvent,
  generation: number,
  armed: ArmedDisclosureExit | undefined,
): armed is ArmedDisclosureExit {
  if (
    event.currentTarget !== event.target ||
    armed === undefined ||
    armed.generation !== generation ||
    armed.name !== motionName(event)
  )
    return false
  return (
    armed.effect === undefined || !['running', 'paused', 'pending'].includes(armed.effect.playState)
  )
}

/** The one fact a disclosure exit tracker needs about the current state,
 * named identically by every component that carries one (accordion is keyed
 * per item value; collapsible has exactly one). */
export interface DisclosureExitState {
  readonly closing: boolean
  readonly generation: number
}

export interface DisclosureExitTracker {
  /** Wire to the content element's `onAnimationStart` AND `onTransitionStart`. */
  readonly armExit: (event: MotionEvent, current: DisclosureExitState) => void
  /** Wire to `onAnimationEnd`/`onAnimationCancel`/`onTransitionEnd`/
   * `onTransitionCancel`. Returns `true` when this event completes the
   * currently armed exit generation — the caller sends its own
   * `exitComplete` message (whose payload shape differs per component) only
   * then. */
  readonly completeExit: (event: MotionEvent, current: DisclosureExitState) => boolean
  /**
   * Call SYNCHRONOUSLY right after the `send()` that applies a closing
   * transition (e.g. from the trigger's `onClick`, before the event loop
   * turn ends). `Element.getAnimations()` forces a style flush per spec, so
   * it already reflects an animation/transition the attribute change just
   * triggered — even though the browser has not yet queued a start event for
   * it. If the skin runs NO real exit motion for `closing` (a dropped rule, a
   * media query that doesn't match, `animation: none`/`transition: none`), no
   * start/end event will EVER fire, and the item would stay `closing` +
   * `inert` forever; this checks for exactly that and completes immediately
   * instead. Returns `true` when it completed.
   *
   * Environments with no Web Animations support (`getAnimations` absent,
   * e.g. jsdom) cannot tell "no animation" from "unknown", so this is
   * correctly a no-op there rather than guessing — it always returns
   * `false`, leaving the existing event-driven path as the only completion
   * route, exactly as before this method existed.
   */
  readonly completeIfUnanimated: (element: Element | null, current: DisclosureExitState) => boolean
}

/** Standalone form of `DisclosureExitTracker.completeIfUnanimated`, usable
 * outside a live tracker instance — it consults only the element's current
 * running effects and the given state, no tracker-private bookkeeping. Used
 * by the `exitCompletion` connect()-owned Mountable to settle a value that
 * entered `closing` from a message the click/keydown handlers never saw (a
 * PROGRAMMATIC close/toggle/setValue sent directly by the host app, #264
 * review item 4b) — the in-handler safety net above only ever runs for a
 * user-initiated close. */
export function completeIfUnanimated(
  element: Element | null,
  current: DisclosureExitState,
): boolean {
  if (!current.closing || element === null || !(element instanceof HTMLElement)) return false
  if (typeof element.getAnimations !== 'function') return false
  const running = element
    .getAnimations({ subtree: false })
    .filter((candidate) => ['running', 'paused', 'pending'].includes(candidate.playState))
  return running.length === 0
}

/** One closing content element a disclosure component wants watched: a
 * stable `key` (accordion's item value; collapsible's single instance uses
 * a constant key), whether it is CURRENTLY closing, its exit generation
 * (rejects a stale settle the same way the in-handler tracker does), and the
 * id its content element is rendered with. */
export interface DisclosureExitWatchEntry {
  readonly key: string
  readonly closing: boolean
  readonly generation: number
  readonly contentId: string
}

/**
 * Whether a component instance's `exitCompletion` part is CURRENTLY mounted
 * is a RUNTIME/VIEW fact, not domain state (#264 review-264j, FINAL — see
 * the header note above `EXIT_WATCHER_COUNTS`) — so it is answered by a
 * module-level runtime registry, never by anything in `AccordionState`/
 * `CollapsibleState` or any message. `opts.id` is already required and
 * unique per page (every `contentId`/`triggerId` is namespaced off it), so
 * it is also the natural key for "how many `exitCompletion` mounts currently
 * exist for this logical component instance" — two `connect()` calls
 * sharing one `id` (whether over the same state slice or, degenerately,
 * different ones) share ONE count by construction, with no coordination
 * needed between them.
 *
 * Never touched on the server: SSR (`renderToString`) never runs `onMount`,
 * so `attachExitWatcher`/`detachExitWatcher` are simply never called there
 * — nothing needs to special-case it.
 */
const EXIT_WATCHER_COUNTS = new Map<string, number>()

/** Increment the mount count for `id`. Call once per `exitCompletion` mount. */
export function attachExitWatcher(id: string): void {
  EXIT_WATCHER_COUNTS.set(id, (EXIT_WATCHER_COUNTS.get(id) ?? 0) + 1)
}

/**
 * Decrement the mount count for `id` (never below 0; the entry is deleted
 * once it reaches 0, so the registry never accumulates a dead key per page).
 * Returns `true` if `id` is STILL watched after this detach (another mount
 * is still live), `false` if this was the last one — the caller settles
 * every currently-closing entry for `id` only in the `false` case.
 */
export function detachExitWatcher(id: string): boolean {
  const current = EXIT_WATCHER_COUNTS.get(id) ?? 0
  const next = Math.max(0, current - 1)
  if (next === 0) EXIT_WATCHER_COUNTS.delete(id)
  else EXIT_WATCHER_COUNTS.set(id, next)
  return next > 0
}

/** `true` when at least one `exitCompletion` is CURRENTLY mounted for `id`. */
export function isExitWatcherAttached(id: string): boolean {
  return (EXIT_WATCHER_COUNTS.get(id) ?? 0) > 0
}

/**
 * The dev-mode "you forgot to place exitCompletion" warning, throttled ONCE
 * PER `id` (module-level — matching the registry's own keying, since two
 * `connect()` calls sharing an `id` are one logical warning target) rather
 * than once per `connect()` closure. No timer: `connect()`'s trigger
 * handlers call this at DISPATCH time, right before sending a
 * closing-capable message, whenever `animated` is true and the id has no
 * attached watcher.
 */
const WARNED_MISSING_WATCHER_IDS = new Set<string>()

export function warnMissingExitWatcherOnce(id: string, message: string): void {
  if (WARNED_MISSING_WATCHER_IDS.has(id) || import.meta.env?.DEV !== true) return
  WARNED_MISSING_WATCHER_IDS.add(id)
  console.warn(message)
}

/**
 * Root-scoped completion watcher, one per `connect()` call (#264 review item
 * 1). Resolves each closing entry's content element by ID
 * (`getElementByIdInScope`, never a scope-wide `[data-scope][data-part]`
 * query) so it cannot settle a SIBLING instance sharing the same onMount
 * build container — the container `onMount` hands a callback is the whole
 * enclosing BUILD, which is shared by every component placed inside one
 * parent view, not a box scoped to this one instance (see CLAUDE.md's
 * `onMount` invariant). Two accordions with an item sharing the same VALUE,
 * or an accordion and a collapsible both rendered inside one parent's view,
 * used to be settled by whichever container-wide query ran first, cutting a
 * running exit animation on the wrong instance.
 *
 * Returned as a `Mountable` meant for `connect()`'s own `exitCompletion`
 * part — it must be PLACED in the rendered view (as `parts.exitCompletion`)
 * for a `closing` retention to ever be entered at all (see #264 item F1
 * below); a click-driven close is still safety-netted synchronously inside
 * the trigger's own handler regardless of whether this is placed.
 *
 * **No timer, no deadline, no dev-mode stall watchdog (#264 item F1,
 * superseding review item 4).** The previous design retained `closing`
 * unconditionally whenever `animated: true`, so a forgotten `exitCompletion`
 * placement could leave an item stuck `closing` + `inert` forever. **#264
 * review-264j, FINAL — read this before touching the mechanism again**:
 * TWO earlier fixes for this each replaced the wrong thing. First, a
 * `setTimeout`-armed "has this been closing too long" watchdog — rejected
 * because it could never distinguish "genuinely stuck" from "no Web
 * Animations support" (jsdom has no `getAnimations`), and needed a
 * disposal/dedupe apparatus to avoid leaking timers. Then, an idempotent
 * "is anything watching" fact pushed into STATE (`exitWatched`/
 * `exitWatchers`, driven by `exitWatcherAttach`/`exitWatcherDetach`
 * MESSAGES) — rejected on THREE independent grounds, each fatal alone: (1)
 * a closure-owned mount COUNT keyed by dispatcher identity broke the moment
 * two `connect()` calls used two textually-identical but referentially
 * DIFFERENT inline dispatcher wrappers, since no `WeakMap` can unify two
 * distinct function objects; (2) the fix for THAT — a per-JS-realm session
 * token baked into state — made `init()` NON-DETERMINISTIC (a fresh random
 * token every call), which breaks `replayTrace`/`propertyTest` outright (a
 * recorded trace's `expectedState` embeds one realm's token and can never
 * match a replay's own) and is a direct violation of the JSON-serializable,
 * pure-`update()` state contract this file's own CLAUDE.md states; and (3) a
 * SAME-REALM restored snapshot (the overwhelmingly common real case — a
 * host persisting to `localStorage` and reloading in the SAME tab session,
 * or simply re-mounting from a saved snapshot without a real page reload)
 * is not "foreign" under that design at all, so a stale positive count
 * baked into a restored slice reads as watched with nothing real attached —
 * the exact hang this mechanism exists to prevent, reintroduced one field
 * over. The lesson generalizes: "is a watcher mounted" is a fact about the
 * RUNNING VIEW TREE, which state can only ever approximate with a snapshot
 * that goes stale the instant something remounts without a state change —
 * it can never correctly live in state at all, however it is encoded.
 *
 * The fix that actually holds: nothing about "is this watched" lives in
 * state or travels as a message. `EXIT_WATCHER_COUNTS` (above) is a
 * runtime-only registry, keyed by `opts.id`, mutated directly by this
 * function's own mount/cleanup — never through `send`, never serialized,
 * never replayed. What DOES travel as a message is the single bit the
 * reducer actually needs to decide `closing` vs instant-closed: a
 * `retain?: boolean` field on the closing-capable message itself (`close`/
 * `toggle`/`open`/`setValue` for accordion, `close`/`toggle`/`setOpen` for
 * collapsible), stamped by `connect()`'s trigger handlers from
 * `isExitWatcherAttached(id)` AT DISPATCH TIME — so the reducer stays
 * exactly as pure as ever (`animated && msg.retain === true`), `init()`
 * stays fully deterministic, and a replayed trace with `retain` baked into
 * each recorded message reproduces byte-identically regardless of what the
 * registry contains during replay (see `test/components/disclosure-exit-
 * replay.test.ts`). A raw `send({ type: 'close', value })` from app/agent
 * code with no `retain` closes instantly — documented, fail-safe — and
 * `connect()` exposes an animated-aware helper (`parts.close`) for a host
 * that wants a programmatic close to retain correctly.
 *
 * `connect()` also warns once per `id` (`warnMissingExitWatcherOnce`,
 * module-level — see above), synchronously, at dispatch time, the first
 * time a closing message is sent while `animated` is true and the id's
 * watcher is not attached — no timer either. What THIS function still owns
 * is the residual case where the watcher IS attached but the skin's own
 * animated exit runs no actual CSS motion (a dropped rule, a media query
 * that doesn't match): `check()` below settles those reactively off a
 * `MutationObserver` on `data-state`, with no deadline and nothing to leak
 * — and its OWN cleanup additionally settles every still-`closing` entry
 * for `id` unconditionally the moment the LAST watcher for that id detaches
 * (`detachExitWatcher` returning `false`), which is what makes "detaching
 * exitCompletion mid-closing settles it" hold with no message dedicated to
 * detach at all: the settle uses the ordinary `exitComplete` message every
 * other completion path already sends.
 */
export function createDisclosureExitCompletionMount(
  id: string,
  getElementByIdInScope: (root: Node, id: string) => HTMLElement | null,
  getEntries: () => readonly DisclosureExitWatchEntry[],
  onSettle: (key: string, generation: number) => void,
): (container: Element) => () => void {
  return (container: Element) => {
    attachExitWatcher(id)
    const check = (): void => {
      for (const entry of getEntries()) {
        if (!entry.closing) continue
        const content = getElementByIdInScope(container, entry.contentId)
        if (completeIfUnanimated(content, { closing: true, generation: entry.generation })) {
          onSettle(entry.key, entry.generation)
        }
      }
    }
    check()

    let observer: MutationObserver | undefined
    if (typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(check)
      observer.observe(container, {
        attributes: true,
        attributeFilter: ['data-state'],
        subtree: true,
      })
    }
    return () => {
      observer?.disconnect()
      // The LAST watcher for this id just detached: nothing will ever
      // complete a still-closing entry, so settle every one of them now,
      // through the ordinary `exitComplete` message (never a dedicated
      // "detach" message — see this function's own header).
      if (!detachExitWatcher(id)) {
        for (const entry of getEntries()) {
          if (entry.closing) onSettle(entry.key, entry.generation)
        }
      }
    }
  }
}

/**
 * ONE shared arm/match state machine for every disclosure component that
 * retains `closing` content until its own exit animation/transition ends.
 * Construct one per `connect()` call — its WeakMaps are keyed by the live DOM
 * node, so a single instance safely tracks every item's own content element
 * (accordion has one instance for the whole `connect()`, addressing N items;
 * collapsible has exactly one content element).
 */
export function createDisclosureExitTracker(): DisclosureExitTracker {
  const armedExits = new WeakMap<EventTarget, ArmedDisclosureExit>()
  const enterEffects = new WeakMap<EventTarget, Animation>()

  return {
    armExit(event, current) {
      const target = event.currentTarget
      if (target === null || target !== event.target || !(target instanceof HTMLElement)) return
      if (current.closing) {
        const armed = armDisclosureExit(event, current.generation, enterEffects.get(target))
        if (armed !== undefined) armedExits.set(target, armed)
      } else {
        measureDisclosureBlockSize(event)
        armedExits.delete(target)
        const name = motionName(event)
        const enter = liveEffects(target).find(
          (candidate) =>
            effectName(candidate) === name &&
            candidate.playState !== 'finished' &&
            candidate.playState !== 'idle',
        )
        if (enter === undefined) enterEffects.delete(target)
        else enterEffects.set(target, enter)
      }
    },
    completeExit(event, current) {
      const target = event.currentTarget
      if (target === null) return false
      if (
        !current.closing ||
        !matchesArmedDisclosureExit(event, current.generation, armedExits.get(target))
      )
        return false
      armedExits.delete(target)
      return true
    },
    completeIfUnanimated,
  }
}
