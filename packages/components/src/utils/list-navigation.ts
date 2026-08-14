/**
 * List navigation — the ONE implementation of "which item comes next", shared
 * by every list-shaped component in the package.
 *
 * Five copies of this logic existed and they had already drifted (#126):
 * `toolbar` and `radio-group` carried private `nextEnabled`/`firstEnabled`
 * triples that dead-ended on an unknown `from` where the shared one restarted,
 * `radio-group` had no `loopFocus` at all, and the index-based variants in
 * `select`/`listbox`/`combobox` were a third dialect of the same walk. Worse,
 * the duplication cost a WCAG failure: `toggle-group` and `tree-view` forgot
 * the `focused`-pruning that `toolbar` remembered, so shrinking a list past the
 * focused item left the widget with NO tab stop (see `rovingTabStop`).
 *
 * Two families over the same rule:
 *  - VALUE-based (`firstEnabled`/`nextEnabled`/…) for widgets whose state keys
 *    off item values — the identity the whole package prefers.
 *  - INDEX-based (`firstEnabledIndex`/…) for the listbox family, whose ARIA
 *    contract is positional (`aria-activedescendant` by index).
 */

export type SelectionMode = 'single' | 'multiple'

/** An item counts as navigable only while it is in the list AND not disabled. */
export function isEnabledItem(
  items: readonly string[],
  disabled: readonly string[],
  value: string,
): boolean {
  return items.includes(value) && !disabled.includes(value)
}

/**
 * Keep `value` only while it still names an enabled item, else null. Every
 * reducer that replaces the item list owes this to whatever it holds as
 * focused/selected — a dangling reference is the tab-stop bug.
 */
export function pruneToEnabled(
  items: readonly string[],
  disabled: readonly string[],
  value: string | null,
): string | null {
  if (value === null) return null
  return isEnabledItem(items, disabled, value) ? value : null
}

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

/**
 * The next enabled value `delta` steps from `from`, or null when there is none
 * (empty list, all disabled, or `loop` off at an end).
 *
 * **Unknown `from` restarts at the first enabled item.** This is THE rule for
 * every caller (#126): a `from` the list no longer holds is a stale reference —
 * a filter or a reorder dropped it — and the widget must still move rather than
 * refuse every arrow key until the user clicks something.
 */
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
    const next = items[((rawIdx % n) + n) % n]!
    if (!disabled.includes(next)) return next
  }
  return null
}

/**
 * The single item that carries `tabindex="0"`.
 *
 * WAI-ARIA's roving-tabindex pattern requires EXACTLY ONE tab stop in a
 * composite widget: with none, Tab skips the widget entirely and it becomes
 * keyboard-unreachable. So a `preferred` candidate (the focused item, the
 * checked radio, …) is honoured only while it is still an enabled member, and
 * the first enabled item answers otherwise. Null only when nothing is enabled.
 *
 * Every roving-tabindex widget in the package routes through here (#145 closed
 * the last three: menubar, navigation-menu and tags-input). Keep it that way —
 * an inline `focused === x ? 0 : -1` has no fallback, and since nothing prunes
 * `focused` against the current list, removing or disabling the focused item
 * leaves EVERY item at -1 and the widget disappears from the Tab order.
 *
 * `tags-input` is index-keyed and passes `String(i)` as the item identity (its
 * `data-index`, and the only identity that survives duplicate tag values);
 * `navigation-menu` passes either the membership list its consumer maintains or
 * the ids handed to its own `item()`, filtered first to the ones not sealed
 * inside a closed submenu — membership alone would seat the stop on an element
 * inside a `hidden` panel, which is present, unique and untabbable.
 *
 * Null when nothing is enabled is deliberate and is a caller's problem to
 * notice: a widget whose items are ALL disabled ends up with no tab stop at
 * all. That is right for `radio-group`/`toggle-group`/`toolbar`/`tree-view`,
 * whose items are genuinely `disabled` and therefore unfocusable anyway, and it
 * is a 1 -> 0 change for `menubar`, whose triggers carry only `aria-disabled`
 * and stay focusable. Any revision belongs here, applying to every caller at
 * once — not in one component.
 */
export function rovingTabStop(
  items: readonly string[],
  disabled: readonly string[],
  ...preferred: readonly (string | null | undefined)[]
): string | null {
  for (const value of preferred) {
    if (value != null && isEnabledItem(items, disabled, value)) return value
  }
  return firstEnabled(items, disabled)
}

export function firstEnabledIndex(
  items: readonly string[],
  disabled: readonly string[],
): number | null {
  for (let i = 0; i < items.length; i++) {
    if (!disabled.includes(items[i]!)) return i
  }
  return null
}

export function lastEnabledIndex(
  items: readonly string[],
  disabled: readonly string[],
): number | null {
  for (let i = items.length - 1; i >= 0; i--) {
    if (!disabled.includes(items[i]!)) return i
  }
  return null
}

/**
 * The index of the next enabled item `delta` steps from `from`, wrapping.
 * `from === null` starts before the first item (delta 1) or after the last
 * (delta -1), so the first/last enabled index comes back.
 */
export function nextEnabledIndex(
  items: readonly string[],
  disabled: readonly string[],
  from: number | null,
  delta: 1 | -1,
): number | null {
  if (items.length === 0) return null
  const n = items.length
  const start = from === null ? (delta === 1 ? -1 : n) : from
  for (let i = 1; i <= n; i++) {
    const idx = (((start + delta * i) % n) + n) % n
    if (!disabled.includes(items[idx]!)) return idx
  }
  return null
}

/**
 * Apply a click/Enter on `value` to the current selection. Single mode
 * replaces, multiple toggles, and a disabled item changes nothing — returning
 * the SAME array reference so the reducer's no-op stays a no-op for the
 * reference-equality reconciler.
 */
export function applySelection(
  current: string[],
  value: string,
  opts: { mode: SelectionMode; disabled?: readonly string[] },
): string[] {
  if (opts.disabled?.includes(value) === true) return current
  if (opts.mode === 'single') return [value]
  return current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
}
