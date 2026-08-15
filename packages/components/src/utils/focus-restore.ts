/**
 * The one rule for "should this layer pull focus back to its anchor?".
 *
 * Restoring focus to the trigger is right when the layer was closed with focus
 * still resting inside it (Escape, a close button, a programmatic close) — the
 * user's focus would otherwise be left on a detached node. It is WRONG when the
 * dismissal was caused by focus moving somewhere the user chose: yanking it back
 * to the trigger takes focus away from the control they just reached, and can
 * leave a still-open layer with focus outside it (#173).
 *
 * `document.body` (and a null `activeElement`) counts as "inside" because that
 * is where focus lands when the focused element is removed — nobody chose it, so
 * the anchor is a better home than the body.
 *
 * Both callers must ask BEFORE tearing anything down: the focus trap's release
 * and the `aria-hidden`/`inert` sweep both move or invalidate `activeElement`,
 * so a decision taken after them is a decision about the engine's own cleanup.
 */

export interface FocusRestoreQuery {
  /** The region that counts as "inside" this layer. */
  boundary: Element
  /** The element focus would be restored TO. */
  anchor?: Element | null
  /**
   * Also treat the anchor itself being focused as "inside" (`select`, which
   * focuses its own trigger on open — without this its restore reads as "the
   * user moved focus to the trigger" and never runs).
   */
  allowAnchorActive?: boolean
}

/**
 * Whether focus LINGERED INSIDE the layer, i.e. whether restoring it to the
 * anchor respects the user rather than overriding them.
 */
export function focusLingeredInside(query: FocusRestoreQuery): boolean {
  if (typeof document === 'undefined') return false
  const active = document.activeElement
  return (
    query.boundary.contains(active) ||
    (query.allowAnchorActive === true && active !== null && active === query.anchor) ||
    active === document.body ||
    active === null
  )
}
