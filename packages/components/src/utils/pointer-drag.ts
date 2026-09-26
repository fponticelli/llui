/**
 * Pointer-capture drag lifecycle for a "drag over a track" control — the
 * MACHINE-owned counterpart to what `slider.ts`/`angle-slider.ts` push onto
 * the consumer (both explicitly leave pointer wiring to a view-level
 * `onMount`, per their own module doc comments; `color-picker`'s 2D area
 * needs the same four handlers, so this is the one place the pattern lives
 * rather than a second copy). Pure event-lifecycle bookkeeping — no DOM
 * queries beyond `e.currentTarget`, no framework imports.
 */

/** One call site's drag callbacks. */
export interface PointerDragCallbacks {
  /** Checked on `pointerdown` only — a drag that is already underway keeps
   * running even if this flips true mid-drag (the reducer's own `disabled`
   * guard is the actual safety net for a message dispatched from `onDrag`
   * after that point; this only decides whether a NEW drag may start). */
  isDisabled: () => boolean
  /** Fires once, on `pointerdown`, after capture is acquired and BEFORE the
   * first `onDrag` call — the hook for a one-time side effect like moving
   * focus onto a thumb element. */
  onDragStart?: (e: PointerEvent) => void
  /** Fires on `pointerdown` (immediately after `onDragStart`) and again on
   * every `pointermove` while the drag is live. */
  onDrag: (e: PointerEvent) => void
  /** Fires once on `pointerup`/`pointercancel`, but ONLY when a drag was
   * actually live (never on a stray up/cancel with no matching down) — the
   * counterpart to `onDragStart`, for a caller that tracks per-drag identity
   * across the lifecycle (`gradient-picker`'s track drag creates a new stop
   * on `pointerdown` and must stop targeting it once the drag ends). Runs
   * AFTER pointer capture is released. */
  onDragEnd?: (e: PointerEvent) => void
}

export interface PointerDragHandlers {
  onPointerDown: (e: PointerEvent) => void
  onPointerMove: (e: PointerEvent) => void
  onPointerUp: (e: PointerEvent) => void
  onPointerCancel: (e: PointerEvent) => void
}

/**
 * Build the four pointer handlers for one drag track. One call per live
 * `connect()` instance — `dragging` is closure-scoped per instance, the same
 * shape as this package's other per-instance mutable state (e.g.
 * `color-picker`'s eyedropper `pendingEyeDropper` AbortController).
 *
 * - Primary button only (`e.button !== 0` on `pointerdown` is ignored —
 *   `pointermove`/`pointerup` never carry a meaningful `button`, so they are
 *   never re-checked; a drag that started validly keeps running).
 * - `setPointerCapture` on `pointerdown`'s `currentTarget`, so `pointermove`
 *   keeps firing even once the pointer leaves the element's bounds — a
 *   plain drag with no capture stalls out at the track's edge instead of
 *   saturating like a native `<input type="range">`.
 * - Released on `pointerup`/`pointercancel`, guarded by `hasPointerCapture`
 *   so releasing twice (or without ever capturing) is a harmless no-op.
 */
export function pointerDragHandlers(callbacks: PointerDragCallbacks): PointerDragHandlers {
  let dragging = false

  const release = (e: PointerEvent): void => {
    const target = e.currentTarget as Element
    if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId)
  }

  return {
    onPointerDown: (e) => {
      if (callbacks.isDisabled() || e.button !== 0) return
      dragging = true
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
      callbacks.onDragStart?.(e)
      callbacks.onDrag(e)
    },
    onPointerMove: (e) => {
      if (!dragging) return
      callbacks.onDrag(e)
    },
    onPointerUp: (e) => {
      if (!dragging) return
      dragging = false
      release(e)
      callbacks.onDragEnd?.(e)
    },
    onPointerCancel: (e) => {
      if (!dragging) return
      dragging = false
      release(e)
      callbacks.onDragEnd?.(e)
    },
  }
}
