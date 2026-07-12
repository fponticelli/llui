import type { Router } from './index.js'
import { a, onMount } from '@llui/dom'
import type { Mountable, Renderable, ChildNode } from '@llui/dom'

// ── Router Effects ───────────────────────────────────────────────

export interface RouterEffect {
  type: '__router'
  action: 'push' | 'replace' | 'navigate' | 'back' | 'forward' | 'scroll'
  path?: string
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

  // Monotonic index tracked across our own pushState entries. A blocked
  // popstate is undone with history.go(delta) (never a fresh pushState, which
  // would grow a forward entry on every block).
  let currentIndex = 0
  if (
    typeof history !== 'undefined' &&
    history.state &&
    typeof (history.state as Record<string, unknown>)[STATE_KEY] === 'number'
  ) {
    currentIndex = (history.state as Record<string, number>)[STATE_KEY]!
  }
  // Suppress the echo event our own URL mutation triggers, so a single
  // navigation dispatches exactly once (see findings 2a/2b/2c).
  let suppressNextHashchange = false
  let suppressNextPopstate = false

  function pushUrl(path: string): void {
    currentIndex += 1
    history.pushState({ [STATE_KEY]: currentIndex }, '', path)
  }

  function replaceUrl(path: string): void {
    history.replaceState({ [STATE_KEY]: currentIndex }, '', path)
  }

  function sameHash(a: string, b: string): boolean {
    const norm = (h: string) => (h === '' ? '#/' : h.startsWith('#') ? h : '#' + h)
    return norm(a) === norm(b)
  }

  /** Set location.hash, optionally suppressing the echo hashchange dispatch. */
  function setHash(newHash: string, suppress: boolean): void {
    if (sameHash(location.hash, newHash)) return
    if (suppress) suppressNextHashchange = true
    location.hash = newHash
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

  function applyEffect(effect: RouterEffect, send: (msg: unknown) => void): void {
    switch (effect.action) {
      case 'push': {
        // URL only. In hash mode, suppress the echo hashchange so the listener
        // does not ALSO dispatch a navigate (finding 2b).
        const target = router.match(effect.path!)
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
        const target = router.match(effect.path!)
        const finalRoute = runGuards(target)
        if (finalRoute === null) return
        const finalPath = router.href(finalRoute)
        if (router.mode === 'hash') {
          if (!sameHash(location.hash, finalPath)) suppressNextHashchange = true
          location.replace(finalPath)
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
        const target = router.match(effect.path!)
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
      return { type: '__router', action: 'push', path: router.href(route) }
    },
    replace(route) {
      return { type: '__router', action: 'replace', path: router.href(route) }
    },
    navigate(route) {
      return { type: '__router', action: 'navigate', path: router.href(route) }
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
            } else if (suppressNextPopstate) {
              suppressNextPopstate = false
              // Resync the index to the entry history.go landed us on.
              const st = history.state as Record<string, unknown> | null
              if (st && typeof st[STATE_KEY] === 'number') currentIndex = st[STATE_KEY] as number
              return
            }

            const input =
              router.mode === 'hash' ? location.hash : location.pathname + location.search
            const route = router.match(input)
            const finalRoute = runGuards(route)
            if (finalRoute === null) {
              // Guard blocked the browser-driven navigation — restore the URL.
              if (currentRoute !== null) {
                if (router.mode === 'history') {
                  // Reverse the pop with history.go(delta), tracked by a
                  // monotonic index — NEVER pushState, which would leave a
                  // stray forward entry on every block (finding 2c).
                  const st = history.state as Record<string, unknown> | null
                  const poppedIdx =
                    st && typeof st[STATE_KEY] === 'number' ? (st[STATE_KEY] as number) : 0
                  const delta = currentIndex - poppedIdx
                  if (delta !== 0) {
                    suppressNextPopstate = true
                    history.go(delta)
                  }
                } else {
                  // Hash mode: restore the previous hash without dispatching.
                  const restore = router.href(currentRoute)
                  if (!sameHash(location.hash, restore)) {
                    suppressNextHashchange = true
                    location.hash = restore
                  }
                }
              }
              return
            }
            // Allowed — resync index to the entry we're now on.
            if (router.mode === 'history') {
              const st = history.state as Record<string, unknown> | null
              if (st && typeof st[STATE_KEY] === 'number') currentIndex = st[STATE_KEY] as number
            }
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
