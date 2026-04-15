import { hydrateApp, mountApp } from '@llui/dom'
import type { ComponentDef, AppHandle, TransitionOptions } from '@llui/dom'

declare global {
  interface Window {
    __LLUI_STATE__?: unknown
  }
}

export interface ClientPageContext {
  Page: ComponentDef<unknown, unknown, unknown, unknown>
  data?: unknown
  isHydration?: boolean
}

/**
 * Page-lifecycle hooks that fire around the dispose → clear → mount
 * sequence on client navigation. Use these to animate page transitions,
 * save scroll state, emit analytics events, or defer the swap behind
 * any async work that must complete before the next page appears.
 *
 * The sequence is:
 *
 * ```
 *   client nav triggered
 *     │
 *     ▼
 *   onLeave(el)   ← awaited if it returns a promise
 *     │              (the outgoing page's DOM is still mounted here)
 *     ▼
 *   currentHandle.dispose()
 *     │              (all scopes torn down — portals, focus traps,
 *     │               onMount cleanups all fire synchronously here)
 *     ▼
 *   el.textContent = ''
 *     │              (old DOM removed)
 *     ▼
 *   mountApp(el, Page, data)
 *     │              (new page mounted)
 *     ▼
 *   onEnter(el)   ← not awaited; animate in-place
 *     │
 *     ▼
 *   onMount()     ← legacy shim, still fires last
 * ```
 *
 * On the initial render (hydration), `onLeave` and `onEnter` are NOT
 * called — there's no outgoing page to leave and no animation to enter.
 * If you need to run code after hydration, use `onMount`.
 */
export interface RenderClientOptions {
  /** CSS selector for the mount container. Default: '#app' */
  container?: string

  /**
   * Called on the outgoing page's container BEFORE dispose + clear + mount.
   * Return a promise to defer the swap until the leave animation finishes.
   * The container element is passed as the argument — its children are
   * still the previous page's DOM at this point.
   *
   * Not called on the initial hydration render.
   */
  onLeave?: (el: HTMLElement) => void | Promise<void>

  /**
   * Called after the new page is mounted into the container. Use this to
   * kick off an enter animation on the freshly-rendered content. Not
   * awaited — if you return a promise, the resolution is ignored.
   *
   * Not called on the initial hydration render.
   */
  onEnter?: (el: HTMLElement) => void

  /**
   * Called after mount or hydration completes. Fires on every render
   * including the initial hydration. Use this for per-render side
   * effects that don't fit the animation hooks (analytics, focus
   * management, etc.).
   */
  onMount?: () => void
}

/**
 * Adapt a `TransitionOptions` object (e.g. the output of
 * `routeTransition()` from `@llui/transitions`, or any preset like
 * `fade()` / `slide()`) into the `onLeave` / `onEnter` shape expected
 * by `createOnRenderClient`.
 *
 * ```typescript
 * import { createOnRenderClient, fromTransition } from '@llui/vike/client'
 * import { routeTransition } from '@llui/transitions'
 *
 * export const onRenderClient = createOnRenderClient({
 *   ...fromTransition(routeTransition({ duration: 200 })),
 * })
 * ```
 *
 * The transition operates on the container element itself — its
 * opacity / transform fades out the outgoing page, then the new page
 * fades in when it mounts. If the preset doesn't restore its starting
 * style on `leave`, the container may still carry leftover properties
 * when the new page mounts; use `enter` to reset them explicitly or
 * pick presets that self-clean.
 */
export function fromTransition(
  t: TransitionOptions,
): Pick<RenderClientOptions, 'onLeave' | 'onEnter'> {
  return {
    onLeave: t.leave
      ? (el): void | Promise<void> => {
          const result = t.leave!([el])
          return result && typeof (result as Promise<void>).then === 'function'
            ? (result as Promise<void>)
            : undefined
        }
      : undefined,
    onEnter: t.enter
      ? (el): void => {
          t.enter!([el])
        }
      : undefined,
  }
}

// Track the current app handle so we can dispose it on client navigation.
// Module-level state: there's exactly one Vike-managed app per page load.
let currentHandle: AppHandle | null = null

/**
 * @internal — test helper. Disposes the current handle (if any) and clears
 * the module-level state so subsequent calls behave as a first mount.
 * Not part of the public API; subject to change without notice.
 */
export function _resetCurrentHandleForTest(): void {
  if (currentHandle) {
    currentHandle.dispose()
    currentHandle = null
  }
}

/**
 * Default onRenderClient hook — no animation hooks. Hydrates if
 * `isHydration` is true, otherwise mounts fresh. Use `createOnRenderClient`
 * for the customizable factory form.
 */
export async function onRenderClient(pageContext: ClientPageContext): Promise<void> {
  await renderClient(pageContext, {})
}

/**
 * Factory to create a customized onRenderClient hook.
 *
 * ```typescript
 * // pages/+onRenderClient.ts
 * import { createOnRenderClient } from '@llui/vike/client'
 *
 * export const onRenderClient = createOnRenderClient({
 *   container: '#root',
 *   onLeave: (el) => el.animate({ opacity: [1, 0] }, 200).finished,
 *   onEnter: (el) => el.animate({ opacity: [0, 1] }, 200),
 *   onMount: () => console.log('Page ready'),
 * })
 * ```
 */
export function createOnRenderClient(
  options: RenderClientOptions,
): (pageContext: ClientPageContext) => Promise<void> {
  return (pageContext) => renderClient(pageContext, options)
}

async function renderClient(
  pageContext: ClientPageContext,
  options: RenderClientOptions,
): Promise<void> {
  const { Page } = pageContext
  const selector = options.container ?? '#app'
  const container = document.querySelector(selector)

  if (!container) {
    throw new Error(`@llui/vike: container "${selector}" not found in DOM`)
  }

  const el = container as HTMLElement

  // Dispose the previous page's component on client navigation. If the
  // caller supplied an onLeave hook and this isn't the initial hydration,
  // await it BEFORE tearing down — that's the only moment where the
  // outgoing page's DOM still exists for an animation to read/write.
  if (currentHandle) {
    if (!pageContext.isHydration && options.onLeave) {
      await options.onLeave(el)
    }
    currentHandle.dispose()
    currentHandle = null
  }

  if (pageContext.isHydration) {
    const serverState = window.__LLUI_STATE__
    currentHandle = hydrateApp(el, Page, serverState)
  } else {
    // Clear old DOM before mounting the new page
    el.textContent = ''
    currentHandle = mountApp(el, Page, pageContext.data)
    // onEnter fires AFTER mount so the hook can animate the freshly
    // rendered children. It's intentionally sync — a promise return is
    // ignored, matching typical enter-animation ergonomics (fire-and-forget).
    options.onEnter?.(el)
  }

  options.onMount?.()
}
