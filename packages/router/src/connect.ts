import type {
  RouteDestination,
  RouteDestinationArguments,
  RouteGenerationParams,
  RouteLocation,
  RouteRegistry,
  Router,
} from './index.js'
import { a, onMount } from '@llui/dom'
import type { Mountable, Renderable, ChildNode } from '@llui/dom'

// ── Router Effects ───────────────────────────────────────────────

export interface RouterEffect {
  type: '__router'
  action: 'push' | 'replace' | 'navigate' | 'back' | 'forward' | 'scroll'
  path?: string
  /** The normalized route location targeted by this effect. */
  location?: unknown
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
   * caller never has to hold the handler identity to detach it. A hashchange
   * supplies the fragment from the event's `newURL`; this remains the traversal
   * destination even when a guard synchronously rewrites `location.hash` while
   * handling the preceding popstate. Call the handler without an argument for
   * popstate. Custom adapters must derive the hash argument from
   * `HashChangeEvent.newURL`, not from the live location.
   */
  onUrlChange(event: 'popstate' | 'hashchange', handler: (newHash?: string) => void): () => void
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
    pushState: (state, url) => history.pushState(state, '', url),
    // `null` rather than a forwarded `undefined`: both mean "leave the URL
    // alone" to `history.replaceState`, but only one says so on purpose.
    replaceState: (state, url) => history.replaceState(state, '', url ?? null),
    back: () => history.back(),
    forward: () => history.forward(),
    go: (delta) => history.go(delta),
    scrollTo: (x, y) => window.scrollTo(x, y),
    onUrlChange: (event, handler) => {
      const listener = (browserEvent: Event) => {
        if (event !== 'hashchange') {
          handler()
          return
        }
        const newUrl = (browserEvent as HashChangeEvent).newURL
        handler(newUrl === '' ? undefined : new URL(newUrl).hash)
      }
      window.addEventListener(event, listener)
      return () => {
        window.removeEventListener(event, listener)
      }
    },
  }
}

export interface RouterNavigateMessage<Registry extends RouteRegistry> {
  readonly type: 'navigate'
  readonly location: RouteLocation<Registry>
}

export interface RouterUnmatchedMessage {
  readonly type: 'unmatched'
  readonly url: string
}

export type RouterMessage<Registry extends RouteRegistry> =
  | RouterNavigateMessage<Registry>
  | RouterUnmatchedMessage

export interface ConnectOptions<
  Registry extends RouteRegistry,
  NavigateMessage = RouterNavigateMessage<Registry>,
  UnmatchedMessage = RouterUnmatchedMessage,
> {
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
   * - a different route location → redirect to that location
   *
   * A redirect CHAINS: the target is offered back to this same function until it
   * is accepted, blocked, or stops moving the URL (capped at 10 hops — see
   * `runGuards`). So this may be called several times for one navigation, and
   * only the settled route is dispatched. `from` is the route being LEFT on
   * every hop — no hop is entered.
   */
  beforeEnter?: (
    to: RouteLocation<Registry>,
    from: RouteLocation<Registry> | null,
  ) => RouteLocation<Registry> | false | void
  /**
   * Called before leaving the current route. Return:
   * - `true` → allow navigation
   * - `false` → block (e.g. unsaved changes prompt)
   *
   * Called ONCE per navigation, before any `beforeEnter`, with the route
   * originally REQUESTED as `to` — a redirect chain must not prompt N times.
   */
  beforeLeave?: (from: RouteLocation<Registry>, to: RouteLocation<Registry>) => boolean

  /**
   * Build the message dispatched by the `navigate()` effect (and the
   * popstate/hashchange listener and `link()`) when the route changes.
   * Defaults to `{ type: 'navigate', location }`. Override only if your app
   * uses a different message shape for route changes; the same factory then
   * applies to every route-change dispatch so they stay consistent.
   */
  navigateMsg?: (location: RouteLocation<Registry>) => NavigateMessage
  /** Build the message dispatched for a browser-driven unmatched URL. */
  unmatchedMsg?: (url: string) => UnmatchedMessage
}

type LinkArguments<Registry extends RouteRegistry, M> =
  RouteDestination<Registry> extends infer D
    ? D extends readonly unknown[]
      ? [
          ...destination: D,
          attrs: Record<string, unknown>,
          children: readonly ChildNode[],
          msgFactory?: (location: RouteLocation<Registry>) => M,
        ]
      : never
    : never

type ExactLinkArguments<
  Registry extends RouteRegistry,
  Name extends keyof Registry & string,
  Params extends RouteGenerationParams<Registry, Name>,
  M,
> = [
  ...destination: RouteDestinationArguments<Registry, Name, Params>,
  attrs: Record<string, unknown>,
  children: readonly ChildNode[],
  msgFactory?: (location: RouteLocation<Registry>) => M,
]

export interface ConnectedRouter<
  Registry extends RouteRegistry,
  NavigateMessage = RouterNavigateMessage<Registry>,
  UnmatchedMessage = RouterUnmatchedMessage,
> {
  /**
   * Effect: push a new history entry — URL only.
   *
   * Use when the reducer that emitted the effect has already updated its
   * current location (e.g. a navigate handler that bundles
   * state changes inline before delegating URL work). For
   * navigate-and-let-the-app-react flows from anywhere else, prefer
   * `navigate()` — it dispatches the listener-captured navigate
   * message after pushState so application location and route-side-effects
   * stay in sync without each reducer re-implementing the delegation.
   */
  push<
    const Name extends keyof Registry & string,
    const Params extends RouteGenerationParams<Registry, Name> = RouteGenerationParams<
      Registry,
      Name
    >,
  >(
    name: Name,
    ...args: RouteDestinationArguments<Registry, Name, Params>
  ): RouterEffect
  /**
   * Effect: replace the current history entry — URL only. Same
   * URL-only contract as `push()`. For replace-and-react flows, see
   * `navigate()` (push semantics) — there's no `replaceAndDispatch`
   * variant yet because the use case hasn't surfaced; if it does,
   * model it the same way.
   */
  replace<
    const Name extends keyof Registry & string,
    const Params extends RouteGenerationParams<Registry, Name> = RouteGenerationParams<
      Registry,
      Name
    >,
  >(
    name: Name,
    ...args: RouteDestinationArguments<Registry, Name, Params>
  ): RouterEffect
  /**
   * Effect: push history AND dispatch the listener-captured navigate
   * message so the reducer can update its current location and run any
   * route-side-effects (data fetches, page-meta resets, analytics).
   *
   * Resolves the asymmetry where `link()` did pushState + send while
   * `push()` did pushState only — apps that wanted programmatic
   * navigation from arbitrary reducers had to either re-implement the
   * delegation or live with desynchronized application location.
   *
   * Dispatches through the `send` the effect runner hands every effect,
   * so it works from ANY effect — including an `init()` effect that runs
   * before any view mounts. It does NOT depend on `listener()` being
   * mounted (that only handles browser-driven popstate/hashchange).
   * The message shape is `{ type: 'navigate', location }` unless overridden
   * via `connectRouter`'s `navigateMsg` option.
   */
  navigate<
    const Name extends keyof Registry & string,
    const Params extends RouteGenerationParams<Registry, Name> = RouteGenerationParams<
      Registry,
      Name
    >,
  >(
    name: Name,
    ...args: RouteDestinationArguments<Registry, Name, Params>
  ): RouterEffect
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
   * Returns the onMount marker to place in the view. Sends
   * `{ type: 'navigate', location }` or `{ type: 'unmatched', url }`.
   */
  listener(send: (msg: NavigateMessage | UnmatchedMessage) => void): Renderable
  listener<M>(
    send: (msg: M | UnmatchedMessage) => void,
    msgFactory: (location: RouteLocation<Registry>) => M,
  ): Renderable
  listener<M, U>(
    send: (msg: M | U) => void,
    msgFactory: (location: RouteLocation<Registry>) => M,
    unmatchedFactory: (url: string) => U,
  ): Renderable

  /**
   * View helper: render a navigation link.
   * Generates <a> with proper href and click handler that sends navigate message.
   */
  link<
    M,
    const Name extends keyof Registry & string,
    const Params extends RouteGenerationParams<Registry, Name> = RouteGenerationParams<
      Registry,
      Name
    >,
  >(
    send: (msg: M) => void,
    name: Name,
    ...args: ExactLinkArguments<Registry, Name, Params, M>
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
    getLocation: (msg: M) => RouteLocation<Registry>
    /** Optional guard — can redirect */
    guard?: (location: RouteLocation<Registry>, state: S) => RouteLocation<Registry>
    /** Build new state + effects for the route */
    onNavigate: (state: S, location: RouteLocation<Registry>) => [S, E[]]
  }): (state: S, msg: M) => [S, E[]] | null
}

/** history.state key holding our monotonic navigation index. */
const STATE_KEY = '__llui_idx'

/**
 * history.state key holding the RUN an entry's index was numbered in.
 *
 * An index is only ever comparable to another index from the SAME run — see
 * `mintRun` for what a run is and why the id has to live on the entry rather
 * than in a variable, and `readPosition` for why an entry carrying an index
 * WITHOUT one of these is not a position at all.
 */
const RUN_KEY = '__llui_run'

/**
 * A fresh run id.
 *
 * It has to be unpredictable rather than counted. A counter restarts at the same
 * value on every page load while the ids it issued LAST load are still sitting
 * on entries in the same session history, so `run-1` would name two unrelated
 * runs and a delta could be computed straight across the gap between them. The
 * only operation performed on the id is equality, so ~50 bits of entropy is
 * ample and the value is never parsed.
 *
 * The empty string is retried rather than returned. `Math.random()` may return
 * exactly `0` (p ≈ 2⁻⁵³), whose base-36 rendering is `'0'` and whose `.slice(2)`
 * is `''` — and {@link readPosition} treats an empty run as no run at all, so
 * minting one would silently make the entry it stamped incomparable with the
 * next one. The loop terminates with probability 1 and, in 300k mints measured,
 * never ran twice.
 */
function mintRun(): string {
  let id = ''
  while (id === '') id = Math.random().toString(36).slice(2)
  return id
}

/** The outcome of the guard pipeline for one navigation. */
type GuardOutcome<Location> =
  | { blocked: true }
  | { blocked: false; location: Location; redirected: boolean }

/**
 * How many times `beforeEnter` may redirect within ONE navigation before the
 * chain is declared non-terminating (#161).
 *
 * Only a chain that keeps MOVING the URL counts against it: the loop settles the
 * moment a hop addresses the URL the previous one already did, so an idempotent
 * guard — one that normalises `to` and hands back an equivalent route — stops on
 * hop one and never approaches the cap. Reaching it means a genuine cycle
 * (`a → b → a → …`), which is an app bug.
 */
const MAX_REDIRECT_HOPS = 10

/**
 * A position this router can measure a delta against: an index AND the run it
 * was numbered in. Never one without the other — see {@link readPosition}.
 */
type Position = { index: number; run: string }

/**
 * The position stamped on a history entry, or `null` when the entry carries
 * none this router can use.
 *
 * BOTH halves are required, and an index without a run is NOT a position (#150
 * review). It is tempting to read an absent `__llui_run` as one distinguished
 * "legacy" run, on the theory that a build predating the key numbered its
 * entries consecutively so its numbering can be adopted and continued. That
 * premise is FALSE for the builds that exist: `origin/fix/router-143`, the #139
 * build and this PR's own revision `3d3e0ca7` all RESTART their numbering across
 * an entry they could not place, and none of them record that they did. So an
 * absent key does not name one run — it names every run every prior build ever
 * opened, collapsed into a single comparable id, which is precisely the
 * degenerate counter {@link mintRun} exists to rule out. Both failures were
 * measured and are pinned in `test/legacy-stamps.test.ts`:
 *
 * - hash mode, a legacy stack whose numbering restarted across a hand edit — a
 *   blocked `history.go(-4)` answered with a router-issued `go(2)` that landed
 *   the user on the hand-edited entry;
 * - history mode, no hand edit needed — the stack `origin/fix/router-143`
 *   ITSELF produces around a foreign `pushState` (`/`{0} | `/tracker` foreign |
 *   `/admin`{1}, one index across two physical entries): a blocked
 *   `history.go(-2)` answered with `go(1)`, depositing the user on the analytics
 *   entry with nothing dispatched, so application location desynchronized too.
 *
 * The cost of refusing is a lost undo for a stack an older build numbered, for
 * the length of a deploy window — the same known, documented outcome as an entry
 * with no stamp at all, and the safe direction this whole mechanism argues for:
 * a lost undo rather than a wrong traversal.
 *
 * An empty run id reads as no run for the same reason it is never minted: it is
 * the value a foreign writer is likeliest to produce by accident, and treating
 * it as an id would make two unrelated writers' entries subtractable.
 */
function readPosition(state: unknown): Position | null {
  if (state === null || typeof state !== 'object') return null
  const index = (state as Record<string, unknown>)[STATE_KEY]
  const run = (state as Record<string, unknown>)[RUN_KEY]
  if (typeof index !== 'number' || typeof run !== 'string' || run === '') return null
  return { index, run }
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
 * guard-honouring but NOT undoable: nothing is dispatched and application location
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
export function connectRouter<
  const Registry extends RouteRegistry,
  NavigateMessage = RouterNavigateMessage<Registry>,
  UnmatchedMessage = RouterUnmatchedMessage,
>(
  router: Router<Registry>,
  options?: ConnectOptions<Registry, NavigateMessage, UnmatchedMessage>,
): ConnectedRouter<Registry, NavigateMessage, UnmatchedMessage> {
  type Location = RouteLocation<Registry>
  // The canonical route-change message factory. Used by the navigate()
  // effect, the popstate/hashchange listener, and link() so every
  // route-change dispatch produces the same message shape.
  const navigateMsg =
    options?.navigateMsg ??
    ((location: Location): RouterNavigateMessage<Registry> => ({ type: 'navigate', location }))
  const unmatchedMsg =
    options?.unmatchedMsg ?? ((url: string): RouterUnmatchedMessage => ({ type: 'unmatched', url }))

  // Every history/location touch below goes through this. Never reach for
  // `location`/`history`/`window` directly here (#111).
  const env = options?.env ?? browserRouterEnv()

  // Seed currentLocation from the browser location so the first navigation's
  // guards see the actual starting route as `from` (not null) and a
  // blocked navigation can restore the real starting URL. With no location the
  // env reads as `''`, which either matches the root route or remains unmatched.
  function currentInput(): string {
    return router.mode === 'hash' ? env.hash : env.pathname + env.search
  }

  /**
   * Is `path` the URL that is ALREADY showing? The one same-URL predicate in
   * this file (#162).
   *
   * It is not a single string equality, because the two modes address different
   * parts of the URL: hash mode compares FRAGMENTS through {@link sameHash}
   * (`''` and `'#/'` are the same place), history mode compares the path+query
   * projection {@link currentInput} already matches routes against — the same
   * string `router.href` produces in that mode.
   *
   * The two `replaceState` writers — the `replace()` effect and
   * {@link rewriteLandedUrl} — ask it before writing. Their write fires no
   * event, so a redundant one is invisible rather than harmful; they skip it
   * because a reader who has learned the rule from {@link setHash} will assume
   * it holds everywhere, and it now does.
   *
   * {@link setHash} is NOT one of its callers, deliberately: its guard MUST hold
   * (see there) and what it asks about is the fragment unconditionally, so it
   * calls {@link sameHash} directly rather than depending on a mode test made
   * here.
   */
  function sameUrl(path: string): boolean {
    return router.mode === 'hash' ? sameHash(env.hash, path) : currentInput() === path
  }

  let currentLocation: Location | null = (() => {
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
   *
   * It takes the whole {@link Position}, never a bare index off `currentIndex`
   * with the run read out of scope: an index and the run it was numbered in are
   * one fact, and a stamp missing either half is not a position `readPosition`
   * will hand back. Passing the pair is what makes writing an index without a
   * run unrepresentable rather than merely unreachable.
   */
  function stampCurrent(pos: Position): Record<string, unknown> {
    const existing = env.historyState
    const base =
      existing !== null && typeof existing === 'object' ? (existing as Record<string, unknown>) : {}
    return { ...base, [STATE_KEY]: pos.index, [RUN_KEY]: pos.run }
  }

  // Our position in the session history stack. The browser exposes no such
  // counter, so it is carried in `history.state` on every entry we create and
  // is what a blocked navigation's `history.go(delta)` restore is computed
  // from. `null` means UNKNOWN — we are sitting on an entry nobody stamped, so
  // no delta can be derived and none may be guessed.
  let currentIndex: number | null = null
  // The run `currentIndex` is numbered in, `null` exactly when `currentIndex`
  // is. Two indices are only comparable within one run (see the POSITION MODEL
  // above and `standing`).
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
    const seeded = readPosition(env.historyState)
    if (seeded !== null) {
      // An entry we (or a previous lifetime of this connector, across a reload)
      // already stamped: adopt its position AND its run, so the numbering
      // continues the one the entries below it belong to.
      currentIndex = seeded.index
      currentRun = seeded.run
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
      //
      // An entry carrying an index but NO run takes this branch too, and is
      // re-stamped rather than adopted: a build that predates the run key
      // restarted its numbering across entries it could not place and recorded
      // nothing about it, so its indices are not a numbering this one can
      // continue (`readPosition`). Host keys already on the entry survive —
      // `stampCurrent` merges — and the stale index is overwritten rather than
      // left beside a fresh run id that would make it look measurable.
      const run = mintRun()
      currentRun = run
      currentIndex = 0
      // No path: this re-stamps the entry we are ALREADY on. Passing `''` here
      // resolves against the document base and drops the fragment, silently
      // breaking hash mode (see `RouterEnv.replaceState`).
      env.replaceState(stampCurrent({ index: 0, run }))
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
  // The POSITION a blocked navigation's `history.go` is restoring to, or `null`.
  // Keyed on the destination rather than a bare flag: `history.go` is
  // asynchronous and a delta it cannot reach fires nothing at all, so a flag
  // stays armed and swallows the next genuine popstate (#103). Index and run
  // travel together, because the same index in another run is another entry.
  let pendingRestore: Position | null = null

  /**
   * The index of the entry we are physically STANDING on, together with the RUN
   * the caller is about to number in — the index is `null` when that entry has
   * no knowable position, which OPENS a new run. The run is always a real id, so
   * a caller only has to decide what index to write.
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
   * "Unstamped" here means `readPosition` returned `null`, which includes an
   * entry carrying an index but no run — a stamp an older build wrote. Its
   * numbering is not this one's to continue, so it opens a run like any other
   * position we cannot measure.
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
  function standing(): { index: number | null; run: string } {
    const landed = readPosition(env.historyState)
    if (landed !== null) return { index: landed.index, run: landed.run }
    return { index: null, run: mintRun() }
  }

  /** The stamp for an entry we are about to CREATE above the one we stand on. */
  function pushStamp(): Position {
    const from = standing()
    return { index: from.index === null ? 0 : from.index + 1, run: from.run }
  }

  /** The stamp for an entry we are about to REPLACE in place. */
  function replaceStamp(): Position {
    const from = standing()
    return { index: from.index ?? 0, run: from.run }
  }

  /** Adopt a stamp we are about to write as our own standing position. */
  function stand(pos: Position): Position {
    currentIndex = pos.index
    currentRun = pos.run
    return pos
  }

  /**
   * The `history.state` for an entry we are CREATING — index plus run, merged
   * with nothing, because the entry does not exist yet (`stampCurrent`'s merge
   * would carry the state of the entry we are LEAVING onto it).
   */
  function freshStamp(pos: Position): Record<string, unknown> {
    return { [STATE_KEY]: pos.index, [RUN_KEY]: pos.run }
  }

  function pushUrl(path: string): void {
    env.pushState(freshStamp(stand(pushStamp())), path)
  }

  function replaceUrl(path: string): void {
    // A replace swaps the entry in place, so it keeps THAT entry's index.
    const pos = stand(replaceStamp())
    // The one re-stamp that legitimately carries a path: this navigation is
    // changing the URL as well as the entry's state.
    env.replaceState(stampCurrent(pos), path)
  }

  /**
   * Set location.hash, arming the echo `hashchange` it is about to produce —
   * every one of our own writes is echoed, and every caller suppressed it, so
   * there is no second behaviour to select. Returns whether the URL actually
   * changed: a same-hash write is a no-op the browser reports nothing for, so
   * nothing may be armed or counted for it.
   */
  function setHash(newHash: string): boolean {
    // `sameHash` DIRECTLY, not `sameUrl`. This guard is load-bearing — arming an
    // echo for a write the browser will not report leaves a suppression pending
    // that swallows a later genuine `hashchange` — and what it is asking about
    // is the FRAGMENT, because that is what the line below writes. `sameUrl`
    // answers the same question only while `router.mode === 'hash'`, which is
    // true of all three of this function's callers today; routing a guard this
    // load-bearing through a mode test made ELSEWHERE would make a fourth caller
    // silently unsafe rather than obviously wrong (#162 review).
    if (sameHash(env.hash, newHash)) return false
    // Resolve the position (and the run) of the entry we are LEAVING before the
    // write replaces it.
    const next = pushStamp()
    armEcho(newHash)
    env.setHash(newHash)
    // The fragment navigation created its entry SYNCHRONOUSLY (only the
    // `hashchange` EVENT is queued), so stamp it now: setting the hash
    // cannot carry state itself, and the blocked-back restore needs an index on
    // every entry to compute a `history.go` delta from.
    stand(next)
    // A fresh fragment entry carries no state, so this merges with nothing —
    // but every re-stamp in this file goes through `stampCurrent`, with no
    // exception for a reader to re-verify.
    //
    // No path: re-stamping the entry the hash write just created. A `''` here
    // would resolve against the document base and throw the fragment away —
    // i.e. undo the navigation on the line above.
    env.replaceState(stampCurrent(next))
    return true
  }
  /**
   * Run guards for a navigation to `newLocation`. `redirected` is reported
   * explicitly rather than inferred by comparing routes: a guard may return a
   * structurally equal object, and `push`/`replace` need to know whether the
   * URL they are about to write is the one their caller actually asked for.
   *
   * A redirect CHAINS to a fixed point (#161), in both modes and at every call
   * site — the loop lives here, so no call site needed changing. A `beforeEnter`
   * that redirects `admin → login` and separately redirects `login → home` rests
   * on `home`: each hop's target is offered to the guard in turn until the guard
   * accepts it (returns nullish), blocks it, or stops moving it.
   *
   * FOUR things make that terminate and stay honest, and each is a decision:
   *
   * 1. THE SETTLE TEST IS THE CANONICAL URL. Named route locations contain URL
   *    identity only, so this is an exact route-identity comparison rather than
   *    the lossy projection used by the former arbitrary route-object model.
   * 2. THE HOP IS ADOPTED BEFORE THE SETTLE TEST. A guard that normalises `to`
   *    and hands back an equivalent route — #162's shape — settles immediately,
   *    but the route DISPATCHED is the one it returned, not the one it was
   *    asked about, and `redirected` is true for it. That is what shipped
   *    before and what the same-URL short-circuit downstream expects: the flag
   *    means "the guard replaced the object", never "the URL moved".
   * 3. `beforeLeave` RUNS ONCE, before the loop, against the ORIGINALLY
   *    REQUESTED route. It is the unsaved-changes PROMPT; asking it per hop
   *    would prompt N times for one navigation. Running it first also keeps the
   *    order right — a refused leave must run no `beforeEnter` at all.
   * 4. `from` IS `currentLocation` ON EVERY HOP. No hop is ENTERED — they are
   *    proposals — so where the navigation is coming from does not change as
   *    the chain resolves.
   *
   * A chain that never settles — a cycle (`a → b → a → …`), or one that simply
   * keeps producing new URLs — is capped at {@link MAX_REDIRECT_HOPS}. On
   * exhaustion the loop RESTS ON THE LAST HOP and warns; it does NOT block.
   * Issue #161 named both; blocking converts an app bug into a dead navigation
   * with the app stuck where it was, whereas resting leaves it usable and the
   * warning names the cap as the cause.
   *
   * Be precise about what that hop is: it is the last route the guard RETURNED,
   * and it was never OFFERED — the cap is checked after the hop is taken, so no
   * guard verdict exists for the route rested on, and it may be one the guard
   * would have BLOCKED. That is a real unverified landing, and it is accepted
   * because the alternative is worse and the surface is shrinking: under the
   * single-hop behaviour this replaces, EVERY redirect landed unverified (the
   * target was never re-offered). Multi-hop leaves exactly one such landing, at
   * the cap boundary of a runaway chain the router already calls an app bug and
   * warns about.
   *
   * Documented under "Guards" in `site/content/api/router.md` and pinned in
   * `test/guards.test.ts`.
   */
  function locationArgs(location: Location): [string, Record<string, unknown>] {
    return [location.name, location.params]
  }

  function locationHref(location: Location): string {
    return (router.href as (...args: readonly unknown[]) => string)(...locationArgs(location))
  }

  function destinationLocation(destination: readonly unknown[]): Location {
    return (router.location as (...args: readonly unknown[]) => Location)(...destination)
  }

  function normalizeLocation(location: Location): Location {
    return (router.location as (...args: readonly unknown[]) => Location)(...locationArgs(location))
  }

  function isCurrentCanonical(location: Location): boolean {
    return (
      currentLocation !== null &&
      locationHref(currentLocation) === locationHref(location) &&
      sameUrl(locationHref(location))
    )
  }

  function runGuards(newLocation: Location): GuardOutcome<Location> {
    if (options?.beforeLeave && currentLocation !== null) {
      if (!options.beforeLeave(currentLocation, newLocation)) return { blocked: true }
    }
    const beforeEnter = options?.beforeEnter
    if (!beforeEnter) return { blocked: false, location: newLocation, redirected: false }

    let location = newLocation
    let redirected = false
    for (let hops = 0; ; ) {
      const result = beforeEnter(location, currentLocation)
      if (result === false) return { blocked: true }
      // Any non-`false`, non-nullish return is a redirect location.
      if (result === undefined || result === null) break
      const next = normalizeLocation(result as Location)
      // Whether the URL MOVED decides only whether to ask again; the hop is
      // taken either way (see 2 above).
      const moved = locationHref(next) !== locationHref(location)
      location = next
      redirected = true
      if (!moved) break
      if (++hops >= MAX_REDIRECT_HOPS) {
        // Say only what is KNOWN: the cap was reached. A cycle is the likeliest
        // cause but not a provable one — a chain producing a NEW url every hop
        // trips this too, so asserting "cycle" would misdirect the reader
        // debugging exactly that case. The hop count and the resting url are
        // the actionable half; the route rested on was never offered to the
        // guard (see above).
        console.warn(
          `[@llui/router] beforeEnter redirected ${MAX_REDIRECT_HOPS} times without settling ` +
            `(resting on: ${locationHref(location)}, never offered to the guard). ` +
            `Fold the chain, or check it for a cycle.`,
        )
        break
      }
    }
    return { blocked: false, location, redirected }
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
    if (!validatePendingHashEcho()) return false
    pendingEchoCount--
    if (pendingEchoCount === 0) pendingEchoHash = null
    return true
  }

  /**
   * Validate that the current entry is the destination of a queued hash write.
   * A write whose destination is no longer showing is stale, so validation also
   * discards the count and destination rather than leaving them armed to swallow
   * a later genuine event.
   */
  function validatePendingHashEcho(): boolean {
    if (pendingEchoCount === 0) return false
    if (pendingEchoHash !== null && sameHash(env.hash, pendingEchoHash)) return true
    pendingEchoCount = 0
    pendingEchoHash = null
    return false
  }

  /**
   * Consume the popstate our own restoring `history.go` produced. Cleared
   * unconditionally: the traversal may land somewhere else entirely (or never
   * fire), and an armed flag that outlives its restore swallows the next
   * genuine popstate (#103).
   */
  function consumePopstateRestore(): boolean {
    if (pendingRestore === null) return false
    const expected = pendingRestore
    pendingRestore = null
    // The RUN is half of the identity: the same index in another run is a
    // different entry, so matching on the number alone would swallow a genuine
    // popstate onto it and adopt a position we are not standing at.
    const landed = readPosition(env.historyState)
    if (landed === null) return false
    if (landed.index !== expected.index || landed.run !== expected.run) return false
    stand(expected)
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
   * modes. So is an entry stamped with an index but no RUN, which is what an
   * older build's stamp looks like: continuing its numbering computes a delta
   * straight across a gap it restarted over and never recorded (`readPosition`).
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
   * neighbours were numbered in (see `standing`), so a guard-blocked
   * traversal ONTO it, or ACROSS it, is not undone — the URL is left showing the
   * route the guard refused, nothing is dispatched, and application location keeps the
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
    // A position with no run is not a position: the run is what makes the next
    // delta subtractable, so the two are adopted and forgotten together.
    const landed = readPosition(env.historyState)
    currentIndex = landed === null ? null : landed.index
    currentRun = landed === null ? null : landed.run
  }

  /**
   * Rewrite the URL of the entry a browser-driven navigation just LANDED on,
   * so a guard REDIRECT reaches the address bar as well as application location
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
   * the exact hazard `restoreBlocked` and `standing` document — and a push
   * from the rewound position TRUNCATES every forward entry, turning an auth
   * redirect into the stack corruption #103 fixed.
   *
   * The entry does not move, so it keeps the index `adoptLandedEntry` just read.
   * An UNKNOWN position stays unknown: the URL is still written (that is the
   * fix), but no index is invented for it — a guessed stamp is what turns a
   * later blocked back into a wrong-direction `history.go` (#103).
   *
   * In HASH mode this is `replaceState` with a fragment-only url, which is now
   * also what the hash `replace()` effect writes (#164). It was once the only
   * one of the two: `location.replace` DROPS the entry's state — taking the
   * stamp this path depends on with it — and it FIRES a `hashchange`, so its
   * caller had to arm an echo, and an echo armed for an event that never
   * arrives is only discarded once the URL moves off the hash it was armed for,
   * swallowing a later genuine hashchange onto that same hash in the meantime.
   * `replaceState` has neither problem: the HTML spec's URL-and-history update
   * steps fire no event at all, and the state is carried rather than destroyed.
   *
   * A write that would not MOVE the URL is skipped (#162). `runGuards` reports
   * `redirected` for any non-`false`, non-nullish `beforeEnter` return — it has
   * no equality on `R` to do otherwise — so a guard that NORMALISES its argument
   * and returns a structurally equal route reaches here on every guarded browser
   * navigation, asking for the URL that is already showing. The stamp is not
   * part of that question: `adoptLandedEntry` has already resynced the position
   * FROM this entry, so the state this would write back is the state already on
   * it.
   */
  function rewriteLandedUrl(path: string): void {
    if (sameUrl(path)) return
    const pos =
      currentIndex === null || currentRun === null ? null : { index: currentIndex, run: currentRun }
    env.replaceState(pos === null ? env.historyState : stampCurrent(pos), path)
  }

  /**
   * Undo a browser-driven navigation a guard blocked, leaving the stack exactly
   * as it was: a TRAVERSAL back to the entry we were on, never a fresh push.
   */
  function restoreBlocked(): void {
    if (currentLocation === null) return
    const landed = readPosition(env.historyState)
    // Both positions must be known for a delta to mean anything. When either is
    // not — no stamp at all, or an index with no run to measure it in — do
    // NOTHING: no `history.go` with a guessed delta, and above all nothing armed
    // for a restore that will not happen (#103).
    if (currentIndex === null || currentRun === null || landed === null) return
    // …and they must be numbered in the SAME run, or their difference is not a
    // distance. `delta` is of any magnitude — browsers deliver multi-entry
    // traversals (a back-button long-press menu, `history.go(-n)`) — so a run
    // boundary anywhere between the two entries makes it under- or over-count by
    // however many entries the router could not number. Refusing leaves the URL
    // on the blocked route, which is the same known, documented outcome as an
    // unstamped landing; guessing traverses to the wrong entry and dispatches a
    // route the user never asked for (#150 review).
    if (landed.run !== currentRun) return
    const delta = currentIndex - landed.index
    if (delta === 0) return
    // This position also identifies the restoration in hash mode. A fragment-
    // changing restore emits popstate + hashchange and the listener pairs them;
    // a same-fragment restore emits popstate alone. Treating either as a queued
    // hash-write echo would leave a stale suppression behind in the latter case.
    pendingRestore = { index: currentIndex, run: currentRun }
    env.go(delta)
  }

  // Effects created by this connector carry a normalized location. A manually
  // constructed path-only effect is matched through the same public router seam.
  function targetLocation(effect: RouterEffect): Location | null {
    return effect.location !== undefined
      ? (effect.location as Location)
      : router.match(effect.path!)
  }

  function applyEffect(effect: RouterEffect, send: (msg: unknown) => void): void {
    switch (effect.action) {
      case 'push':
      case 'replace': {
        // URL only. In hash mode, suppress the echo hashchange so the listener
        // does not ALSO dispatch a navigate (finding 2b).
        const target = targetLocation(effect)
        if (target === null || isCurrentCanonical(target)) return
        const outcome = runGuards(target)
        if (outcome.blocked) return
        const finalPath = locationHref(outcome.location)
        if (router.mode === 'hash') {
          if (effect.action === 'push') {
            setHash(finalPath)
          } else if (!sameUrl(finalPath)) {
            // ONE `replaceState` with a fragment-only url — the same mechanism
            // `rewriteLandedUrl` uses, converged onto here in #164. It swaps the
            // entry in place (so the index is unchanged — nothing was pushed),
            // CARRIES the state instead of destroying it, and fires no event.
            //
            // It replaced a `location.replace` that needed three calls to do the
            // same job and was worse at it: `location.replace` DROPS the entry's
            // state — including whatever the host app or another library owns
            // there — so the stamp had to be snapshotted before the write and
            // put back after, and it FIRES a `hashchange`, so an echo had to be
            // armed for an event whose non-arrival would leave a suppression
            // pending that swallows a later genuine hashchange onto this same
            // hash. `stampCurrent` merges the host's keys here as it does
            // everywhere else, with no exception left for a reader to re-verify.
            //
            // Under a `<base href>` it is not merely tidier, it is the
            // difference between working and not. Both spellings resolve the
            // fragment-only url against the BASE rather than the document — but
            // they do different things with the result. Measured in Chrome, on a
            // document at `http://127.0.0.1:8791/page.html` with
            // `<base href="/sub/dir/">`: `history.replaceState({…}, '', '#/x')`
            // stays on the same document and keeps the entry's state, while
            // `location.replace('#/zz')` performs a CROSS-DOCUMENT navigation
            // that unloads the app entirely (the tab ended up on the server's
            // directory listing for `/sub/dir/`). So the mechanism this replaced
            // did not merely lose state under a base — it destroyed the running
            // app; this one moves the address bar and nothing else.
            env.replaceState(stampCurrent(stand(replaceStamp())), finalPath)
          }
        } else if (effect.action === 'push') {
          pushUrl(finalPath)
        } else {
          replaceUrl(finalPath)
        }
        currentLocation = outcome.location
        // A guard REDIRECT wrote a URL the caller never asked for. push/replace
        // are URL-only by contract — the caller's reducer already set
        // application location — but it set it to the REQUESTED route, so staying
        // silent leaves application location and the URL disagreeing permanently
        // (#110). Only a redirect dispatches; the plain case keeps the
        // documented URL-only contract.
        if (outcome.redirected) send(navigateMsg(outcome.location))
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
        const target = targetLocation(effect)
        if (target === null || isCurrentCanonical(target)) return
        const outcome = runGuards(target)
        if (outcome.blocked) return
        const finalPath = locationHref(outcome.location)
        if (router.mode === 'hash') {
          setHash(finalPath)
        } else {
          pushUrl(finalPath)
        }
        currentLocation = outcome.location
        send(navigateMsg(outcome.location))
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

  function listener(send: (msg: NavigateMessage | UnmatchedMessage) => void): Renderable
  function listener<M>(
    send: (msg: M | UnmatchedMessage) => void,
    msgFactory: (location: Location) => M,
  ): Renderable
  function listener<M, U>(
    send: (msg: M | U) => void,
    msgFactory: (location: Location) => M,
    unmatchedFactory: (url: string) => U,
  ): Renderable
  function listener<M, U>(
    send: (msg: M | U) => void,
    msgFactory?: (location: Location) => M,
    unmatchedFactory?: (url: string) => U,
  ): Renderable {
    const factory: (location: Location) => unknown = msgFactory ?? navigateMsg
    const makeUnmatched: (url: string) => unknown = unmatchedFactory ?? unmatchedMsg
    return [
      onMount(() => {
        let pendingHashchangePair: { hash: string; consumeEcho: boolean } | null = null

        const handler = (event: 'popstate' | 'hashchange', eventHash?: string) => {
          if (router.mode === 'hash') {
            if (event === 'hashchange') {
              if (pendingHashchangePair !== null) {
                const pair = pendingHashchangePair
                pendingHashchangePair = null
                if (sameHash(eventHash ?? env.hash, pair.hash)) {
                  if (pair.consumeEcho) consumeHashEcho()
                  return
                }
              }
              if (consumeHashEcho()) return
            } else {
              const consumeEchoWithPair = validatePendingHashEcho()
              pendingHashchangePair = {
                hash: normHash(env.hash),
                consumeEcho: consumeEchoWithPair,
              }
              if (consumePopstateRestore()) return
              if (consumeEchoWithPair) return
            }
          } else if (consumePopstateRestore()) {
            return
          }

          const originalUrl = currentInput()
          const matched = router.match(originalUrl)
          if (matched === null) {
            adoptLandedEntry()
            currentLocation = null
            send(makeUnmatched(originalUrl) as M | U)
            return
          }
          const outcome = runGuards(matched)
          if (outcome.blocked) {
            restoreBlocked()
            return
          }
          adoptLandedEntry()
          const canonicalUrl = locationHref(outcome.location)
          if (!sameUrl(canonicalUrl)) rewriteLandedUrl(canonicalUrl)
          currentLocation = outcome.location
          send(factory(outcome.location) as M | U)
        }
        if (router.mode === 'history') {
          return env.onUrlChange('popstate', () => handler('popstate'))
        }
        const unsubscribePopstate = env.onUrlChange('popstate', () => handler('popstate'))
        const unsubscribeHashchange = env.onUrlChange('hashchange', (newHash) =>
          handler('hashchange', newHash),
        )
        return () => {
          unsubscribePopstate()
          unsubscribeHashchange()
        }
      }),
    ]
  }

  return {
    push(...destination) {
      const location = destinationLocation(destination)
      return {
        type: '__router',
        action: 'push',
        path: locationHref(location),
        location,
      }
    },
    replace(...destination) {
      const location = destinationLocation(destination)
      return {
        type: '__router',
        action: 'replace',
        path: locationHref(location),
        location,
      }
    },
    navigate(...destination) {
      const location = destinationLocation(destination)
      return {
        type: '__router',
        action: 'navigate',
        path: locationHref(location),
        location,
      }
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

    listener,

    link<M>(send: (msg: M) => void, ...args: LinkArguments<Registry, M>): Mountable {
      const argumentList = args as unknown[]
      const destinationLength =
        argumentList.length - (typeof argumentList.at(-1) === 'function' ? 3 : 2)
      const destination = argumentList.slice(0, destinationLength) as RouteDestination<Registry>
      const attrs = argumentList[destinationLength] as Record<string, unknown>
      const children = argumentList[destinationLength + 1] as readonly ChildNode[]
      const msgFactory = argumentList[destinationLength + 2] as
        | ((location: Location) => M)
        | undefined
      const location = destinationLocation(destination)
      const factory = msgFactory ?? (navigateMsg as (location: Location) => M)
      return a(
        {
          ...attrs,
          href: locationHref(location),
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
            // guards → block/redirect/allow → URL write + send + currentLocation —
            // so auth / unsaved-changes guards are never silently skipped
            // (finding 1). Hash mode used to write the hash and leave the rest
            // to the listener, which made a link INERT without a mounted
            // listener() (zero dispatches, ever, and no guards at click time)
            // and made a click on the CURRENT route a dead one: preventDefault
            // ran, `setHash` bailed on the identical hash, and nothing followed
            // (#110). A click on the current route is a request to re-enter it,
            // so the router now performs a full no-op.
            if (isCurrentCanonical(location)) return
            const outcome = runGuards(location)
            if (outcome.blocked) return
            const finalPath = locationHref(outcome.location)
            if (router.mode === 'hash') setHash(finalPath)
            else pushUrl(finalPath)
            currentLocation = outcome.location
            send(factory(outcome.location))
          },
        },
        children,
      )
    },

    createHandler<S, M, E>(config: {
      message?: string
      getLocation: (msg: M) => Location
      guard?: (location: Location, state: S) => Location
      onNavigate: (state: S, location: Location) => [S, E[]]
    }): (state: S, msg: M) => [S, E[]] | null {
      const msgType = config.message ?? 'navigate'
      return (state: S, msg: M) => {
        if ((msg as Record<string, unknown>).type !== msgType) return null
        let location = config.getLocation(msg)
        if (config.guard) location = config.guard(location, state)
        return config.onNavigate(state, location)
      }
    },
  }
}
