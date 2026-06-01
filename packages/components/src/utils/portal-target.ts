/**
 * Resolve an overlay's portal target SSR-safely.
 *
 * An overlay's host is resolved at `overlay()` build time, which runs on the
 * SERVER too (SSR renders the whole view). Touching `document` there throws
 * `ReferenceError: document is not defined`. A string selector is therefore
 * resolved against `document` ONLY in a browser; on the server we return
 * `undefined` and let `portal()` fall back to the env's `doc.body`. Overlays are
 * gated behind `show(state.open)`, so a closed overlay never mounts its portal on
 * the server anyway — the guard just keeps the eager host resolution from
 * crashing the SSR render.
 */
export function resolvePortalTarget(target: string | Element): Element | undefined {
  if (typeof target !== 'string') return target
  if (typeof document === 'undefined') return undefined
  return document.querySelector(target) ?? document.body
}
