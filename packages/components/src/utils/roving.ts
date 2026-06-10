import { flipArrow } from './direction.js'

/**
 * Headless roving-tablist navigation — the keyboard logic of a WAI-ARIA
 * tablist, decoupled from any particular DOM contract.
 *
 * `components/tabs.ts` builds its reactive part-bags on top of this; a
 * consumer that wants its OWN markup (different classes, ids, no
 * `data-scope`/`data-part`) can drive the same keyboard behaviour by
 * calling `resolveRovingMove` from its trigger's `onKeyDown` and
 * `focusRovingTab` to move DOM focus — without adopting the component's
 * markup or its `connect()` state machine.
 *
 * The resolver is pure (key + current value + items → a move); the only
 * shared DOM assumption lives in `focusRovingTab`, and it is the minimal
 * one both surfaces already satisfy: triggers carry `role="tab"` and
 * `data-value="<value>"`.
 */

export type RovingOrientation = 'horizontal' | 'vertical'

export interface RovingItem {
  value: string
  /** Disabled items are skipped by arrow/Home/End navigation. */
  disabled?: boolean
}

export interface RovingOptions {
  /** Arrow axis — 'horizontal' uses Left/Right, 'vertical' uses Up/Down. Default 'horizontal'. */
  orientation?: RovingOrientation
  /** Whether arrow navigation wraps at the ends. Default true. */
  loop?: boolean
  /**
   * An element used to resolve text direction for RTL arrow flipping
   * (typically the event's `currentTarget`). When it resolves to
   * `dir="rtl"`, ArrowLeft/ArrowRight swap. Optional.
   */
  element?: Element | null
}

/** The navigation a key implies on a roving tablist. */
export type RovingMove =
  /** An arrow / Home / End resolved to a (different, enabled) tab value. */
  | { type: 'focus'; value: string }
  /** Enter or Space — activate the currently focused tab (manual mode). */
  | { type: 'activate' }

export function firstEnabled(items: readonly string[], disabled: readonly string[]): string | null {
  for (const v of items) if (!disabled.includes(v)) return v
  return null
}

export function lastEnabled(items: readonly string[], disabled: readonly string[]): string | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const v = items[i]!
    if (!disabled.includes(v)) return v
  }
  return null
}

export function nextEnabled(
  items: readonly string[],
  disabled: readonly string[],
  from: string,
  delta: 1 | -1,
  loop: boolean,
): string | null {
  if (items.length === 0) return null
  const idx = items.indexOf(from)
  if (idx === -1) return firstEnabled(items, disabled)
  const n = items.length
  for (let i = 1; i <= n; i++) {
    const rawIdx = idx + delta * i
    if (!loop && (rawIdx < 0 || rawIdx >= n)) return null
    const next = items[(rawIdx + n * n) % n]!
    if (!disabled.includes(next)) return next
  }
  return null
}

/**
 * Map a keyboard key + the current tab value to a roving-tablist move,
 * or `null` when the key isn't a navigation/activation key or the move is
 * a no-op (empty list, no enabled sibling). Pure — does not touch the DOM
 * or call `preventDefault`; the caller decides (typically: prevent default
 * iff the result is non-null).
 */
export function resolveRovingMove(
  key: string,
  current: string,
  items: readonly RovingItem[],
  opts: RovingOptions = {},
): RovingMove | null {
  const orientation = opts.orientation ?? 'horizontal'
  const loop = opts.loop ?? true
  const values = items.map((it) => it.value)
  const disabled = items.filter((it) => it.disabled === true).map((it) => it.value)

  const k = flipArrow(key, opts.element ?? null)
  const nextKey = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight'
  const prevKey = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft'

  const focus = (value: string | null): RovingMove | null =>
    value === null ? null : { type: 'focus', value }

  switch (k) {
    case nextKey:
      return focus(nextEnabled(values, disabled, current, 1, loop))
    case prevKey:
      return focus(nextEnabled(values, disabled, current, -1, loop))
    case 'Home':
      return focus(firstEnabled(values, disabled))
    case 'End':
      return focus(lastEnabled(values, disabled))
    case 'Enter':
    case ' ':
      return { type: 'activate' }
    default:
      return null
  }
}

/**
 * Move DOM focus to the trigger whose `data-value` matches, within
 * `container`. Relies only on the `role="tab"` + `data-value` contract
 * (shared by `components/tabs` and any hand-rolled tablist). No-op when no
 * trigger matches. Call after the DOM reflects the new active tab (e.g. in
 * a microtask if activation triggers a re-render).
 */
export function focusRovingTab(container: Element, value: string): void {
  const escaped =
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(value) : value
  const el = container.querySelector(`[role="tab"][data-value="${escaped}"]`)
  if (el instanceof HTMLElement) el.focus()
}
