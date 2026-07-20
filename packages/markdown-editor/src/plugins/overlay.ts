// Shared overlay primitive for plugin-UI surfaces (context menu, slash/mention
// typeaheads, floating toolbar, table tools). Every one of these is a portaled,
// viewport-positioned panel whose `{ open, x, y }` lives in pure, JSON state and
// is rendered with `show → portal → fixed-positioned div`. Factoring that single
// shape here keeps positioning testable (a plain style string, not imperative
// floating-ui calls) and removes the copy-paste that otherwise accumulates one
// near-identical state machine per overlay plugin.
//
// Anchored positioning via `@llui/components`' `attachFloating` (floating-ui) was
// considered: it gives flip/shift/auto-update for free but needs a live element
// ref and async, jsdom-untestable DOM writes — a poor fit for overlays whose
// position is derived from a transient caret/pointer/element rect each `register`
// tick. The pure-state idiom below covers scroll/resize via {@link onViewportChange}.
//
// ## Stacking order (z-index)
// A single documented scale so overlays never tie and obscure each other:
//   60 — typeaheads (slash, mention)        — caret-anchored, lowest
//   61 — context menu                        — pointer-anchored
//   62 — floating selection toolbar          — selection-anchored bubble
//   63 — table tools                         — element-anchored, sits over a table
//   64 — code-block language badge           — element-anchored, may sit INSIDE a
//                                              table cell, so it must clear 63
// The values live with each plugin's view; this comment is the source of truth.

import {
  div,
  derived,
  onMount,
  portal,
  show,
  type Mountable,
  type Renderable,
  type Signal,
} from '@llui/dom'
import { registerNestedLayer } from '@llui/components/utils'

export const OVERLAY_Z = {
  typeahead: 60,
  contextMenu: 61,
  floatingToolbar: 62,
  tableTools: 63,
  // Strictly above `tableTools`: a fenced code block can live inside a table
  // cell, in which case both surfaces are open at once. At an equal z-index the
  // clickable one was decided by portal insertion order — i.e. by plugin array
  // order — which is exactly the no-tie rule this scale exists to prevent.
  codeLanguage: 64,
} as const

const toMountables = (r: Renderable): Mountable[] => [...r]

// Unique marker per overlay instance so its portal root can be located while
// open. Every overlayRoot is a body-level sibling portal; without declaring it
// as a nested layer, a host `dialog.overlay()` mis-reads an interaction inside
// it as "outside" and dismisses (see @llui/components registerNestedLayer).
let layerSeq = 0
const NESTED_LAYER_ATTR = 'data-llui-nested-layer'

export interface OverlayRootConfig {
  /** Whether the overlay is shown. */
  open: Signal<boolean>
  /** Viewport x of the anchor point (px). */
  x: Signal<number>
  /** Viewport y of the anchor point (px). */
  y: Signal<number>
  /** Stacking level — use {@link OVERLAY_Z}. */
  zIndex: number
  /** Extra CSS appended after positioning (e.g. a centering/lift transform). */
  transform?: string
  /** Attributes for the positioned element (`data-scope`/`data-part`, handlers). */
  attrs: Record<string, unknown>
  /** Optional siblings rendered inside the portal before the root (e.g. a backdrop). */
  before?: () => Renderable
  /** The positioned element's children. */
  children: () => Renderable
}

/**
 * A portaled, `position:fixed` overlay placed at `(x, y)` and shown while `open`.
 * Returns the `Renderable` a plugin's `view` yields directly. The emitted style is
 * a deterministic string — `position:fixed;left:${x}px;top:${y}px;z-index:${z}` plus
 * an optional `transform` — so positioning is unit-testable.
 */
export function overlayRoot(cfg: OverlayRootConfig): Renderable {
  const style = derived(
    cfg.x,
    cfg.y,
    (x, y) =>
      `position:fixed;left:${x}px;top:${y}px;z-index:${cfg.zIndex}` +
      (cfg.transform ? `;${cfg.transform}` : ''),
  ) as Signal<string>
  const layerId = `mdo-${++layerSeq}`
  return [
    // Register once for the overlay's lifetime; the resolver returns the live
    // portal root only while open (and nothing when closed/unmounted), so the
    // single registration tracks open/closed without per-toggle churn.
    onMount(() =>
      registerNestedLayer(() => {
        if (typeof document === 'undefined') return []
        const el = document.querySelector(`[${NESTED_LAYER_ATTR}="${layerId}"]`)
        return el ? [el] : []
      }),
    ),
    show(cfg.open, () => [
      portal(() => [
        ...(cfg.before ? toMountables(cfg.before()) : []),
        div({ ...cfg.attrs, [NESTED_LAYER_ATTR]: layerId, style }, toMountables(cfg.children())),
      ]),
    ]),
  ]
}

/** Guarded close: collapse `open` to false, preserving the reference when already
 * closed so the host doesn't reconcile a no-op. */
export function hideOverlay<S extends { open: boolean }>(state: S): S {
  return state.open ? { ...state, open: false } : state
}

/**
 * Run `run` (debounced to one call per animation frame) whenever the viewport
 * changes — any ancestor scroll or a window resize. Overlays anchored to a
 * persistent element (a table) or a live selection must reposition on scroll;
 * editor update listeners alone never fire for a plain scroll. Returns a cleanup
 * that removes the listeners. No-op (and cleanup is a no-op) outside the browser.
 */
export function onViewportChange(run: () => void): () => void {
  if (typeof window === 'undefined' || typeof requestAnimationFrame !== 'function') {
    return () => {}
  }
  let pending = 0
  const handler = (): void => {
    if (pending) return
    pending = requestAnimationFrame(() => {
      pending = 0
      run()
    })
  }
  // Capture phase so scrolls in any nested scroll container are caught.
  window.addEventListener('scroll', handler, true)
  window.addEventListener('resize', handler)
  return () => {
    window.removeEventListener('scroll', handler, true)
    window.removeEventListener('resize', handler)
    if (pending) cancelAnimationFrame(pending)
  }
}
