import type { Router } from './index.js'
import { a, onMount } from '@llui/dom'
import type { Mountable, Renderable, ChildNode } from '@llui/dom'

// ── Router Effects ───────────────────────────────────────────────

export interface RouterEffect {
  type: '__router'
  action: 'push' | 'replace' | 'navigate' | 'back' | 'forward' | 'scroll'
  path?: string
  /**
   * The ORIGINAL route object the caller passed to `push`/`replace`/`navigate`.
   * `path` is a lossy URL projection (only fields representable in the URL survive
   * `href`), so guards (`beforeEnter`/`beforeLeave`) and the dispatched navigate
   * message must run against this full object — not against `match(path)`, which
   * would silently drop non-URL fields (e.g. a `draft` flag or a data payload).
   */
  route?: unknown
  x?: number
  y?: number
}

// ── Router environment ───────────────────────────────────────────

/**
 * The History / Location / scroll surface `connectRouter` depends on, injected
 * rather than reached for globally — the same pattern `@llui/dom`'s
 * `dom-env.ts` already models, and for the same three reasons: no
 * `globalThis` mutation (strict-isolate runtimes forbid it), no process-level
 * singleton two routers could collide on, and a test/SSR host can supply its
 * own surface instead of shimming the world.
 *
 * The surface is deliberately narrow — exactly what the connector touches. The
 * READ members return an empty/`null` value where the corresponding global is
 * absent, matching the guards this replaced; the MUTATORS dereference their
 * global at call time, so invoking one on a runtime with no history is the same
 * error it always was.
 */
export interface RouterEnv {
  /** `location.hash` (`''` where there is no location). */
  readonly hash: string
  /** `location.pathname` (`''` where there is no location). */
  readonly pathname: string
  /** `location.search` (`''` where there is no location). */
  readonly search: string
  /** `history.state` (`null` where there is no history). */
  readonly historyState: unknown
  /**
   * `history.length` — the session-history entry count (`0` where there is no
   * history).
   *
   * A CAPABILITY TEST, not a position. `0` means "this surface has no history at
   * all" — every real session history contains at least the entry you are
   * standing on — and that is the only question asked of it: the
   * construction-time seed checks it before writing a stamp, which is what keeps
   * an SSR import (where `connectRouter` runs at module scope) a no-op instead
   * of a throw.
   *
   * It is NO LONGER the hash-mode push-vs-traversal discriminator. That use was
   * deleted in #150 — see `adoptLandedEntry` for why — so an implementation is
   * free to report any positive constant for a surface that has a history, and
   * reporting an exact count buys nothing.
   */
  readonly historyLength: number

  /** Assign `location.hash` — a same-document navigation that fires `hashchange`. */
  setHash(hash: string): void
  /** `location.replace(url)` — swap the current entry without growing history. */
  replaceLocation(url: string): void

  pushState(state: unknown, url: string): void
  /**
   * `history.replaceState(state, '', url)` — swap the current entry's state,
   * and its URL when one is given.
   *
   * `url` is OPTIONAL because "re-stamp this entry's state and leave the URL
   * alone" is a distinct operation (merging a foreign key into `history.state`,
   * recording a scroll offset), and `''` does not express it: an empty url
   * resolves against the document base and drops the fragment, which silently
   * breaks hash mode. An implementation must forward an absent `url` as absent.
   */
  replaceState(state: unknown, url?: string): void
  back(): void
  forward(): void
  /** `history.go(delta)` — used to REWIND a blocked pop, never a fresh push. */
  go(delta: number): void

  scrollTo(x: number, y: number): void

  /**
   * Subscribe to a browser-driven URL change. Returns the unsubscribe, so the
   * caller never has to hold the handler identity to detach it.
   */
  onUrlChange(event: 'popstate' | 'hashchange', handler: () => void): () => void
}

/**
 * Wrap the browser globals as a {@link RouterEnv} — the default for
 * `connectRouter`.
 *
 * Reads delegate through getters, so evaluating this on a server process before
 * a DOM exists is safe: the globals are only dereferenced when a member is
 * actually used, and the read members fall back rather than throwing (the
 * connector seeds its starting route at construction time, which happens at
 * module scope in most apps).
 */
export function browserRouterEnv(): RouterEnv {
  return {
    get hash() {
      return typeof location === 'undefined' ? '' : location.hash
    },
    get pathname() {
      return typeof location === 'undefined' ? '' : location.pathname
    },
    get search() {
      return typeof location === 'undefined' ? '' : location.search
    },
    get historyState() {
      return typeof history === 'undefined' ? null : history.state
    },
    get historyLength() {
      return typeof history === 'undefined' ? 0 : history.length
    },
    setHash: (hash) => {
      location.hash = hash
    },
    replaceLocation: (url) => location.replace(url),
    pushState: (state, url) => history.pushState(state, '', url),
    // `null` rather than a forwarded `undefined`: both mean "leave the URL
    // alone" to `history.replaceState`, but only one says so on purpose.
    replaceState: (state, url) => history.replaceState(state, '', url ?? null),
    back: () => history.back(),
    forward: () => history.forward(),
    go: (delta) => history.go(delta),
    scrollTo: (x, y) => window.scrollTo(x, y),
    onUrlChange: (event, handler) => {
      window.addEventListener(event, handler)
      return () => {
        window.removeEventListener(event, handler)
      }
    },
  }
}

export interface ConnectOptions<R> {
  /**
   * The History/Location surface to drive (default: {@link browserRouterEnv}).
   * Inject one to route a test, an SSR host, or an embedded frame through its
   * own history without touching the page's.
   */
  env?: RouterEnv

  /**
   * Called before entering a new route. Return:
   * - `void` / `undefined` → allow navigation
   * - `false` → block navigation (stay on current route)
   * - a different `Route` → redirect to that route
   */
  beforeEnter?: (to: R, from: R | null) => R | false | void
  /**
   * Called before leaving the current route. Return:
   * - `true` → allow navigation
   * - `false` → block (e.g. unsaved changes prompt)
   */
  beforeLeave?: (from: R, to: R) => boolean

  /**
   * Build the message dispatched by the `navigate()` effect (and the
   * popstate/hashchange listener and `link()`) when the route changes.
   * Defaults to `{ type: 'navigate', route }`. Override only if your app
   * uses a different message shape for route changes; the same factory then
   * applies to every route-change dispatch so they stay consistent.
   */
  navigateMsg?: (route: R) => unknown
}

export interface ConnectedRouter<R> {
  /**
   * Effect: push a new history entry — URL only.
   *
   * Use when the reducer that emitted the effect has already updated
   * `state.route` itself (e.g. a `Router/Navigate` handler that bundles
   * state changes inline before delegating URL work). For
   * navigate-and-let-the-app-react flows from anywhere else, prefer
   * `navigate()` — it dispatches the listener-captured navigate
   * message after pushState so `state.route` and route-side-effects
   * stay in sync without each reducer re-implementing the delegation.
   */
  push(route: R): RouterEffect
  /**
   * Effect: replace the current history entry — URL only. Same
   * URL-only contract as `push()`. For replace-and-react flows, see
   * `navigate()` (push semantics) — there's no `replaceAndDispatch`
   * variant yet because the use case hasn't surfaced; if it does,
   * model it the same way.
   */
  replace(route: R): RouterEffect
  /**
   * Effect: push history AND dispatch the listener-captured navigate
   * message so the reducer can update `state.route` and run any
   * route-side-effects (data fetches, page-meta resets, analytics).
   *
   * Resolves the asymmetry where `link()` did pushState + send while
   * `push()` did pushState only — apps that wanted programmatic
   * navigation from arbitrary reducers had to either re-implement the
   * delegation or live with desynced `state.route`.
   *
   * Dispatches through the `send` the effect runner hands every effect,
   * so it works from ANY effect — including an `init()` effect that runs
   * before any view mounts. It does NOT depend on `listener()` being
   * mounted (that only handles browser-driven popstate/hashchange).
   * The message shape is `{ type: 'navigate', route }` unless overridden
   * via `connectRouter`'s `navigateMsg` option.
   */
  navigate(route: R): RouterEffect
  /** Effect: go back */
  back(): RouterEffect
  /** Effect: go forward */
  forward(): RouterEffect
  /** Effect: scroll to position */
  scroll(x: number, y: number): RouterEffect

  /** Plugin for handleEffects().use() — handles RouterEffect */
  handleEffect: (ctx: { effect: { type: string }; send: unknown; signal: AbortSignal }) => boolean

  /**
   * View helper: attach URL change listener via onMount.
   * Returns the onMount marker to place in the view. Sends { type: 'navigate', route } on URL change.
   */
  listener<M>(send: (msg: M) => void, msgFactory?: (route: R) => M): Renderable

  /**
   * View helper: render a navigation link.
   * Generates <a> with proper href and click handler that sends navigate message.
   */
  link<M>(
    send: (msg: M) => void,
    route: R,
    attrs: Record<string, unknown>,
    children: readonly ChildNode[],
    msgFactory?: (route: R) => M,
  ): Mountable

  /**
   * Create an update handler for navigate messages — call it from your
   * component's `update` (returns early when it handles the message).
   * Returns [newState, Effect[]] for navigate messages, null for others.
   */
  createHandler<S, M, E>(config: {
    /** Message type to handle (default: 'navigate') */
    message?: string
    /** Extract route from message */
    getRoute: (msg: M) => R
    /** Optional guard — can redirect */
    guard?: (route: R, state: S) => R
    /** Build new state + effects for the route */
    onNavigate: (state: S, route: R) => [S, E[]]
  }): (state: S, msg: M) => [S, E[]] | null
}

/** history.state key holding our monotonic navigation index. */
const STATE_KEY = '__llui_idx'

/**
 * history.state key holding the RUN an entry's index was numbered in.
 *
 * An index is only ever comparable to another index from the SAME run — see
 * `mintRun` for what a run is and why the id has to live on the entry rather
 * than in a variable.
 */
const RUN_KEY = '__llui_run'

/**
 * The run of an entry stamped by a build that pre-dates {@link RUN_KEY}.
 *
 * It is a real run id — such entries were numbered consecutively by that build,
 * so its numbering can be adopted and CONTINUED — but it is never MINTED: an
 * entry we number without knowing the position of the one below it always opens
 * a run of its own.
 */
const LEGACY_RUN = ''

/**
 * A fresh run id.
 *
 * It has to be unpredictable rather than counted. A counter restarts at the same
 * value on every page load while the ids it issued LAST load are still sitting
 * on entries in the same session history, so `run-1` would name two unrelated
 * runs and a delta could be computed straight across the gap between them. The
 * only operation performed on the id is equality, so ~50 bits of entropy is
 * ample and the value is never parsed.
 */
function mintRun(): string {
  return Math.random().toString(36).slice(2)
}

/** The outcome of the guard pipeline for one navigation. */
type GuardOutcome<R> = { blocked: true } | { blocked: false; route: R; redirected: boolean }

/** Our index stamped on a history entry, or `null` when nobody stamped it. */
function readIndex(state: unknown): number | null {
  if (state !== null && typeof state === 'object') {
    const v = (state as Record<string, unknown>)[STATE_KEY]
    if (typeof v === 'number') return v
  }
  return null
}

/**
 * The run a STAMPED entry's index belongs to. Only meaningful where
 * {@link readIndex} returned a number; an absent key means {@link LEGACY_RUN}.
 */
function readRun(state: unknown): string {
  if (state !== null && typeof state === 'object') {
    const v = (state as Record<string, unknown>)[RUN_KEY]
    if (typeof v === 'string') return v
  }
  return LEGACY_RUN
}

/** Normalize a hash for comparison: `''` and `'/x'` both mean `'#/'`-rooted. */
function normHash(h: string): string {
  return h === '' ? '#/' : h.startsWith('#') ? h : '#' + h
}

function sameHash(a: string, b: string): boolean {
  return normHash(a) === normHash(b)
}

/**
 * Bind a {@link Router} to a History/Location surface: the effect handler, the
 * browser-driven URL listener, and the `link()` helper, all running the same
 * guard pipeline.
 *
 * POSITION MODEL (what a blocked navigation is undone with). The browser
 * exposes no counter for "where in the stack am I", so every entry this
 * connector creates is stamped with a monotonic index in `history.state` (under
 * `__llui_idx`, merged into whatever the host already owns there), starting with
 * the entry the app loaded on. A guard-blocked browser navigation is undone by
 * `history.go(delta)` computed from two such stamps — a TRAVERSAL, so the stack,
 * its length and every forward entry survive exactly as they were (#103).
 *
 * An entry NOBODY stamped has no knowable position, and no position is invented
 * for one — in either mode (#150; the reasoning, the alternatives that were
 * measured and rejected, and the behaviour this costs are all recorded on
 * `adoptLandedEntry`). Blocking a navigation onto such an entry is
 * guard-honouring but NOT undoable: nothing is dispatched and `state.route`
 * keeps the route you never left, but the URL is left showing the blocked one
 * until the next navigation. That visible disagreement is deliberately preferred
 * over a guessed `history.go(delta)`, which traverses to the wrong entry and
 * dispatches a route the user never asked for.
 *
 * An index is therefore only half of a position. `delta = here - there` is the
 * PHYSICAL distance between two entries only while every entry between them was
 * numbered in the same consecutive pass; an entry the router could not place
 * ENDS such a pass, and the next one it numbers starts a new one whose indices
 * count physical entries from a different origin. So each stamp also carries the
 * RUN it was numbered in (`__llui_run`, see `mintRun`), and a delta is computed
 * only between two entries of the same run. Across runs the distance is
 * unknowable and the block is left un-undone, exactly as it is for an entry with
 * no stamp at all.
 *
 * Every history/location touch goes through {@link RouterEnv} (default
 * {@link browserRouterEnv}); nothing in this file reaches for `location`,
 * `history` or `window` directly (#111).
 */
export function connectRouter<R>(
  router: Router<R>,
  options?: ConnectOptions<R>,
): ConnectedRouter<R> {
  // The canonical route-change message factory. Used by the navigate()
  // effect, the popstate/hashchange listener, and link() so every
  // route-change dispatch produces the same message shape.
  const navigateMsg: (route: R) => unknown =
    options?.navigateMsg ?? ((r: R) => ({ type: 'navigate', route: r }))

  // Every history/location touch below goes through this. Never reach for
  // `location`/`history`/`window` directly here (#111).
  const env = options?.env ?? browserRouterEnv()

  // Seed currentRoute from the current location so the first navigation's
  // guards see the actual starting route as `from` (not null) and a
  // blocked navigation can restore the real starting URL. With no location the
  // env reads as `''`, which matches to the root route (or the fallback under a
  // base) — exactly what the `'#/'`/`'/'` defaults this replaced resolved to.
  function currentInput(): string {
    return router.mode === 'hash' ? env.hash : env.pathname + env.search
  }
  let currentRoute: R | null = (() => {
    try {
      return router.match(currentInput())
    } catch {
      return null
    }
  })()

  /**
   * The `history.state` to write when re-stamping the CURRENT entry, preserving
   * every other key already on it — the seed rewrites an entry the host app (or
   * another library) may already own state on.
   *
   * Closes over `env` rather than reading `history.state` itself, so a stamp
   * lands on the injected surface like every other history touch here (#111).
   */
  function stampCurrent(index: number): Record<string, unknown> {
    const existing = env.historyState
    const base =
      existing !== null && typeof existing === 'object' ? (existing as Record<string, unknown>) : {}
    const stamped: Record<string, unknown> = { ...base, [STATE_KEY]: index }
    // The run travels with the index or the pair means nothing. `LEGACY_RUN` is
    // spelled as the ABSENCE of the key — it is the run of a build that had no
    // key — so continuing that numbering must also DELETE any id the merged
    // base carried, rather than leave a stale one beside a fresh index.
    if (currentRun === LEGACY_RUN) delete stamped[RUN_KEY]
    else stamped[RUN_KEY] = currentRun
    return stamped
  }

  // Our position in the session history stack. The browser exposes no such
  // counter, so it is carried in `history.state` on every entry we create and
  // is what a blocked navigation's `history.go(delta)` restore is computed
  // from. `null` means UNKNOWN — we are sitting on an entry nobody stamped, so
  // no delta can be derived and none may be guessed.
  let currentIndex: number | null = null
  // The run `currentIndex` is numbered in, `null` whenever `currentIndex` is.
  // Two indices are only comparable within one run (see the POSITION MODEL
  // above and `standingIndex`).
  let currentRun: string | null = null
  // `historyLength > 0` is the env's own "is there a history here" capability
  // test, replacing the `typeof history !== 'undefined'` guard this seed used
  // to carry: an injected env is never `undefined`, so the existence check has
  // to be asked of the ENV. Every real session history has at least the entry
  // you are standing on, and `browserRouterEnv` reports `0` exactly where the
  // global is absent — so this is the same question, asked through the seam. It
  // guards a WRITE, and `connectRouter` typically runs at module scope, so
  // without it an SSR import would throw where it used to no-op.
  if (env.historyLength > 0) {
    const seeded = readIndex(env.historyState)
    if (seeded !== null) {
      // An entry we (or a previous lifetime of this connector, across a reload)
      // already stamped: adopt its position AND its run, so the numbering
      // continues the one the entries below it belong to.
      currentIndex = seeded
      currentRun = readRun(env.historyState)
    } else {
      // Seed the entry the app LOADED on. Without this stamp a pop back onto
      // it carries no index, `currentIndex` never resyncs across it, and every
      // later delta is inflated — a blocked back then calls `history.go` with
      // an unreachable delta, leaves the URL sitting on the route it just
      // blocked, and (worse) leaves the suppression armed for a restore that
      // never happened, swallowing the user's next genuine pop (#103).
      //
      // It opens a NEW run, because this is a position we do not know: an
      // earlier lifetime of the router may have left stamped entries BELOW us
      // (load, navigate, hand-edit the fragment, reload), and index `0` here is
      // no relation to their numbering. A fresh id makes those entries
      // incomparable instead of subtractable.
      currentRun = mintRun()
      currentIndex = 0
      // No path: this re-stamps the entry we are ALREADY on. Passing `''` here
      // resolves against the document base and drops the fragment, silently
      // breaking hash mode (see `RouterEnv.replaceState`).
      env.replaceState(stampCurrent(0))
    }
  }

  // How many `hashchange` events our own writes are about to echo back, and
  // where the last of those writes left the URL. A BOOLEAN cannot express this:
  // hashchange events QUEUE, so two navigations in one tick echo twice and one
  // flag swallows only the first — the second navigation's message is then
  // dispatched a SECOND time, running the reducer and its effects twice (#108).
  // `batch()` makes multi-send bursts an explicitly supported pattern, so a
  // batched navigation is not an exotic case.
  //
  // A COUNT plus the newest hash, not a queue of them: only those two are ever
  // read, and #110.2 made a mounted `listener()` optional — a hash app can
  // navigate for its whole lifetime with nothing subscribed, which grew a queue
  // by one string per navigation for events nobody would ever consume. As a
  // pair of scalars that leak is unrepresentable rather than merely capped.
  let pendingEchoCount = 0
  let pendingEchoHash: string | null = null

  /** Arm the echo `hashchange` one of our own URL writes is about to produce. */
  function armEcho(newHash: string): void {
    pendingEchoCount++
    pendingEchoHash = normHash(newHash)
  }
  // The index a blocked navigation's `history.go` is restoring to, or `null`.
  // Keyed on the destination rather than a bare flag: `history.go` is
  // asynchronous and a delta it cannot reach fires nothing at all, so a flag
  // stays armed and swallows the next genuine popstate (#103).
  let pendingRestoreIndex: number | null = null
  /** The run `pendingRestoreIndex` is numbered in — the other half of its identity. */
  let pendingRestoreRun: string | null = null

  /**
   * The index of the entry we are physically STANDING on, resolved as the RUN
   * the caller is about to number in — `null` when that entry has no knowable
   * position, which OPENS a new run. `currentRun` is left holding the run to
   * stamp either way, so a caller only has to decide what index to write.
   *
   * The answer comes from the ENTRY, never from `currentIndex`, which is not
   * always the last thing we wrote. Two ways it lies, in opposite directions:
   *
   * - `history.go` is asynchronous, so an app that navigates in the same tick as
   *   a blocked pop pushes from the BLOCKED entry, truncating everything above
   *   it. `currentIndex` there claims a depth the stack no longer has, and the
   *   next blocked back computes an unreachable delta — #103's original symptom,
   *   re-reachable (#139 review). The landed entry's own stamp says otherwise.
   * - A FOREIGN `history.pushState` (analytics, an embedded widget, another
   *   framework) creates an entry and fires NOTHING, so the router never learns
   *   it moved. `currentIndex` still names the entry below, and numbering the
   *   next push from it puts an index distance of 1 across a physical distance
   *   of 2 — the same gap a hand-edited hash entry opens, in HISTORY mode, where
   *   there is no address bar to blame. Reading the entry catches it: the state
   *   under us is the foreign one and carries no stamp.
   *
   * So an unstamped entry is unknown even when we think we know where we are.
   * The one case that costs is a foreign `replaceState` CLOBBERING a stamp of
   * ours — the entry really is where `currentIndex` says, and the run restarts
   * for nothing. Nothing distinguishes it from the foreign push above, and the
   * two failure directions are a lost undo versus a wrong traversal.
   *
   * The `null` case is where a GAP in the index space would otherwise open. It
   * used to floor to `0` and number up from there, producing indices that LOOK
   * contiguous with the entries below and are not: with
   * `root(0) | hand-edited | admin(1)` a guard-blocked `history.go(-2)` onto the
   * root computed `delta = 1`, traversed ONE entry, landed on the hand-edited
   * page and dispatched a route the user never asked for (#150 review). Opening
   * a run instead keeps the arithmetic honest — the entries above are numbered
   * from their own origin and are simply not comparable with what is below them,
   * which `restoreBlocked` turns into "leave the URL alone" rather than a wrong
   * `history.go`.
   */
  function standingIndex(): number | null {
    const landed = readIndex(env.historyState)
    if (landed !== null) {
      currentRun = readRun(env.historyState)
      return landed
    }
    currentRun = mintRun()
    return null
  }

  /** The index for an entry we are about to CREATE above the one we stand on. */
  function indexForPush(): number {
    const standing = standingIndex()
    return standing === null ? 0 : standing + 1
  }

  /** The index for an entry we are about to REPLACE in place. */
  function indexForReplace(): number {
    return standingIndex() ?? 0
  }

  /**
   * The `history.state` for an entry we are CREATING — index plus run, merged
   * with nothing, because the entry does not exist yet (`stampCurrent`'s merge
   * would carry the state of the entry we are LEAVING onto it).
   */
  function freshStamp(index: number): Record<string, unknown> {
    const stamped: Record<string, unknown> = { [STATE_KEY]: index }
    if (currentRun !== LEGACY_RUN && currentRun !== null) stamped[RUN_KEY] = currentRun
    return stamped
  }

  function pushUrl(path: string): void {
    currentIndex = indexForPush()
    env.pushState(freshStamp(currentIndex), path)
  }

  function replaceUrl(path: string): void {
    // A replace swaps the entry in place, so it keeps THAT entry's index.
    currentIndex = indexForReplace()
    // The one re-stamp that legitimately carries a path: this navigation is
    // changing the URL as well as the entry's state.
    env.replaceState(stampCurrent(currentIndex), path)
  }

  /**
   * Set location.hash, arming the echo `hashchange` it is about to produce —
   * every one of our own writes is echoed, and every caller suppressed it, so
   * there is no second behaviour to select. Returns whether the URL actually
   * changed: a same-hash write is a no-op the browser reports nothing for, so
   * nothing may be armed or counted for it.
   */
  function setHash(newHash: string): boolean {
    if (sameHash(env.hash, newHash)) return false
    // Resolve the position (and the run) of the entry we are LEAVING before the
    // write replaces it.
    const next = indexForPush()
    armEcho(newHash)
    env.setHash(newHash)
    // The fragment navigation created its entry SYNCHRONOUSLY (only the
    // `hashchange` EVENT is queued), so stamp it now: setting the hash
    // cannot carry state itself, and the blocked-back restore needs an index on
    // every entry to compute a `history.go` delta from.
    currentIndex = next
    // A fresh fragment entry carries no state, so this merges with nothing —
    // but every re-stamp in this file goes through `stampCurrent`, with no
    // exception for a reader to re-verify.
    //
    // No path: re-stamping the entry the hash write just created. A `''` here
    // would resolve against the document base and throw the fragment away —
    // i.e. undo the navigation on the line above.
    env.replaceState(stampCurrent(currentIndex))
    return true
  }
  /**
   * Run guards for a navigation to `newRoute`. `redirected` is reported
   * explicitly rather than inferred by comparing routes: a guard may return a
   * structurally equal object, and `push`/`replace` need to know whether the
   * URL they are about to write is the one their caller actually asked for.
   */
  function runGuards(newRoute: R): GuardOutcome<R> {
    if (options?.beforeLeave && currentRoute !== null) {
      if (!options.beforeLeave(currentRoute, newRoute)) return { blocked: true }
    }
    if (options?.beforeEnter) {
      const result = options.beforeEnter(newRoute, currentRoute)
      if (result === false) return { blocked: true }
      // Any non-`false`, non-nullish return is a redirect Route. Routes are
      // generic `R` and may be primitives (e.g. a string-union route), so
      // gate on nullishness, NOT `typeof === 'object'` — the latter silently
      // dropped string/number redirects and let navigation proceed to the
      // original target (an auth-guard bypass).
      if (result !== undefined && result !== null) {
        return { blocked: false, route: result as R, redirected: true }
      }
    }
    return { blocked: false, route: newRoute, redirected: false }
  }

  /**
   * Consume one queued echo if this `hashchange` is ours. The queue is only
   * trusted while the URL is still where our last write left it: when it is
   * not, a write we armed never landed and the event in hand is a GENUINE
   * navigation, which must dispatch rather than be swallowed. That check is
   * what keeps a stale entry from eating real events indefinitely — the failure
   * mode the old boolean had (#103/#108).
   */
  function consumeHashEcho(): boolean {
    if (pendingEchoCount === 0) return false
    if (pendingEchoHash === null || !sameHash(env.hash, pendingEchoHash)) {
      pendingEchoCount = 0
      pendingEchoHash = null
      return false
    }
    pendingEchoCount--
    if (pendingEchoCount === 0) pendingEchoHash = null
    return true
  }

  /**
   * Consume the popstate our own restoring `history.go` produced. Cleared
   * unconditionally: the traversal may land somewhere else entirely (or never
   * fire), and an armed flag that outlives its restore swallows the next
   * genuine popstate (#103).
   */
  function consumePopstateRestore(): boolean {
    if (pendingRestoreIndex === null) return false
    const expected = pendingRestoreIndex
    const expectedRun = pendingRestoreRun
    pendingRestoreIndex = null
    pendingRestoreRun = null
    // The RUN is half of the identity: the same index in another run is a
    // different entry, so matching on the number alone would swallow a genuine
    // popstate onto it and adopt a position we are not standing at.
    if (readIndex(env.historyState) !== expected) return false
    if (readRun(env.historyState) !== expectedRun) return false
    currentIndex = expected
    currentRun = expectedRun
    return true
  }

  /**
   * Resync `currentIndex` to the entry a browser-driven navigation landed on.
   *
   * An entry WE stamped carries its own position, so adopt it. An entry nobody
   * stamped has NO knowable position, in EITHER mode, and none is guessed: a
   * guessed index is exactly what turns the next blocked back into a
   * wrong-direction `history.go` (#103).
   *
   * DESIGN DECISION (#150): every unstamped entry is UNKNOWN — one rule, both
   * modes.
   *
   * History mode never had a choice: `popstate` is always a traversal. Hash mode
   * looks like it does, because `hashchange` also fires for a NEW fragment
   * navigation (the user editing the address bar), which the router COULD number
   * — but nothing in the platform distinguishes the two events, and every
   * candidate discriminator this file tried is unsound:
   *
   * - `history.length > knownLength` (the previous implementation, #139): a push
   *   grows the session history and a traversal does not, so a cached length
   *   answers it — but ONLY while the cache is fresh, and it is refreshed solely
   *   where the ROUTER observes or changes history. Growth it never sees — a
   *   foreign `history.pushState` from analytics, an embedded widget or another
   *   framework, or an IFRAME navigation, which does grow the joint session
   *   history — leaves it stale-LOW, so a later traversal onto an unstamped
   *   entry reads as a PUSH and is stamped with an INVERTED index (the entry
   *   BELOW gets a HIGHER number). The staleness is sticky, because a traversal
   *   passing through stamped entries returns early here and never repairs it.
   *   The next guard-blocked back then computes its delta from that fiction and
   *   traverses TWO entries backwards — #103's exact failure, reintroduced.
   * - `popstate` fires only on a traversal while `hashchange` fires on both.
   *   Assigning `location.hash` fires `["popstate", "hashchange"]` — the same
   *   pair, in the same order, as `history.back()` — and `pushState` fires
   *   neither. The `location.hash` half is reproduced in jsdom by this package's
   *   own tests; the comparison against `history.back()` is from the #150
   *   research pass's measurement in Chromium 143 and is NOT reproducible here
   *   (jsdom's `back()` is asynchronous, so a short probe sees nothing). Either
   *   way the events carry no discriminating information; do not propose it
   *   again.
   *
   * THE COST, stated plainly: a hand-edited hash entry ENDS the run its
   * neighbours were numbered in (see `standingIndex`), so a guard-blocked
   * traversal ONTO it, or ACROSS it, is not undone — the URL is left showing the
   * route the guard refused, nothing is dispatched, and `state.route` keeps the
   * route you never left. Two shapes, both leaving the stack untouched:
   *
   * - a block onto the hand-edited entry itself — its position is unknown;
   * - a block onto an entry BELOW it from one pushed above it (e.g. a
   *   `history.go(-2)` off a back-button menu) — both positions are known, but
   *   they are numbered in different runs, so their difference is not a distance.
   *
   * It is the same guard-honouring-but-not-undoable outcome an entry pre-dating
   * `connectRouter` already had, and it is documented in
   * `site/content/api/router.md`. The hand edit ITSELF is unaffected in both
   * shapes: this runs only when the guard PASSES.
   *
   * WHAT IS NOT COVERED, because no `history.state` scheme can be: an IFRAME
   * navigation grows the JOINT session history without moving the top-level
   * document, so the entry it adds is invisible to every stamp above and below
   * it and even a `delta` of 1 can under-count. Runs make a gap the router can
   * OBSERVE (it stood on the entry that opened it) incomparable; they cannot see
   * a gap in a nested browsing context.
   *
   * FUTURE WORK, not implemented here: the Navigation API's
   * `navigation.currentEntry.index` is an authoritative position and was
   * measured in real Chromium to track fragment navigations, traversals AND a
   * foreign `pushState` correctly while `history.length` drifted — and it is
   * indexed against the whole stack, so it answers the iframe case too. It is
   * unavailable in jsdom, so neither branch of a classifier built on it could be
   * mutation-pinned in this package's test environment — which is why this
   * closes as a policy change rather than a new discriminator.
   */
  function adoptLandedEntry(): void {
    const landed = readIndex(env.historyState)
    currentIndex = landed
    // A position with no run is not a position: the run is what makes the next
    // delta subtractable, so the two are adopted and forgotten together.
    currentRun = landed === null ? null : readRun(env.historyState)
  }

  /**
   * Rewrite the URL of the entry a browser-driven navigation just LANDED on,
   * so a guard REDIRECT reaches the address bar as well as `state.route`
   * (#143). Called only from the listener, only for a redirect, and only after
   * `adoptLandedEntry` has resynced the position.
   *
   * DESIGN CHOICE (#143): replace the landed entry — never `go` + push.
   *
   * A replace neither grows the stack nor truncates it, so `history.length` and
   * every forward entry survive exactly as they do for a blocked navigation —
   * the property #103 exists to protect. The redirect target simply TAKES THE
   * PLACE of the route the user tried to reach: back still reaches the entry
   * below it, forward still reaches everything above it, and the target itself
   * stays reachable from either side. What stops being reachable is the guarded
   * route at that slot, which is the point — returning to it would only redirect
   * again, and leaving it there is the desync this issue is about.
   *
   * `go` + push was the alternative. It is rejected twice over: `history.go` is
   * ASYNCHRONOUS, so the push would have to be sequenced on a later popstate —
   * the exact hazard `restoreBlocked` and `standingIndex` document — and a push
   * from the rewound position TRUNCATES every forward entry, turning an auth
   * redirect into the stack corruption #103 fixed.
   *
   * The entry does not move, so it keeps the index `adoptLandedEntry` just read.
   * An UNKNOWN position stays unknown: the URL is still written (that is the
   * fix), but no index is invented for it — a guessed stamp is what turns a
   * later blocked back into a wrong-direction `history.go` (#103).
   *
   * In HASH mode this is `replaceState` with a fragment-only url, NOT
   * `location.replace` (what the hash `replace()` effect uses). Two reasons:
   * `replaceState` fires neither `hashchange` nor `popstate` — the HTML spec's
   * URL-and-history update steps fire no event at all, so there is no echo, and
   * ARMING one for an event that never arrives would leave a suppression
   * pending that swallows a later genuine hashchange onto the same hash —
   * and `location.replace` DROPS the entry's state, which would take the stamp
   * this path depends on with it.
   */
  function rewriteLandedUrl(path: string): void {
    env.replaceState(currentIndex === null ? env.historyState : stampCurrent(currentIndex), path)
  }

  /**
   * Undo a browser-driven navigation a guard blocked, leaving the stack exactly
   * as it was: a TRAVERSAL back to the entry we were on, never a fresh push.
   */
  function restoreBlocked(): void {
    if (currentRoute === null) return
    const landed = readIndex(env.historyState)
    // Both positions must be known for a delta to mean anything. When either is
    // not, do NOTHING: no `history.go` with a guessed delta, and above all
    // nothing armed for a restore that will not happen (#103).
    if (currentIndex === null || currentRun === null || landed === null) return
    // …and they must be numbered in the SAME run, or their difference is not a
    // distance. `delta` is of any magnitude — browsers deliver multi-entry
    // traversals (a back-button long-press menu, `history.go(-n)`) — so a run
    // boundary anywhere between the two entries makes it under- or over-count by
    // however many entries the router could not number. Refusing leaves the URL
    // on the blocked route, which is the same known, documented outcome as an
    // unstamped landing; guessing traverses to the wrong entry and dispatches a
    // route the user never asked for (#150 review).
    if (readRun(env.historyState) !== currentRun) return
    const delta = currentIndex - landed
    if (delta === 0) return
    if (router.mode === 'hash') {
      // `location.hash = restore` cannot be the mechanism — assigning the hash
      // PUSHES, which grows history.length on every block and truncates every
      // forward entry above the blocked one (#103). The traversal echoes a
      // hashchange, which is suppressed like any of our own writes.
      armEcho(router.href(currentRoute))
      env.go(delta)
      return
    }
    pendingRestoreIndex = currentIndex
    pendingRestoreRun = currentRun
    env.go(delta)
  }

  // The route to run guards/dispatch against: the caller's ORIGINAL object (all
  // fields intact) when the effect carries one, else the URL re-matched (for a
  // hand-constructed effect with only `path`). Using `match(path)` unconditionally
  // would drop any route field not representable in the URL before the guards ever
  // saw it (finding: non-URL field drop).
  function targetRoute(effect: RouterEffect): R {
    return effect.route !== undefined ? (effect.route as R) : router.match(effect.path!)
  }

  function applyEffect(effect: RouterEffect, send: (msg: unknown) => void): void {
    switch (effect.action) {
      case 'push':
      case 'replace': {
        // URL only. In hash mode, suppress the echo hashchange so the listener
        // does not ALSO dispatch a navigate (finding 2b).
        const outcome = runGuards(targetRoute(effect))
        if (outcome.blocked) return
        const finalPath = router.href(outcome.route)
        if (router.mode === 'hash') {
          if (effect.action === 'push') {
            setHash(finalPath)
          } else if (!sameHash(env.hash, finalPath)) {
            // `location.replace` swaps the current entry and DROPS its state —
            // INCLUDING whatever the host app or another library owns on it, so
            // snapshot it here and put it back with the stamp. This is the one
            // re-stamp that cannot use `stampCurrent`: by the time it runs the
            // state it should have merged is already gone.
            currentIndex = indexForReplace()
            const carried = stampCurrent(currentIndex)
            armEcho(finalPath)
            env.replaceLocation(finalPath)
            // The index is unchanged — nothing was pushed. No path: the URL is
            // already where `replaceLocation` just put it, and a `''` here
            // would resolve it away.
            env.replaceState(carried)
          }
        } else if (effect.action === 'push') {
          pushUrl(finalPath)
        } else {
          replaceUrl(finalPath)
        }
        currentRoute = outcome.route
        // A guard REDIRECT wrote a URL the caller never asked for. push/replace
        // are URL-only by contract — the caller's reducer already set
        // `state.route` — but it set it to the REQUESTED route, so staying
        // silent leaves `state.route` and the URL disagreeing permanently
        // (#110). Only a redirect dispatches; the plain case keeps the
        // documented URL-only contract.
        if (outcome.redirected) send(navigateMsg(outcome.route))
        break
      }
      case 'navigate': {
        // pushState semantics + dispatch the route-change message so the
        // app reducer sees the change. The asymmetry fix: link() always did
        // push+send because click handlers run in view code with send in
        // scope, while push() as an effect could only do push. navigate()
        // resolves it by dispatching through the `send` the effect runner
        // already hands every effect — so it works from ANY effect (an
        // init() effect included), with no dependency on listener() having
        // mounted first.
        //
        // In hash mode we dispatch here AND suppress the echo hashchange, so
        // the listener does not double-dispatch the same message (finding 2a).
        const outcome = runGuards(targetRoute(effect))
        if (outcome.blocked) return
        const finalPath = router.href(outcome.route)
        if (router.mode === 'hash') {
          setHash(finalPath)
        } else {
          pushUrl(finalPath)
        }
        currentRoute = outcome.route
        send(navigateMsg(outcome.route))
        break
      }
      case 'back':
        env.back()
        break
      case 'forward':
        env.forward()
        break
      case 'scroll':
        env.scrollTo(effect.x!, effect.y!)
        break
    }
  }

  return {
    push(route) {
      return { type: '__router', action: 'push', path: router.href(route), route }
    },
    replace(route) {
      return { type: '__router', action: 'replace', path: router.href(route), route }
    },
    navigate(route) {
      return { type: '__router', action: 'navigate', path: router.href(route), route }
    },
    back() {
      return { type: '__router', action: 'back' }
    },
    forward() {
      return { type: '__router', action: 'forward' }
    },
    scroll(x, y) {
      return { type: '__router', action: 'scroll', x, y }
    },

    handleEffect({ effect, send }) {
      if (effect.type !== '__router') return false
      applyEffect(effect as RouterEffect, send as (msg: unknown) => void)
      return true
    },

    listener<M>(send: (msg: M) => void, msgFactory?: (route: R) => M): Renderable {
      const factory = msgFactory ?? (navigateMsg as (route: R) => M)
      // Place the onMount marker in the view; its callback registers the URL
      // listener on mount. (onMount is a lazy Mountable — calling it for side
      // effect and discarding the return would never register.) The listener
      // dispatches via its own captured `send` for browser-driven URL changes
      // (popstate/hashchange); the navigate() effect no longer depends on it.
      return [
        onMount(() => {
          const event = router.mode === 'hash' ? 'hashchange' : 'popstate'
          const handler = () => {
            // Swallow the echo event our own URL mutation triggered — it was
            // already dispatched (navigate) or is URL-only (push/replace).
            if (router.mode === 'hash') {
              if (consumeHashEcho()) return
            } else if (consumePopstateRestore()) {
              return
            }

            const outcome = runGuards(router.match(currentInput()))
            if (outcome.blocked) {
              restoreBlocked()
              return
            }
            adoptLandedEntry()
            // A guard REDIRECT means the route we are about to dispatch is NOT
            // the one the browser navigated to, so the URL has to follow it —
            // otherwise `state.route` says `/login` while the address bar (and
            // therefore a reload, a share or a bookmark) still says `/admin`
            // (#143). The URL is written BEFORE the dispatch so the reducer and
            // any effect it emits already read the final URL.
            if (outcome.redirected) rewriteLandedUrl(router.href(outcome.route))
            currentRoute = outcome.route
            send(factory(outcome.route))
          }
          // The env hands back its own unsubscribe, so the mount teardown never
          // has to name the target it registered on.
          return env.onUrlChange(event, handler)
        }),
      ]
    },

    link<M>(
      send: (msg: M) => void,
      route: R,
      attrs: Record<string, unknown>,
      children: readonly ChildNode[],
      msgFactory?: (route: R) => M,
    ): Mountable {
      const factory = msgFactory ?? (navigateMsg as (route: R) => M)
      return a(
        {
          ...attrs,
          href: router.href(route),
          onClick: (e: Event) => {
            const me = e as MouseEvent
            // Respect a handler that already handled the event.
            if (e.defaultPrevented) return
            if (me.ctrlKey || me.metaKey || me.shiftKey || me.altKey || me.button !== 0) return
            // Respect an anchor target that opens elsewhere (_blank, a named
            // frame, …) — let the browser handle it natively.
            const anchor = e.currentTarget as HTMLAnchorElement | null
            const target = anchor?.target
            if (target && target !== '' && target !== '_self') return
            // `download` means the href is a FILE the browser must save, not a
            // route to navigate to. Intercepting it cancels the download and
            // navigates instead, so the file never arrives (#109). The bare
            // attribute is valid and carries no value, so test for its
            // PRESENCE, never for a truthy value.
            if (anchor?.hasAttribute('download')) return
            e.preventDefault()
            // BOTH modes run the same pipeline as the navigate() effect —
            // guards → block/redirect/allow → URL write + send + currentRoute —
            // so auth / unsaved-changes guards are never silently skipped
            // (finding 1). Hash mode used to write the hash and leave the rest
            // to the listener, which made a link INERT without a mounted
            // listener() (zero dispatches, ever, and no guards at click time)
            // and made a click on the CURRENT route a dead one: preventDefault
            // ran, `setHash` bailed on the identical hash, and nothing followed
            // (#110). A click on the current route is a request to re-enter it,
            // so it dispatches; only the redundant URL write is skipped.
            const outcome = runGuards(route)
            if (outcome.blocked) return
            const finalPath = router.href(outcome.route)
            if (router.mode === 'hash') setHash(finalPath)
            else pushUrl(finalPath)
            currentRoute = outcome.route
            send(factory(outcome.route))
          },
        },
        children,
      )
    },

    createHandler<S, M, E>(config: {
      message?: string
      getRoute: (msg: M) => R
      guard?: (route: R, state: S) => R
      onNavigate: (state: S, route: R) => [S, E[]]
    }): (state: S, msg: M) => [S, E[]] | null {
      const msgType = config.message ?? 'navigate'
      return (state: S, msg: M) => {
        if ((msg as Record<string, unknown>).type !== msgType) return null
        let route = config.getRoute(msg)
        if (config.guard) route = config.guard(route, state)
        return config.onNavigate(state, route)
      }
    },
  }
}
