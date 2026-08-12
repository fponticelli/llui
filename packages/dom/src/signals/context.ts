// Context (build-time dependency injection) + portal.
//
// `provide` sets a value for the subtree it wraps; `useContext` reads the nearest
// provided value (or the default). Values may be plain or signals (a reactive
// context is just a Signal value). `portal` renders content into a target outside
// the inline flow (overlays) while keeping its bindings in the current scope.

import { requireCtx, getBuildCtx, materialize, mountable, type Mountable } from './build-context.js'
import { removeBetween } from './dom-region.js'
import type { Renderable } from './element.js'

/** Render `content` into `target` (default `document.body`) instead of inline —
 * for overlays (dialog/popover/toast). The content's bindings join the current
 * scope (so it stays reactive); the content occupies an anchor-bracketed region in
 * the host, and a teardown clears that WHOLE region on unmount/dispose — including
 * anything a nested structural child (each/show/branch) mounted into it.
 * Returns an inline placeholder comment. */
export function portal(content: () => Renderable, target?: Element): Mountable {
  return mountable(() => buildPortal(content, target))
}

function buildPortal(content: () => Renderable, target?: Element): Node {
  const c = requireCtx()
  const host = target ?? c.doc.body
  if (!host) {
    // SSR / no document.body: portals are client-only. Render nothing here rather
    // than throw — overlays (dialogs/popovers/toasts) are gated behind
    // `show(state.open)`, and even an open one is reconstructed by the client
    // hydrate pass (atomic-swap rebuild), which collects this content's bindings +
    // onMounts and appends them to the real `document.body`. SSR-rendering an
    // overlay into the page flow would be wrong anyway (it lives at body level).
    return c.doc.createComment('portal-ssr-skip')
  }
  // Bracket the portal's footprint in the host with anchor comments and tear it
  // down with the shared `removeBetween`, exactly as show/branch/unsafeHtml do.
  // Replaying a build-time node list is NOT sufficient: a nested structural
  // primitive (each/show/branch/virtualEach) materializes as a DocumentFragment
  // that EMPTIES into the host on insertion — so the snapshot holds a spent,
  // childless fragment — and every node it later reconciles in is a plain sibling
  // of that snapshot. None of it is captured, so an identity-based teardown left
  // the whole nested subtree attached to the host (a leak that grew with every
  // mount/unmount cycle). Anchors bound the region by POSITION instead, so
  // whatever lands inside it is removed, and two portals sharing one host stay
  // independent (each clears only its own pair).
  const start = c.doc.createComment('portal-content')
  const end = c.doc.createComment('/portal-content')
  host.appendChild(start)
  // specs collected into the current build → reactive (portal is NOT a scope
  // boundary); appended between the anchors so nested content lands in the region.
  for (const n of content()) host.appendChild(materialize(n))
  host.appendChild(end)
  c.teardowns.push(() => {
    removeBetween(start, end)
    // Unlike an inline primitive's anchors — which belong to the enclosing region
    // and are swept by ITS teardown — these were appended into a foreign host, so
    // this teardown owns them: remove them too, leaving the host as we found it.
    start.parentNode?.removeChild(start)
    end.parentNode?.removeChild(end)
  })
  return c.doc.createComment('portal')
}

// ── Context ─────────────────────────────────────────────────────────
// Build-time dependency injection: `provide` sets a value for the subtree it
// wraps; `useContext` reads the nearest provided value (or the default). Values
// may be plain or signals (a reactive context is just a Signal value).

export interface Context<T> {
  readonly id: symbol
  readonly default: T
}

export function createContext<T>(defaultValue: T, name = 'context'): Context<T> {
  return { id: Symbol(`llui.${name}`), default: defaultValue }
}

/** Provide `value` for `context` to everything `render` builds, then restore. */
export function provide<T>(context: Context<T>, value: T, render: () => Renderable): Mountable {
  return mountable(() => buildProvide(context, value, render))
}

function buildProvide<T>(context: Context<T>, value: T, render: () => Renderable): Node {
  const c = requireCtx()
  // Immutable-by-swap: build a NEW map (parent's entries + this value) and install it
  // as `c.contexts` for the duration of `render()`, then restore the PREVIOUS map
  // reference. We never mutate a published map, so the map that was live during
  // `render()` — the one a lazily-built `show`/`branch`/`each`/`lazy` arm snapshots at
  // its placement — keeps this value forever, even though `render()` returns (and this
  // restores the parent map) long before that arm actually builds. Mutate-and-restore
  // on the shared map (the old approach) deleted the value before the arm built, so
  // `useContext` inside any structural arm/row saw only the default.
  const prevMap = c.contexts
  const next = new Map(prevMap)
  next.set(context.id, value)
  c.contexts = next
  const frag = c.doc.createDocumentFragment()
  try {
    for (const n of render()) frag.appendChild(materialize(n))
  } finally {
    c.contexts = prevMap
  }
  return frag
}

/** Read the nearest provided value for `context`, or its default. Outside a
 * signal build (e.g. a unit test calling `connect()` directly) no provider can
 * exist, so the default is returned rather than throwing. */
export function useContext<T>(context: Context<T>): T {
  const ctx = getBuildCtx()
  if (!ctx) return context.default
  return ctx.contexts.has(context.id) ? (ctx.contexts.get(context.id) as T) : context.default
}
