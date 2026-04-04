import type { Router } from './index'
import { a, onMount } from '@llui/dom'

// ── Router Effects ───────────────────────────────────────────────

export interface RouterEffect {
  type: '__router'
  action: 'push' | 'replace' | 'back' | 'forward' | 'scroll'
  path?: string
  x?: number
  y?: number
}

export interface ConnectedRouter<R> {
  /** Effect: push a new route onto history */
  push(route: R): RouterEffect
  /** Effect: replace current history entry */
  replace(route: R): RouterEffect
  /** Effect: go back */
  back(): RouterEffect
  /** Effect: go forward */
  forward(): RouterEffect
  /** Effect: scroll to position */
  scroll(x: number, y: number): RouterEffect

  /** Plugin for handleEffects().use() — handles RouterEffect */
  handleEffect: (effect: { type: string }, send: unknown, signal: AbortSignal) => boolean

  /**
   * View helper: attach URL change listener via onMount.
   * Returns an empty comment node. Sends { type: 'navigate', route } on URL change.
   */
  listener<M>(send: (msg: M) => void, msgFactory?: (route: R) => M): Node[]

  /**
   * View helper: render a navigation link.
   * Generates <a> with proper href and click handler that sends navigate message.
   */
  link<M>(
    send: (msg: M) => void,
    route: R,
    attrs: Record<string, unknown>,
    children: Node[],
    msgFactory?: (route: R) => M,
  ): HTMLElement

  /**
   * Create an update handler for chainUpdate.
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

export function connectRouter<R>(router: Router<R>): ConnectedRouter<R> {
  function applyEffect(effect: RouterEffect): void {
    switch (effect.action) {
      case 'push':
        if (router.mode === 'hash') {
          location.hash = effect.path!
        } else {
          history.pushState(null, '', effect.path!)
        }
        break
      case 'replace':
        if (router.mode === 'hash') {
          location.replace(effect.path!)
        } else {
          history.replaceState(null, '', effect.path!)
        }
        break
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
    back() {
      return { type: '__router', action: 'back' }
    },
    forward() {
      return { type: '__router', action: 'forward' }
    },
    scroll(x, y) {
      return { type: '__router', action: 'scroll', x, y }
    },

    handleEffect(effect) {
      if (effect.type !== '__router') return false
      applyEffect(effect as RouterEffect)
      return true
    },

    listener<M>(send: (msg: M) => void, msgFactory?: (route: R) => M): Node[] {
      const factory = msgFactory ?? ((r: R) => ({ type: 'navigate', route: r }) as M)
      onMount(() => {
        const event = router.mode === 'hash' ? 'hashchange' : 'popstate'
        const handler = () => {
          const input = router.mode === 'hash' ? location.hash : location.pathname + location.search
          const route = router.match(input)
          send(factory(route))
        }
        window.addEventListener(event, handler)
        return () => window.removeEventListener(event, handler)
      })
      return [document.createComment('router')]
    },

    link<M>(
      send: (msg: M) => void,
      route: R,
      attrs: Record<string, unknown>,
      children: Node[],
      msgFactory?: (route: R) => M,
    ): HTMLElement {
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
