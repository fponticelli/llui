import type { LiveSignal } from '@llui/dom'

/**
 * A navigation-progress handle: the first-class answer to "show a loader while a
 * client navigation is in flight."
 *
 * **Why this exists.** None of `createOnRenderClient`'s lifecycle hooks fire
 * during the latency window a user perceives as lag. `onLeave`/`onEnter` bracket
 * the DOM *swap*, and Vike only invokes `onRenderClient` *after* it has already
 * fetched the new page's `+data` — so by the time any of those run, the wait is
 * over. The only signals that fire at navigation *start* (on the click, before
 * the server round-trip) are Vike's native `onPageTransitionStart` /
 * `onPageTransitionEnd` hooks. This helper wraps that pair into a reactive
 * boolean the layout binds, removing the module-singleton + layout-handle capture
 * + hand-rolled `nav/pending` message + reducer case every app would otherwise
 * re-derive.
 *
 * **Wiring (three small files, no per-app glue logic).** `@llui/vike` cannot
 * register Vike's `+onPageTransition*` hooks for you — Vike discovers them by the
 * `+` filename convention — so create the handle once in your own module and
 * re-export its hook functions from the convention files:
 *
 * ```ts
 * // nav-progress.ts — your module, created once
 * import { createNavigationProgress } from '@llui/vike/client'
 * export const navProgress = createNavigationProgress({ delay: 120 })
 * ```
 * ```ts
 * // pages/+onPageTransitionStart.ts
 * export { onPageTransitionStart } from '../nav-progress'   // (re-export by name)
 * // pages/+onPageTransitionEnd.ts
 * export { onPageTransitionEnd } from '../nav-progress'
 * ```
 *
 * Then bind `pending` in the layout. It is a {@link LiveSignal}: `peek()` in
 * handlers, `bind()` for a reactive subscription. The zero-message path is to
 * place an `onMount` in the layout view and `bind()` there — `bind` returns its
 * unsubscribe, which doubles as the `onMount` cleanup, so it auto-disposes:
 *
 * ```ts
 * import { onMount, div } from '@llui/dom'
 * import { navProgress } from '../nav-progress'
 *
 * view: () => [
 *   div({ class: 'app-shell' }, [
 *     onMount((root) =>
 *       navProgress.pending.bind((p) => root.classList.toggle('nav-pending', p)),
 *     ),
 *     // …header, main([pageSlot()]), etc.
 *   ]),
 * ]
 * ```
 */
export interface NavigationProgress {
  /**
   * Vike `+onPageTransitionStart` hook. Fires on the navigation click, before
   * Vike fetches the new page's `+data`. Re-export it from
   * `pages/+onPageTransitionStart.ts`. Bound to the handle — safe to detach.
   */
  readonly onPageTransitionStart: () => void

  /**
   * Vike `+onPageTransitionEnd` hook. Fires once the new page is rendered.
   * Re-export it from `pages/+onPageTransitionEnd.ts`. Bound to the handle —
   * safe to detach.
   */
  readonly onPageTransitionEnd: () => void

  /**
   * `true` while a client navigation is in flight, `false` otherwise. A
   * {@link LiveSignal}: `peek()` for a one-shot read; `bind(cb)` fires `cb`
   * immediately with the current value, then on every change, returning an
   * unsubscribe. When a `delay` is configured the value only flips to `true`
   * after the navigation has been pending that long (the debounce that prevents
   * prefetch-fast navigations from flashing the indicator).
   */
  readonly pending: LiveSignal<boolean>
}

export interface NavigationProgressOptions {
  /**
   * Anti-flash debounce, in milliseconds. The `pending` signal only becomes
   * `true` once a navigation has been in flight for `delay` ms, so navigations
   * that resolve faster than that (e.g. served from a hover prefetch) never
   * reveal the indicator. The end transition always settles `pending` to `false`
   * immediately, cancelling any not-yet-fired reveal. Default `0` (reveal
   * immediately on navigation start).
   */
  delay?: number
}

/**
 * Create a {@link NavigationProgress} handle. See the interface docs for the
 * three-file wiring and binding patterns.
 */
export function createNavigationProgress(options?: NavigationProgressOptions): NavigationProgress {
  const delay = options?.delay ?? 0

  const subs = new Set<(pending: boolean) => void>()
  let published = false
  let revealTimer: ReturnType<typeof setTimeout> | null = null

  function publish(next: boolean): void {
    if (next === published) return
    published = next
    for (const cb of subs) cb(next)
  }

  function clearReveal(): void {
    if (revealTimer !== null) {
      clearTimeout(revealTimer)
      revealTimer = null
    }
  }

  const pending: LiveSignal<boolean> = {
    peek: () => published,
    bind: (cb) => {
      subs.add(cb)
      cb(published) // immediate fire with current value (LiveSignal contract)
      return () => {
        subs.delete(cb)
      }
    },
  }

  // Arrow functions so destructuring/re-export keeps them bound to this handle.
  const onPageTransitionStart = (): void => {
    if (delay > 0) {
      clearReveal()
      revealTimer = setTimeout(() => {
        revealTimer = null
        publish(true)
      }, delay)
    } else {
      publish(true)
    }
  }

  const onPageTransitionEnd = (): void => {
    clearReveal()
    publish(false)
  }

  return { onPageTransitionStart, onPageTransitionEnd, pending }
}
