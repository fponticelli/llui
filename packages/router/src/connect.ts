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

export interface ConnectOptions<R> {
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

/**
 * The `history.state` to write when re-stamping the CURRENT entry, preserving
 * every other key already on it — the seed rewrites an entry the host app (or
 * another library) may already own state on.
 */
function stampCurrent(index: number): Record<string, unknown> {
  const existing = history.state
  const base =
    existing !== null && typeof existing === 'object' ? (existing as Record<string, unknown>) : {}
  return { ...base, [STATE_KEY]: index }
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

  // Seed currentRoute from the current location so the first navigation's
  // guards see the actual starting route as `from` (not null) and a
  // blocked navigation can restore the real starting URL.
  function currentInput(): string {
    if (typeof location === 'undefined') return router.mode === 'hash' ? '#/' : '/'
    return router.mode === 'hash' ? location.hash : location.pathname + location.search
  }
  let currentRoute: R | null = (() => {
    try {
      return router.match(currentInput())
    } catch {
      return null
    }
  })()

  // Our position in the session history stack. The browser exposes no such
  // counter, so it is carried in `history.state` on every entry we create and
  // is what a blocked navigation's `history.go(delta)` restore is computed
  // from. `null` means UNKNOWN — we are sitting on an entry nobody stamped, so
  // no delta can be derived and none may be guessed.
  let currentIndex: number | null = null
  if (typeof history !== 'undefined') {
    const seeded = readIndex(history.state)
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
      history.replaceState(stampCurrent(0), '')
    }
  }

  // Suppress the echo event our own URL mutation triggers, so a single
  // navigation dispatches exactly once (see findings 2a/2b/2c).
  let suppressNextHashchange = false
  // The index a blocked navigation's `history.go` is restoring to, or `null`.
  // Keyed on the destination rather than a bare flag: `history.go` is
  // asynchronous and a delta it cannot reach fires nothing at all, so a flag
  // stays armed and swallows the next genuine popstate (#103).
  let pendingRestoreIndex: number | null = null

  function pushUrl(path: string): void {
    currentIndex = (currentIndex ?? 0) + 1
    history.pushState({ [STATE_KEY]: currentIndex }, '', path)
  }

  function replaceUrl(path: string): void {
    history.replaceState(stampCurrent(currentIndex ?? 0), '', path)
  }

  /**
   * Set location.hash, optionally suppressing the echo hashchange dispatch.
   * Returns whether the URL actually changed — a same-hash write is a no-op the
   * browser reports nothing for, so nothing may be armed or counted for it.
   */
  function setHash(newHash: string, suppress: boolean): boolean {
    if (sameHash(location.hash, newHash)) return false
    if (suppress) suppressNextHashchange = true
    location.hash = newHash
    // The fragment navigation created its entry SYNCHRONOUSLY (only the
    // `hashchange` EVENT is queued), so stamp it now: `location.hash = …`
    // cannot carry state itself, and the blocked-back restore needs an index on
    // every entry to compute a `history.go` delta from.
    currentIndex = (currentIndex ?? 0) + 1
    history.replaceState({ [STATE_KEY]: currentIndex }, '')
    return true
  }
  /**
   * Run guards for a navigation to `newRoute`. Returns the final route
   * to navigate to, or `null` if navigation should be blocked.
   */
  function runGuards(newRoute: R): R | null {
    if (options?.beforeLeave && currentRoute !== null) {
      if (!options.beforeLeave(currentRoute, newRoute)) return null
    }
    if (options?.beforeEnter) {
      const result = options.beforeEnter(newRoute, currentRoute)
      if (result === false) return null
      // Any non-`false`, non-nullish return is a redirect Route. Routes are
      // generic `R` and may be primitives (e.g. a string-union route), so
      // gate on nullishness, NOT `typeof === 'object'` — the latter silently
      // dropped string/number redirects and let navigation proceed to the
      // original target (an auth-guard bypass).
      if (result !== undefined && result !== null) {
        return result as R
      }
    }
    return newRoute
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
    if (readIndex(history.state) !== expected) return false
    currentIndex = expected
    return true
  }

  /** Resync `currentIndex` to the entry a browser-driven navigation landed on. */
  function adoptLandedEntry(): void {
    const landed = readIndex(history.state)
    if (landed !== null) {
      currentIndex = landed
      return
    }
    if (router.mode === 'hash') {
      // `hashchange` fires for a NEW fragment navigation (the user editing the
      // address bar) as well as for a traversal, and only a new one can land on
      // an entry we never stamped — so this is a push on top of where we were.
      // Stamp it, or a later blocked back has no delta to work from.
      currentIndex = (currentIndex ?? 0) + 1
      history.replaceState({ [STATE_KEY]: currentIndex }, '')
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
    const landed = readIndex(history.state)
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
      suppressNextHashchange = true
      history.go(delta)
      return
    }
    pendingRestoreIndex = currentIndex
    history.go(delta)
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
      case 'push': {
        // URL only. In hash mode, suppress the echo hashchange so the listener
        // does not ALSO dispatch a navigate (finding 2b).
        const target = targetRoute(effect)
        const finalRoute = runGuards(target)
        if (finalRoute === null) return
        const finalPath = router.href(finalRoute)
        if (router.mode === 'hash') {
          setHash(finalPath, true)
        } else {
          pushUrl(finalPath)
        }
        currentRoute = finalRoute
        break
      }
      case 'replace': {
        // URL only. Same echo suppression as push (finding 2b).
        const target = targetRoute(effect)
        const finalRoute = runGuards(target)
        if (finalRoute === null) return
        const finalPath = router.href(finalRoute)
        if (router.mode === 'hash') {
          if (!sameHash(location.hash, finalPath)) {
            suppressNextHashchange = true
            location.replace(finalPath)
            // `location.replace` swaps the current entry and DROPS its state,
            // so restamp it. The index is unchanged — nothing was pushed.
            history.replaceState({ [STATE_KEY]: currentIndex ?? 0 }, '')
          }
        } else {
          replaceUrl(finalPath)
        }
        currentRoute = finalRoute
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
        const target = targetRoute(effect)
        const finalRoute = runGuards(target)
        if (finalRoute === null) return
        const finalPath = router.href(finalRoute)
        if (router.mode === 'hash') {
          setHash(finalPath, true)
        } else {
          pushUrl(finalPath)
        }
        currentRoute = finalRoute
        send(navigateMsg(finalRoute))
        break
      }
      case 'back':
        history.back()
        break
      case 'forward':
        history.forward()
        break
      case 'scroll':
        window.scrollTo(effect.x!, effect.y!)
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
              if (suppressNextHashchange) {
                suppressNextHashchange = false
                return
              }
            } else if (consumePopstateRestore()) {
              return
            }

            const input =
              router.mode === 'hash' ? location.hash : location.pathname + location.search
            const route = router.match(input)
            const finalRoute = runGuards(route)
            if (finalRoute === null) {
              restoreBlocked()
              return
            }
            adoptLandedEntry()
            currentRoute = finalRoute
            send(factory(finalRoute))
          }
          window.addEventListener(event, handler)
          return () => {
            window.removeEventListener(event, handler)
          }
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
            e.preventDefault()
            if (router.mode === 'hash') {
              // Set the hash and let the listener run guards + dispatch — the
              // single dispatch source in hash mode. (No suppression: we WANT
              // the echo hashchange to drive the navigation.)
              setHash(router.href(route), false)
              return
            }
            // History mode is the primary nav path — run the SAME guard
            // pipeline as the navigate() effect (guards → block/redirect/allow
            // → pushState + send + currentRoute), so auth / unsaved-changes
            // guards are never silently skipped (finding 1).
            const finalRoute = runGuards(route)
            if (finalRoute === null) return
            pushUrl(router.href(finalRoute))
            currentRoute = finalRoute
            send(factory(finalRoute))
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
