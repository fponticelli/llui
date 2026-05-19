/**
 * `clientOnly()` — a view primitive that marks a subtree as browser-only.
 *
 * Problem it solves: some widgets can't render on the server. Leaflet,
 * Chart.js, Monaco, and most imperative browser libraries touch `window`
 * or `document` at construction time. Wrapping them in `clientOnly`
 * means SSR never invokes the render callback — the server emits a
 * placeholder (optionally backed by a user-supplied fallback subtree)
 * and the real render happens at client mount / hydrate time.
 *
 * How it works:
 *
 *   - SSR (env without `isBrowser`): emits
 *     `<!--llui-client-only-start-->` + fallback nodes (if any) +
 *     `<!--llui-client-only-end-->`. The `render` callback is never
 *     invoked.
 *   - Client mount / hydrate (env with `isBrowser: true`): runs `render`
 *     inline. Because LLui's hydration is an atomic swap — the client
 *     builds fresh DOM and `container.replaceChildren` wipes the server
 *     HTML — no anchor walking or fallback disposal is needed on the
 *     client side. The client simply produces its DOM; the SSR output
 *     is discarded by `replaceChildren`.
 *
 * State threading: `render` and `fallback` both receive a `View<S, M>`
 * bag keyed to the host component's state, so inner `text`, `branch`,
 * `each`, etc. behave the same as if the primitive weren't there.
 *
 * Gating heavy imports: if the library itself can't be imported on the
 * server, put the import INSIDE `render` via dynamic `import()`:
 *
 *     ...clientOnly({
 *       fallback: () => [div({ class: 'skeleton' })],
 *       render: () => [foreign({
 *         create: async (el) => {
 *           const L = await import('leaflet')
 *           return L.map(el).setView([0, 0], 13)
 *         },
 *         // ...
 *       })],
 *     })
 *
 * The bundler sees `import('leaflet')` only from the client-reachable
 * code path; the SSR bundle elides it.
 */

import type { ComponentDef } from '../types.js'
import { getRenderContext } from '../render-context.js'
import { createView, type View } from '../view-helpers.js'

declare global {
  interface ImportMeta {
    env?: { DEV?: boolean; MODE?: string }
  }
}

export interface ClientOnlyOptions<S, M> {
  /**
   * Browser-only render callback. Invoked on client mount and hydrate.
   * NEVER invoked during SSR (`renderToString` / `renderNodes`). Free
   * to touch `window`, `document`, or import browser-only modules.
   */
  render: (bag: View<S, M>) => Node[]

  /**
   * Server-rendered stand-in. When present, SSR runs `fallback` and
   * serializes its output into the HTML between the anchor comments.
   * Useful for skeleton/shimmer loaders and to preserve layout width
   * before the client widget mounts.
   *
   * Omit to emit only the anchor pair — zero layout impact until the
   * client mounts, which may cause content shift.
   *
   * Both `render` and `fallback` receive the same `View<S, M>` bag;
   * state-dependent fallback bindings are evaluated once at SSR time.
   */
  fallback?: (bag: View<S, M>) => Node[]
}

/**
 * Mark a view subtree as browser-only. See module doc comment for the
 * full semantics.
 *
 * Returns `Node[]` — spread into a parent element's children array.
 *
 * ```ts
 * view: () => [
 *   div({ class: 'dashboard' }, [
 *     ...clientOnly({
 *       fallback: () => [div({ class: 'chart-skeleton' })],
 *       render: () => [foreign({ create: (el) => new Chart(el, cfg) })],
 *     }),
 *   ]),
 * ]
 * ```
 */
export function clientOnly<S, M = unknown>(opts: ClientOnlyOptions<S, M>): Node[] {
  const ctx = getRenderContext('clientOnly')
  const send = ctx.send as (msg: M) => void
  // v0.4 Tier 1.2: bag from the owning compiled component's __view factory.
  // createView fallback is gated for tests and dead in production.
  const inst = ctx.instance as { def?: { __view?: (s: unknown) => unknown } } | undefined
  const ownerView = inst?.def?.__view
  const bag = (
    ownerView
      ? ownerView(send as unknown)
      : import.meta.env?.MODE !== 'production'
        ? createView<S, M>(send)
        : { send }
  ) as View<S, M>

  // `ctx.dom.isBrowser` is the discriminator — it's true only when the
  // env wraps the live browser globals (see `browserEnv()`). SSR envs
  // (`jsdomEnv`, `linkedomEnv`, custom adapters) don't set it. This
  // check lets `clientOnly` choose behavior without the primitive
  // needing to know about `renderToString` vs `mountApp` call sites.
  if (ctx.dom.isBrowser) {
    return opts.render(bag)
  }

  const start = ctx.dom.createComment('llui-client-only-start')
  const end = ctx.dom.createComment('llui-client-only-end')
  const fallbackNodes = opts.fallback ? opts.fallback(bag) : []
  return [start, ...fallbackNodes, end]
}

/**
 * Generated component stub used by `@llui/vite-plugin`'s `'use client'`
 * directive. For SSR builds, every `export const X = component({...})`
 * in a `'use client'` module is rewritten to
 * `export const X = __clientOnlyStub('X')` — the module's real imports
 * and top-level side effects never run under SSR.
 *
 * The stub is a minimal valid `ComponentDef` whose `view()` emits a
 * `clientOnly` placeholder. The client build imports the ORIGINAL
 * module (directive is a no-op on client), so the real component mounts
 * on hydrate; atomic-swap wipes the SSR stub's empty placeholder.
 *
 * State shape is `{}` and message type is `never` — the stub doesn't
 * participate in any real update cycle. Callers that tried to `send()`
 * messages against the stub during SSR would be dispatching into the
 * void, which is fine: SSR doesn't process messages.
 *
 * App authors should not call this directly — reach for `clientOnly`
 * or the `'use client'` directive depending on the granularity you
 * want.
 */
export function __clientOnlyStub(name: string): ComponentDef<object, never, never> {
  return {
    name,
    init: () => [{}, []],
    update: (s) => [s, []],
    view: () => clientOnly<object, never>({ render: () => [] }),
  }
}
