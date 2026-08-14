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
   * Load-bearing, not diagnostic: it is the only signal that tells a `hashchange`
   * caused by a NEW fragment navigation apart from one caused by a TRAVERSAL,
   * which need opposite index handling (a push grows the stack, a traversal
   * never does). An implementation that returns a constant makes every unstamped
   * hash entry read as a traversal.
   *
   * `0` doubles as the "this surface has no history at all" answer — every real
   * session history contains at least the entry you are standing on — which is
   * what the seed checks before it writes.
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

/** Normalize a hash for comparison: `''` and `'/x'` both mean `'#/'`-rooted. */
function normHash(h: string): string {
  return h === '' ? '#/' : h.startsWith('#') ? h : '#' + h
}

function sameHash(a: string, b: string): boolean {
  return normHash(a) === normHash(b)
}

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
    return { ...base, [STATE_KEY]: index }
  }

  // Our position in the session history stack. The browser exposes no such
  // counter, so it is carried in `history.state` on every entry we create and
  // is what a blocked navigation's `history.go(delta)` restore is computed
  // from. `null` means UNKNOWN — we are sitting on an entry nobody stamped, so
  // no delta can be derived and none may be guessed.
  let currentIndex: number | null = null
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
      currentIndex = seeded
    } else {
      // Seed the entry the app LOADED on. Without this stamp a pop back onto
      // it carries no index, `currentIndex` never resyncs across it, and every
      // later delta is inflated — a blocked back then calls `history.go` with
      // an unreachable delta, leaves the URL sitting on the route it just
      // blocked, and (worse) leaves the suppression armed for a restore that
      // never happened, swallowing the user's next genuine pop (#103).
      currentIndex = 0
      // No path: this re-stamps the entry we are ALREADY on. Passing `''` here
      // resolves against the document base and drops the fragment, silently
      // breaking hash mode (see `RouterEnv.replaceState`).
      env.replaceState(stampCurrent(0))
    }
  }

  // `history.length` as of the last time we looked. The browser exposes no way
  // to ask whether a `hashchange` came from a NEW fragment navigation or from a
  // traversal, and the two need opposite handling — but a push grows the stack
  // and a traversal never does, so the length answers it. Kept in sync at every
  // point we observe or change history.
  //
  // KNOWN GAP (#150): only points the ROUTER sees refresh this. History growth
  // it never sees — a foreign `pushState`, or an IFRAME navigation, which does
  // grow the joint session history — leaves it stale-LOW, and a traversal onto
  // an unstamped entry then reads as a push and is stamped with an inverted
  // index. The only fully sound alternative is to treat every unstamped hash
  // entry as UNKNOWN (what history mode does), which costs the address-bar-edit
  // case this deliberately keeps. That trade is #150, not a patch.
  let knownLength = env.historyLength
  function noteLength(): void {
    knownLength = env.historyLength
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

  /**
   * The index of the entry we are physically STANDING on — which is not always
   * the last one we wrote. `history.go` is asynchronous, so an app that
   * navigates in the same tick as a blocked pop pushes from the BLOCKED entry,
   * truncating everything above it. Numbering from `currentIndex` there claims
   * a depth the stack no longer has, and the next blocked back computes an
   * unreachable delta — #103's original symptom, re-reachable (#139 review).
   */
  function landedIndex(): number {
    return readIndex(env.historyState) ?? currentIndex ?? 0
  }

  function pushUrl(path: string): void {
    currentIndex = landedIndex() + 1
    env.pushState({ [STATE_KEY]: currentIndex }, path)
    noteLength()
  }

  function replaceUrl(path: string): void {
    // A replace swaps the entry in place, so it keeps THAT entry's index.
    currentIndex = landedIndex()
    // The one re-stamp that legitimately carries a path: this navigation is
    // changing the URL as well as the entry's state.
    env.replaceState(stampCurrent(currentIndex), path)
    noteLength()
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
    // Read the index of the entry we are LEAVING before the write replaces it.
    const from = landedIndex()
    armEcho(newHash)
    env.setHash(newHash)
    // The fragment navigation created its entry SYNCHRONOUSLY (only the
    // `hashchange` EVENT is queued), so stamp it now: setting the hash
    // cannot carry state itself, and the blocked-back restore needs an index on
    // every entry to compute a `history.go` delta from.
    currentIndex = from + 1
    // A fresh fragment entry carries no state, so this merges with nothing —
    // but every re-stamp in this file goes through `stampCurrent`, with no
    // exception for a reader to re-verify.
    //
    // No path: re-stamping the entry the hash write just created. A `''` here
    // would resolve against the document base and throw the fragment away —
    // i.e. undo the navigation on the line above.
    env.replaceState(stampCurrent(currentIndex))
    noteLength()
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
    pendingRestoreIndex = null
    if (readIndex(env.historyState) !== expected) return false
    currentIndex = expected
    return true
  }

  /** Resync `currentIndex` to the entry a browser-driven navigation landed on. */
  function adoptLandedEntry(): void {
    const landed = readIndex(env.historyState)
    if (landed !== null) {
      currentIndex = landed
      return
    }
    if (router.mode === 'hash') {
      // `hashchange` fires for a NEW fragment navigation (the user editing the
      // address bar) as well as for a TRAVERSAL, and an unstamped entry does
      // not tell them apart: every entry that pre-dates `connectRouter` is
      // unstamped too. Assuming a push stamped such an entry ABOVE the one it
      // sits below, which inverts the delta and sends the next blocked back
      // FURTHER backwards. `history.length` is the discriminator — a push grows
      // the stack, a traversal never does.
      if (env.historyLength > knownLength) {
        currentIndex = (currentIndex ?? 0) + 1
        // No path: stamping the entry the browser just navigated to.
        env.replaceState(stampCurrent(currentIndex))
        noteLength()
        return
      }
      // A traversal onto an entry we never stamped: its position is UNKNOWN and
      // the browser will not tell us. Record that rather than guess — a guessed
      // index is exactly what turns a blocked back into a wrong-direction
      // `history.go` (#103). (A push whose entry did not grow the stack, i.e.
      // one that truncated forward entries, lands here too: also unknown, which
      // is the safe answer either way.)
      currentIndex = null
      noteLength()
      return
    }
    // History mode: popstate is always a TRAVERSAL, so an unstamped entry is
    // one we have genuinely never seen and whose position the browser will not
    // tell us. Record that instead of guessing — a guessed index is exactly
    // what turns a blocked back into an unreachable `history.go` (#103).
    currentIndex = null
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
    if (currentIndex === null || landed === null) return
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
            currentIndex = landedIndex()
            const carried = stampCurrent(currentIndex)
            armEcho(finalPath)
            env.replaceLocation(finalPath)
            // The index is unchanged — nothing was pushed. No path: the URL is
            // already where `replaceLocation` just put it, and a `''` here
            // would resolve it away.
            env.replaceState(carried)
            noteLength()
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
