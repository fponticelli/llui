/**
 * Typeahead search — accumulates keystrokes into a query while the user
 * types rapidly, then matches the first item whose label starts with the
 * query. Used by listbox, menu, select, combobox, tree-view to support
 * WAI-ARIA keyboard navigation patterns.
 *
 * Behavior:
 *   - If a keystroke arrives within `TYPEAHEAD_TIMEOUT_MS` of the previous
 *     one, append to the existing query (so typing "sa" finds "Saturn" even
 *     if the highlight is currently on "Jupiter").
 *   - Otherwise, start a fresh single-character query.
 *   - Single-character queries advance past the current position (jump to
 *     the *next* item starting with that letter), which is the standard
 *     WAI-ARIA behavior — rapid repeated presses of "s" cycle through
 *     items beginning with "s".
 *   - Multi-character queries search from the current cursor position
 *     (inclusive) so if the cursor is already on a matching item, it
 *     stays — typing "ap" while on "apricot" keeps focus on "apricot".
 */

export const TYPEAHEAD_TIMEOUT_MS = 500

/**
 * Advance the typeahead query based on a new keystroke and the previous
 * expiration time. Returns the new query string; callers combine this with
 * `typeaheadMatch()` to produce a new highlight index.
 */
export function typeaheadAccumulate(
  prev: string,
  char: string,
  now: number,
  expiresAt: number,
): string {
  return now < expiresAt ? prev + char : char
}

/**
 * Find the first enabled item whose label starts with the query
 * (case-insensitive). `labels` and `disabledMask` are parallel arrays.
 * `startFrom` is the current highlighted index; for single-character
 * queries the search begins at `startFrom + 1` (so repeated "s" keys
 * cycle), for multi-character queries it begins at `startFrom` (inclusive).
 *
 * Returns the matching index, or `null` if no enabled item matches.
 */
export function typeaheadMatch(
  labels: string[],
  disabledMask: boolean[],
  query: string,
  startFrom: number | null,
): number | null {
  if (labels.length === 0 || query.length === 0) return null
  const q = query.toLowerCase()
  const offset = query.length === 1 ? 1 : 0
  const n = labels.length
  const start = startFrom ?? -1
  for (let i = 0; i < n; i++) {
    const idx = (start + offset + i + n) % n
    if (disabledMask[idx]) continue
    if (labels[idx]!.toLowerCase().startsWith(q)) return idx
  }
  return null
}

/**
 * Convenience: pass a `disabled` list of values instead of a boolean mask.
 * Builds the mask by checking membership via `===` on the raw string values.
 */
export function typeaheadMatchByItems(
  items: string[],
  disabled: readonly string[],
  query: string,
  startFrom: number | null,
): number | null {
  const n = items.length
  const mask = new Array<boolean>(n)
  for (let i = 0; i < n; i++) mask[i] = disabled.includes(items[i]!)
  return typeaheadMatch(items, mask, query, startFrom)
}

/**
 * Returns true if the key event should trigger a typeahead query — i.e., a
 * single printable character that isn't a modified keyboard shortcut. Use
 * this in `onKeyDown` handlers to decide whether to dispatch a typeahead
 * message.
 */
export function isTypeaheadKey(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false
  if (e.key.length !== 1) return false
  // Whitespace isn't a typeahead character in most widgets — Space often
  // activates the highlighted item. Let callers override if needed.
  if (e.key === ' ') return false
  return true
}
