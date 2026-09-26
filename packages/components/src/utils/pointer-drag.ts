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
  /** The browser can revoke pointer capture without ever firing `pointerup`/
   * `pointercancel` (an OS-level interruption, a nested capture request, …).
   * Left unwired, `dragging` would stay `true` forever and a later, UNRELATED
   * pointer's `pointermove` would be misread as a continuation of this drag.
   * Spread onto the same element as the other four. */
  onLostPointerCapture: (e: PointerEvent) => void
}

/**
 * Build the five pointer handlers for one drag track. One call per live
 * `connect()` instance — `dragging`/`activePointerId` are closure-scoped per
 * instance, the same shape as this package's other per-instance mutable state
 * (e.g. `color-picker`'s eyedropper `pendingEyeDropper` AbortController).
 *
 * - Primary button only on `pointerdown` (`e.button !== 0` is ignored), AND
 *   only when no drag is already live — a second finger/pointer touching
 *   down mid-drag is ignored rather than hijacking `activePointerId`.
 * - Every subsequent event (`pointermove`/`pointerup`/`pointercancel`/
 *   `onLostPointerCapture`) is checked against `activePointerId`: a second
 *   pointer's events never affect a drag it didn't start.
 * - `setPointerCapture` on `pointerdown`'s `currentTarget`, so `pointermove`
 *   keeps firing even once the pointer leaves the element's bounds — a
 *   plain drag with no capture stalls out at the track's edge instead of
 *   saturating like a native `<input type="range">`.
 * - Released on `pointerup`/`pointercancel`, guarded by `hasPointerCapture`
 *   so releasing twice (or without ever capturing) is a harmless no-op.
 * - `dragging` is unconditionally reset on `onLostPointerCapture` for the
 *   active pointer, even though that handler never calls `release()` itself
 *   (capture is already gone by definition when this fires).
 */
export function pointerDragHandlers(callbacks: PointerDragCallbacks): PointerDragHandlers {
  let dragging = false
  let activePointerId: number | null = null

  const release = (e: PointerEvent): void => {
    const target = e.currentTarget as Element
    if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId)
  }

  const end = (e: PointerEvent): void => {
    dragging = false
    activePointerId = null
    callbacks.onDragEnd?.(e)
  }

  const isActive = (e: PointerEvent): boolean => dragging && e.pointerId === activePointerId

  return {
    onPointerDown: (e) => {
      if (dragging || callbacks.isDisabled() || e.button !== 0) return
      dragging = true
      activePointerId = e.pointerId
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
      callbacks.onDragStart?.(e)
      callbacks.onDrag(e)
    },
    onPointerMove: (e) => {
      if (!isActive(e)) return
      callbacks.onDrag(e)
    },
    onPointerUp: (e) => {
      if (!isActive(e)) return
      release(e)
      end(e)
    },
    onPointerCancel: (e) => {
      if (!isActive(e)) return
      release(e)
      end(e)
    },
    onLostPointerCapture: (e) => {
      if (!isActive(e)) return
      end(e)
    },
  }
}
