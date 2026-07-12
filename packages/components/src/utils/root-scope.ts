/**
 * Resolve an element by id within the DOM tree that `ref` belongs to.
 *
 * `ref.getRootNode()` returns the enclosing `Document` in light DOM, or the
 * `ShadowRoot` when `ref` lives inside a shadow tree — both expose
 * `getElementById`. Overlays resolve their trigger/content parts through this
 * (passing the `onMount` root, which shares the parts' tree) so floating
 * positioning still anchors when the component is mounted inside a shadow root
 * (isolate mode): the global `document.getElementById` cannot see into shadow
 * trees and silently returns `null`, which no-ops the anchor.
 *
 * Light-DOM behavior is identical to `document.getElementById`: a node attached
 * to the main document roots to that `Document`. A detached `ref` (its root is a
 * bare element/fragment without `getElementById`) falls back to the global
 * `document` so callers keep working.
 */
export function getElementByIdInScope(ref: Node, id: string): HTMLElement | null {
  const root = ref.getRootNode()
  if (root instanceof Document || root instanceof ShadowRoot) {
    return root.getElementById(id)
  }
  return typeof document === 'undefined' ? null : document.getElementById(id)
}
