// Context (build-time dependency injection) + portal.
//
// `provide` sets a value for the subtree it wraps; `useContext` reads the nearest
// provided value (or the default). Values may be plain or signals (a reactive
// context is just a Signal value). `portal` renders content into a target outside
// the inline flow (overlays) while keeping its bindings in the current scope.

import { requireCtx, getBuildCtx, materialize, mountable, type Mountable } from './build-context.js'
import type { Renderable } from './element.js'

/** Render `content` into `target` (default `document.body`) instead of inline —
 * for overlays (dialog/popover/toast). The content's bindings join the current
 * scope (so it stays reactive); a teardown removes the nodes on unmount/dispose.
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
  const nodes = content().map(materialize) // specs collected into the current build → reactive
  for (const n of nodes) host.appendChild(n)
  c.teardowns.push(() => {
    for (const n of nodes) if (n.parentNode === host) host.removeChild(n)
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
  // Copy-on-write: the build shares its parent's contexts map by reference until
  // the first provide, which clones a private copy so the mutation doesn't leak to
  // the parent or sibling builds.
  if (!c.ownContexts) {
    c.contexts = new Map(c.contexts)
    c.ownContexts = true
  }
  const m = c.contexts as Map<symbol, unknown>
  const had = m.has(context.id)
  const prev = m.get(context.id)
  m.set(context.id, value)
  const frag = c.doc.createDocumentFragment()
  try {
    for (const n of render()) frag.appendChild(materialize(n))
  } finally {
    if (had) m.set(context.id, prev)
    else m.delete(context.id)
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
