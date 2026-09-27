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
 * placement could leave an item stuck `closing` + `inert` forever — the
 * fallback was a `setTimeout`-armed "has this been closing too long"
 * watchdog, which (a) could never fully distinguish "genuinely stuck" from
 * "no Web Animations support" (jsdom has no `getAnimations`, so
 * `completeIfUnanimated` always reports "unknown" there, which read as
 * "still running" and warned falsely after the deadline even when nothing
 * was actually stuck) and (b) needed a whole disposal/dedupe apparatus to
 * avoid leaking timers or re-warning. The fail-safe is now structural
 * instead of diagnostic: `connect()` tracks how many `exitCompletion` mounts
 * are currently attached in `state.exitWatchers` (`{ session, count }`,
 * #264 review-264i — see `ExitWatchers`'s own header below), incremented/
 * decremented by an `exitWatcherAttach`/`exitWatcherDetach` message this
 * mount sends on mount/cleanup, and the reducer only ever enters `closing`
 * when `animated && isExitWatched(exitWatchers)` both hold — otherwise it
 * closes INSTANTLY, the same as `animated: false`. A forgotten placement
 * can therefore never hang:
 * there is no `closing` state to get stuck in. `connect()` also warns once,
 * synchronously, the first time a close would have retained but the watcher
 * was never attached (see `accordion.ts`/`collapsible.ts`), which needs no
 * timer either. What THIS function still owns is the residual case where the
 * watcher IS attached but the skin's own animated exit runs no actual
 * CSS motion (a dropped rule, a media query that doesn't match): `check()`
 * below settles those reactively off a `MutationObserver` on `data-state`,
 * with no deadline and nothing to leak.
 */
/**
 * `sendAttach`/`sendDetach` fold the watcher-count bookkeeping into THIS one
 * mount instead of a wrapping `onMount` body each caller used to write by
 * hand (#264 review follow-up — one shared helper, never two copies that
 * could drift): `accordion.ts` and `collapsible.ts` now pass this function
 * itself as their `exitCompletion`'s `onMount` callback, with nothing
 * wrapping it. `sendAttach` fires exactly once, synchronously, before the
 * first `check()` (so a value already `closing` at mount is checked against
 * a watcher the reducer already knows is attached); `sendDetach` fires
 * exactly once, from the returned cleanup, whether or not `MutationObserver`
 * exists — a browser with no exit-motion support still needs its detach
 * counted, or the reducer's count and the real mount count drift apart the
 * moment such an environment unmounts.
 */
export function createDisclosureExitCompletionMount(
  getElementByIdInScope: (root: Node, id: string) => HTMLElement | null,
  getEntries: () => readonly DisclosureExitWatchEntry[],
  onSettle: (key: string, generation: number) => void,
  sendAttach: () => void,
  sendDetach: () => void,
): (container: Element) => () => void {
  return (container: Element) => {
    sendAttach()
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

    if (typeof MutationObserver === 'undefined') return sendDetach
    const observer = new MutationObserver(check)
    observer.observe(container, {
      attributes: true,
      attributeFilter: ['data-state'],
      subtree: true,
    })
    return () => {
      observer.disconnect()
      sendDetach()
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

/**
 * How many `exitCompletion` mounts a disclosure component's `closing`
 * retention is conditioned on being CURRENTLY live — held entirely in
 * ordinary, JSON-serializable STATE (#264 review-264i: replaces the
 * closure-owned counter from #264 review M1/review-264h, which broke the
 * moment two `connect()` calls over the same slice used two DIFFERENT
 * dispatcher wrappers — an idiomatic
 * `(msg) => send({ type: 'accordion', msg })` written inline at each call
 * site, rather than a single shared `send` reference — since the closure
 * counter was keyed by DISPATCHER IDENTITY and two distinct inline arrows
 * are two distinct objects no `WeakMap` can unify. Counting in STATE instead
 * means every `exitWatcherAttach`/`exitWatcherDetach` message lands on the
 * SAME reducer regardless of how many independent `connect()` closures (or
 * dispatcher wrapper shapes) sent it, so the count is correct by
 * construction — no coordination between `connect()` calls is needed at
 * all.
 *
 * The hazard the OLD design's closure-counting existed to avoid — a
 * persisted/restored state slice bypassing `init()` and carrying a stale
 * count from a PAST session, permanently reading as "watched" with nothing
 * really mounted — is answered here by `session`, a token identifying the
 * CURRENT JS realm (one value per module evaluation, i.e. once per page
 * load/worker/SSR render; see {@link CURRENT_EXIT_WATCHER_SESSION}). A
 * restored `count` whose `session` does not match this realm's is FOREIGN —
 * necessarily from a past page load, since nothing in this realm could have
 * written it — and is read as unwatched regardless of its number, exactly
 * once, the first time either `attachExitWatcher` or `detachExitWatcher`
 * touches it: attaching resets it to `{ session: CURRENT, count: 1 }` and
 * detaching to `{ session: CURRENT, count: 0 }`, so a foreign entry can
 * never need a second correction. No microtask, no scheduling, no
 * `try`/`catch` around a signal peek, no dev-log noise on a disposed
 * `send` — the self-heal is a pure, synchronous, ordinary reducer
 * transition, not a side effect racing the mount.
 *
 * `count` still exists (not a bare boolean) so TWO concurrent placements —
 * an unusual but real shape, e.g. two arms of a conditional both rendering
 * `exitCompletion` — are correct: one detaching does not un-watch the slice
 * while another placement is still mounted.
 */
export interface ExitWatchers {
  readonly session: string
  readonly count: number
}

/**
 * One token per module evaluation — a fresh value every time this module is
 * loaded into a new JS realm (a page load, a worker, an SSR render process),
 * and the SAME value for every `connect()` call within that realm, however
 * many independent components/dispatchers there are. Its value is never
 * compared across realms except for equality against a state slice's own
 * recorded `session` — a non-deterministic value is fine, and no ordering or
 * uniqueness guarantee beyond "not equal to another realm's token, almost
 * certainly" is relied on.
 *
 * SSR-safe by construction, with no special-casing: the server process that
 * renders `renderToString` output evaluates this module in its OWN realm and
 * never mounts `exitCompletion` (SSR does not run `onMount`), so a
 * server-rendered `exitWatchers` always serializes as `{ session:
 * <server's token>, count: 0 }`. The client then evaluates this module
 * AGAIN, in the browser's realm, minting its OWN token — necessarily
 * different from the server's — so hydration reads the server's `session`
 * as foreign and treats it as unwatched, which is already the correct
 * answer (`count` was `0` regardless). The token itself is never rendered
 * into DOM output (nothing here touches an attribute or text node), so
 * there is no hydration MISMATCH to cause — only ordinary component state
 * that happens to differ from the server's, exactly like any other field a
 * host chooses not to carry across a reload.
 */
const CURRENT_EXIT_WATCHER_SESSION: string = createExitWatcherSession()

function createExitWatcherSession(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}:${Math.random().toString(36).slice(2)}`
}

/** The state a fresh `init()` always starts with: this realm's own session,
 * watching nobody. */
export function initExitWatchers(): ExitWatchers {
  return { session: CURRENT_EXIT_WATCHER_SESSION, count: 0 }
}

/**
 * `true` exactly when at least one `exitCompletion` is mounted IN THIS
 * REALM right now — a foreign `session` (necessarily from a past page load)
 * is never watched, whatever its `count` says.
 */
export function isExitWatched(watchers: ExitWatchers): boolean {
  return watchers.session === CURRENT_EXIT_WATCHER_SESSION && watchers.count > 0
}

/** Reducer transition for `exitWatcherAttach`. A foreign `session` is reset
 * to this realm's, at count 1 — it cannot need incrementing, since nothing
 * in this realm could have attached against it before now. */
export function attachExitWatcher(watchers: ExitWatchers): ExitWatchers {
  return watchers.session === CURRENT_EXIT_WATCHER_SESSION
    ? { session: watchers.session, count: watchers.count + 1 }
    : { session: CURRENT_EXIT_WATCHER_SESSION, count: 1 }
}

export interface ExitWatcherDetachResult {
  readonly watchers: ExitWatchers
  /** `true` exactly when this detach brought the slice from watched to
   * unwatched (in THIS realm) — the caller settles any currently-closing
   * content only on this transition, never on every detach, matching the
   * original 1->0-only settle behavior. */
  readonly settledToZero: boolean
}

/** Reducer transition for `exitWatcherDetach`. A foreign `session` resets to
 * this realm's at count 0 (never negative — there was nothing in this realm
 * to detach from) and always reports `settledToZero`, since a foreign entry
 * is by definition already not watched by this realm and adopting it is
 * itself the corrective transition (the #264 review-264h "restored stale
 * flag" case, now handled by the SAME arithmetic as an ordinary detach
 * rather than a separate microtask-scheduled recovery). */
export function detachExitWatcher(watchers: ExitWatchers): ExitWatcherDetachResult {
  if (watchers.session !== CURRENT_EXIT_WATCHER_SESSION) {
    return { watchers: { session: CURRENT_EXIT_WATCHER_SESSION, count: 0 }, settledToZero: true }
  }
  const count = Math.max(0, watchers.count - 1)
  return { watchers: { session: watchers.session, count }, settledToZero: count === 0 }
}

/**
 * The dev-mode "you forgot to place exitCompletion" warning, shared between
 * `accordion.ts` and `collapsible.ts` (#264 review LOW — one helper, not two
 * copies that could drift). Owned by the CALLER's `connect()` closure (dev
 * only, throttled to once per instance, no timer) — the caller computes
 * `missingWatcherClose` itself (the shape of "did this close without
 * retention because no watcher was attached" differs slightly between the
 * two components) and this only owns the throttling + the message.
 */
export function createMissingExitWatcherWarning(
  message: string,
): (missingWatcherClose: boolean) => void {
  let warned = false
  return (missingWatcherClose: boolean): void => {
    if (warned || !missingWatcherClose || import.meta.env?.DEV !== true) return
    warned = true
    console.warn(message)
  }
}
