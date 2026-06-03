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
   * Requires that the app has mounted `listener()` (typically inside
   * the shell view) — the navigate effect uses the send/factory
   * captured there. If `navigate()` runs before `listener()` mounts,
   * the URL still updates but no message is dispatched and a
   * `console.warn` surfaces the gap. After listener unmount the same
   * fallback applies.
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

export function connectRouter<R>(
  router: Router<R>,
  options?: ConnectOptions<R>,
): ConnectedRouter<R> {
  let currentRoute: R | null = null
  // Captured by listener() at mount, cleared at unmount. The
  // navigate() effect reads these to dispatch the navigate message
  // after pushState — they are the bridge between the reducer-side
  // (which produces effects) and the dispatcher-side (which receives
  // messages). Module-scope inside the closure: at most one listener
  // is active per ConnectedRouter (the shell view).
  let listenerSend: ((msg: unknown) => void) | null = null
  let listenerFactory: ((route: R) => unknown) | null = null
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
      if (result !== undefined && result !== null && typeof result === 'object') {
        return result as R
      }
    }
    return newRoute
  }

  function applyEffect(effect: RouterEffect): void {
    switch (effect.action) {
      case 'push': {
        const target = router.match(effect.path!)
        const finalRoute = runGuards(target)
        if (finalRoute === null) return
        const finalPath = router.href(finalRoute)
        if (router.mode === 'hash') {
          location.hash = finalPath
        } else {
          history.pushState(null, '', finalPath)
        }
        currentRoute = finalRoute
        break
      }
      case 'replace': {
        const target = router.match(effect.path!)
        const finalRoute = runGuards(target)
        if (finalRoute === null) return
        const finalPath = router.href(finalRoute)
        if (router.mode === 'hash') {
          location.replace(finalPath)
        } else {
          history.replaceState(null, '', finalPath)
        }
        currentRoute = finalRoute
        break
      }
      case 'navigate': {
        // pushState semantics + dispatch the navigate message so the
        // app reducer sees the route change. This is the asymmetry
        // fix: link() always did push+send (because click handlers run
        // synchronously in view code with send/factory in scope), but
        // push() as an effect could only do push (no access to send).
        // navigate() resolves it by reading the closure variables that
        // listener() sets at mount time.
        const target = router.match(effect.path!)
        const finalRoute = runGuards(target)
        if (finalRoute === null) return
        const finalPath = router.href(finalRoute)
        if (router.mode === 'hash') {
          location.hash = finalPath
        } else {
          history.pushState(null, '', finalPath)
        }
        currentRoute = finalRoute
        if (listenerSend !== null && listenerFactory !== null) {
          listenerSend(listenerFactory(finalRoute))
        } else {
          console.warn(
            '@llui/router: navigate() effect dispatched but listener() is not mounted — URL updated, but no navigate message was sent. Mount connectedRouter.listener() in your shell view, or use push() and dispatch the route-changed message yourself.',
          )
        }
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

    handleEffect({ effect }) {
      if (effect.type !== '__router') return false
      applyEffect(effect as RouterEffect)
      return true
    },

    listener<M>(send: (msg: M) => void, msgFactory?: (route: R) => M): Renderable {
      const factory = msgFactory ?? ((r: R) => ({ type: 'navigate', route: r }) as M)
      // Place the onMount marker in the view; its callback registers the URL listener
      // on mount. (onMount is a lazy Mountable — calling it for side effect and
      // discarding the return would never register.)
      return [
        onMount(() => {
          // Capture send/factory so the navigate() effect can dispatch
          // route-changed messages from any reducer, not just from
          // popstate or click handlers. Stored as the generic `unknown`
          // shape so applyEffect doesn't need to know R or M; the only
          // consumer is the navigate case above, which round-trips R
          // through factory back to the user's M.
          listenerSend = send as (msg: unknown) => void
          listenerFactory = factory as (route: R) => unknown

          const event = router.mode === 'hash' ? 'hashchange' : 'popstate'
          const handler = () => {
            const input =
              router.mode === 'hash' ? location.hash : location.pathname + location.search
            const route = router.match(input)
            const finalRoute = runGuards(route)
            if (finalRoute === null) {
              // Guard blocked — restore previous URL
              if (currentRoute !== null) {
                const restorePath = router.href(currentRoute)
                history.pushState(null, '', restorePath)
              }
              return
            }
            currentRoute = finalRoute
            send(factory(finalRoute))
          }
          window.addEventListener(event, handler)
          return () => {
            window.removeEventListener(event, handler)
            listenerSend = null
            listenerFactory = null
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
      const factory = msgFactory ?? ((r: R) => ({ type: 'navigate', route: r }) as M)
      return a(
        {
          ...attrs,
          href: router.href(route),
          onClick: (e: Event) => {
            const me = e as MouseEvent
            if (me.ctrlKey || me.metaKey || me.shiftKey || me.altKey || me.button !== 0) return
            e.preventDefault()
            // Push history — pushState doesn't fire popstate, so no double-nav
            if (router.mode === 'hash') {
              // hashchange will fire the listener, which sends the navigate message
              location.hash = router.href(route)
              return
            }
            history.pushState(null, '', router.href(route))
            send(factory(route))
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
