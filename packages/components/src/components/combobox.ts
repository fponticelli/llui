import type { Send, Signal, Mountable, Renderable, TransitionOptions } from '@llui/dom'
import { tagSend } from '@llui/dom'
import { comboboxLocale } from '../locale/combobox.js'
import { resolvePortalTarget } from '../utils/portal-target.js'
import { createOverlay, positionerProps } from '../utils/overlay-engine.js'
import { type Placement } from '../utils/floating.js'
import { indexMap, membershipSet } from '../utils/derive.js'
import {
  applySelection,
  firstEnabledIndex,
  lastEnabledIndex,
  nextEnabledIndex,
} from '../utils/list-navigation.js'
import { allFiniteNumbers } from '../utils/number.js'

/**
 * Combobox — text input paired with a filtered listbox dropdown. User
 * types to filter items, arrow keys navigate the filtered set, Enter
 * selects. Supports single and multiple selection.
 *
 * Beyond the sync filtered listbox the machine owns three additive
 * surfaces:
 *
 * - **Async option loading** — `status`/`requestId`/`error` track an
 *   in-flight fetch. The consumer debounces (e.g. `@llui/effects` `debounce`)
 *   and runs the fetch itself, dispatching `loadStart`/`loadSuccess`/`loadError`
 *   tagged with a monotonically-increasing `requestId`. The reducer DROPS any
 *   `loadSuccess`/`loadError` whose `requestId` is not the current one, so a
 *   late response from a superseded request can never clobber fresh state. The
 *   machine owns no timers.
 * - **Option groups** — `groups` mirror `select`'s `SelectGroup` shape exactly.
 *   The flat `items` list stays the source of truth for navigation/highlight
 *   indices; group LABELS are never options, so arrow navigation skips them.
 * - **Creatable** — opt-in `allowCreate`. When `inputValue` is non-empty and
 *   matches no item, a synthetic create sentinel is appended to `filteredItems`.
 *   Selecting it emits a `createOption` EFFECT (carrying the typed text) so the
 *   consumer owns creation; the machine never mutates `value` for it.
 */

export type SelectionMode = 'single' | 'multiple'

export type AsyncStatus = 'idle' | 'loading' | 'loaded' | 'error'

/**
 * Sentinel value used for the synthetic "create" option appended to
 * `filteredItems` in creatable mode. It is intentionally a value that no real
 * option will ever carry. Render it specially (the `data-create` part flag),
 * and treat a selection of it as a create request, not a normal pick.
 */
export const CREATE_OPTION_VALUE = '\u0000__llui_create__'

/**
 * A labelled section of options (rendered like `<optgroup>`). `items` are the
 * option VALUES belonging to the group, in visual order. Groups are an
 * additive, parallel structure: the flat `items` list always remains the
 * source of truth for navigation/highlight indices and item ids — when
 * `groups` is provided without an explicit `items` list, `init` derives the
 * flat list by concatenating each group's `items` in order. A plain flat
 * `string[]` (no groups) keeps working unchanged. Group LABELS are never
 * options, so highlight/arrow navigation skips over them for free.
 *
 * Mirrors `select`'s `SelectGroup` shape exactly.
 */
export interface ComboboxGroup {
  id: string
  label: string
  items: string[]
}

export interface ComboboxState {
  open: boolean
  value: string[]
  inputValue: string
  items: string[]
  groups: ComboboxGroup[]
  disabledItems: string[]
  filteredItems: string[]
  /** The highlighted option's VALUE (not its index) in the FILTERED list.
   * Value-based identity keeps the highlight pinned to the right option as the
   * list is filtered/reordered and value-keyed rows are reused. May hold the
   * create sentinel ({@link CREATE_OPTION_VALUE}) in creatable mode. */
  highlightedValue: string | null
  selectionMode: SelectionMode
  disabled: boolean
  allowCreate: boolean
  status: AsyncStatus
  requestId: number
  error: string | null
}

export type ComboboxMsg =
  /** @intent("Open the combobox dropdown") */
  | { type: 'open' }
  /** @intent("Close the combobox dropdown") */
  | { type: 'close' }
  /** @intent("Set the text input contents (re-runs the filter)") */
  | { type: 'setInputValue'; value: string }
  /** @intent("Pick the option with the given value (toggles in multi-select)") */
  | { type: 'selectOption'; value: string }
  /** @intent("Replace the selected values with the provided list") */
  | { type: 'setValue'; value: string[] }
  /** @intent("Clear all selected values and the input text") */
  | { type: 'clear' }
  /** @humanOnly */
  | { type: 'highlightNext' }
  /** @humanOnly */
  | { type: 'highlightPrev' }
  /** @humanOnly */
  | { type: 'highlightFirst' }
  /** @humanOnly */
  | { type: 'highlightLast' }
  /** @humanOnly */
  | { type: 'highlight'; value: string | null }
  /** @intent("Pick the currently-highlighted option in the filtered list") */
  | { type: 'selectHighlighted' }
  /**
   * @humanOnly
   *
   * Replace `items` (and optionally `disabled`) synchronously — the same
   * highlight-resolution policy as `loadSuccess` applies: a highlight that no
   * longer survives the fresh list moves to the first enabled match WHILE
   * OPEN, or to `null` WHILE CLOSED (#265 G3), since a background refresh
   * must not manufacture a highlight before the control is ever opened.
   */
  | { type: 'setItems'; items: string[]; disabled?: string[] }
  /** @intent("Mark an async option fetch as started; pass the request's id") */
  | { type: 'loadStart'; requestId: number }
  /**
   * @humanOnly
   *
   * Atomic replacement: `items` is required. `disabled` is an OPTIONAL
   * companion that replaces `disabledItems` when present (omitted ⇒
   * unchanged). `groups` is different: omitting it RESETS to no groups
   * (`[]`), the same as `init()` with no `groups` option — a fresh
   * replacement with no `groups` describes a flat result, and carrying a
   * PREVIOUS load's groups forward would keep describing options this
   * replacement never mentioned as belonging to a group that may no longer
   * apply (#265 A3). Every field the fresh `items`/`disabled`/`groups` makes
   * inconsistent is reconciled in this SAME reducer step, never in a
   * follow-up message. `value` (selection) is dropped when it no longer
   * names a value in the new `items` (after the new `disabled` is applied).
   * `highlightedValue` is kept only when it is BOTH still in the fresh
   * filtered list AND not newly disabled. Otherwise the fallback depends on
   * whether the listbox is open: WHILE OPEN it moves to the first enabled
   * match (or `null` when none is enabled) — never left dangling for a
   * render in between, and never left naming an option that is now
   * disabled. WHILE CLOSED it always resolves to `null` instead, even when
   * the fresh list has enabled options: the listbox content is unmounted
   * while closed, so there is no option `aria-activedescendant` could
   * correctly name, and a background load (a prefetch, a poll) must not
   * manufacture a highlight before the control is ever opened — re-opening
   * always reseeds the highlight itself (#265 G3).
   */
  | {
      type: 'loadSuccess'
      requestId: number
      items: string[]
      groups?: ComboboxGroup[]
      disabled?: string[]
    }
  /** @humanOnly */
  | { type: 'loadError'; requestId: number; error: string }

/**
 * Effects emitted by the combobox machine. Creation is owned by the consumer:
 * when a create sentinel is selected the machine surfaces the typed text as a
 * `createOption` effect rather than mutating its own `value`.
 */
export type ComboboxEffect =
  /** @intent("The user asked to create a brand-new option from the typed text") */
  { type: 'createOption'; value: string }

export interface ComboboxInit {
  value?: string[]
  inputValue?: string
  items?: string[]
  /** Optional labelled sections. When provided without `items`, the flat
   * `items` list is derived by concatenating each group's `items` in order. */
  groups?: ComboboxGroup[]
  disabledItems?: string[]
  selectionMode?: SelectionMode
  disabled?: boolean
  /** Enable creatable mode: a synthetic create option is offered when the
   * typed text matches no existing item. */
  allowCreate?: boolean
}

export function init(opts: ComboboxInit = {}): ComboboxState {
  const groups = opts.groups ?? []
  const items = opts.items ?? groups.flatMap((g) => g.items)
  const disabledItems = opts.disabledItems ?? []
  const inputValue = opts.inputValue ?? ''
  const allowCreate = opts.allowCreate ?? false
  return {
    open: false,
    value: opts.value ?? [],
    inputValue,
    items,
    groups,
    disabledItems,
    filteredItems: computeFiltered(items, inputValue, allowCreate),
    highlightedValue: null,
    selectionMode: opts.selectionMode ?? 'single',
    disabled: opts.disabled ?? false,
    allowCreate,
    status: 'idle',
    requestId: 0,
    error: null,
  }
}

function filterItems(items: string[], query: string): string[] {
  if (query === '') return items
  const q = query.toLowerCase()
  return items.filter((item) => item.toLowerCase().includes(q))
}

/** Filter + (in creatable mode) append the synthetic create sentinel when the
 * non-empty query matches no item exactly. */
function computeFiltered(items: string[], query: string, allowCreate: boolean): string[] {
  const filtered = filterItems(items, query)
  if (!allowCreate || query === '') return filtered
  const exact = items.some((item) => item === query)
  if (exact) return filtered
  return [...filtered, CREATE_OPTION_VALUE]
}

export function isCreateOption(value: string): boolean {
  return value === CREATE_OPTION_VALUE
}

/**
 * A single, mutually-exclusive summary of the async load lifecycle, derived
 * from `status` and whether any items are currently on hand. This exists so a
 * consumer never has to reconcile independent booleans (`isLoading`,
 * `isEmpty`, `hasError`) that can read true at the same time — exactly the
 * defect #265 finding 11 named test-first. There are five states partitioning
 * every reachable `(status, items.length)` pair:
 *
 * - `'initial-empty'` — nothing has ever loaded and none were given
 *   synchronously (`status === 'idle'`, no items).
 * - `'loading'` — a fetch is in flight and there is nothing yet to show (a
 *   first-ever load).
 * - `'stale-results'` — the STALE-WHILE-REVALIDATE state: a fetch is in
 *   flight while a previous list is still on screen. `loadStart` never
 *   clears `items`, so the previous results keep rendering, filterable and
 *   selectable, until the matching `loadSuccess`/`loadError` lands.
 * - `'success'` — the current items are the result of a completed load, or
 *   were given synchronously and never superseded by a failed fetch.
 * - `'error'` — the most recent fetch failed. Per the same policy, items from
 *   an earlier successful load are left mounted and selectable; only the
 *   live region / a consumer's own error slot communicate the failure, so
 *   `'error'` is reported the same whether or not stale items remain.
 */
export type LoadProjection = 'initial-empty' | 'loading' | 'stale-results' | 'success' | 'error'

export function loadProjection(state: Pick<ComboboxState, 'status' | 'items'>): LoadProjection {
  if (state.status === 'error') return 'error'
  if (state.status === 'loading') return state.items.length > 0 ? 'stale-results' : 'loading'
  if (state.status === 'loaded') return 'success'
  // 'idle': items supplied synchronously (or not at all) and never fetched.
  return state.items.length > 0 ? 'success' : 'initial-empty'
}

/**
 * The disabled list as the shared navigation helpers see it. The "create new"
 * row is a synthetic option, never a real item, so it can never be disabled —
 * that carve-out is the only thing separating combobox's navigation from
 * select's and listbox's, and it belongs here rather than in a third copy of
 * the walk (#126).
 */
function navigableDisabled(disabled: string[]): string[] {
  return disabled.includes(CREATE_OPTION_VALUE)
    ? disabled.filter((v) => v !== CREATE_OPTION_VALUE)
    : disabled
}

/** The value at `idx` in `items`, or null when `idx` is null/out of bounds. */
function valueAt(items: string[], idx: number | null): string | null {
  return idx === null ? null : (items[idx] ?? null)
}

/** The index of `value` in `items`, or null when absent. */
function indexOfValue(items: string[], value: string | null): number | null {
  if (value === null) return null
  const i = items.indexOf(value)
  return i === -1 ? null : i
}

/** The first-enabled option's VALUE in `items`, or null. */
function firstEnabledValue(items: string[], disabled: string[]): string | null {
  return valueAt(items, firstEnabledIndex(items, navigableDisabled(disabled)))
}

/**
 * Resolve the highlight after an `items`/`disabled` replacement
 * (`setItems`/`loadSuccess`, #265 A3): keep the current highlight only when
 * it survives BOTH the fresh filtered list AND the fresh disabled set.
 * Otherwise, the fallback depends on whether the listbox is OPEN right now
 * (#265 G3): while open, move to the first enabled match in the fresh list,
 * because `aria-activedescendant` must keep naming a selectable option for
 * the keyboard user currently navigating it — a highlight that merely stayed
 * in `filteredItems` but became disabled in this same replacement must not
 * linger. While CLOSED, fall back to `null` instead: the listbox content is
 * unmounted, so there is no option `aria-activedescendant` could correctly
 * name, and a background `setItems`/`loadSuccess` (a prefetch, a poll) must
 * not manufacture a highlight nobody asked for — main never did, and doing
 * so left `aria-activedescendant` naming an unmounted option the moment data
 * arrived before the control was ever opened. Re-opening always reseeds the
 * highlight itself (`case 'open'`), so returning to `null` here loses
 * nothing.
 */
function resolveHighlightAfterReplace(
  highlightedValue: string | null,
  filteredItems: string[],
  disabledItems: string[],
  open: boolean,
): string | null {
  if (
    highlightedValue !== null &&
    filteredItems.includes(highlightedValue) &&
    !disabledItems.includes(highlightedValue)
  ) {
    return highlightedValue
  }
  return open ? firstEnabledValue(filteredItems, disabledItems) : null
}

/** Commit a normal (non-create) option pick. */
function commitSelection(state: ComboboxState, picked: string): [ComboboxState, ComboboxEffect[]] {
  const value = applySelection(state.value, picked, {
    mode: state.selectionMode,
    disabled: state.disabledItems,
  })
  const inputValue = state.selectionMode === 'single' ? picked : ''
  const filteredItems = computeFiltered(state.items, inputValue, state.allowCreate)
  const open = state.selectionMode === 'single' ? false : state.open
  // Preserve the highlight only while open AND still present in the recomputed
  // filtered list; otherwise drop it.
  const highlightedValue =
    open && state.highlightedValue !== null && filteredItems.includes(state.highlightedValue)
      ? state.highlightedValue
      : null
  return [
    {
      ...state,
      value,
      inputValue,
      filteredItems,
      open,
      highlightedValue,
    },
    [],
  ]
}

export function update(state: ComboboxState, msg: ComboboxMsg): [ComboboxState, ComboboxEffect[]] {
  if (!allFiniteNumbers(msg)) return [state, []]
  if (state.disabled && msg.type !== 'setItems') return [state, []]
  switch (msg.type) {
    case 'open':
      return [
        {
          ...state,
          open: true,
          // Only seed the highlight on the closed→open transition. Re-opening an
          // already-open listbox (the input's ArrowDown/Up handler sends `open`
          // before `highlight*`) must preserve the current highlight, otherwise
          // every arrow keypress resets to the first item and navigation sticks.
          highlightedValue: state.open
            ? state.highlightedValue
            : firstEnabledValue(state.filteredItems, state.disabledItems),
        },
        [],
      ]
    case 'close':
      return [{ ...state, open: false, highlightedValue: null }, []]
    case 'setInputValue': {
      const filteredItems = computeFiltered(state.items, msg.value, state.allowCreate)
      return [
        {
          ...state,
          inputValue: msg.value,
          filteredItems,
          open: true,
          highlightedValue: firstEnabledValue(filteredItems, state.disabledItems),
        },
        [],
      ]
    }
    case 'selectOption': {
      if (msg.value === CREATE_OPTION_VALUE) {
        return [state, [{ type: 'createOption', value: state.inputValue }]]
      }
      return commitSelection(state, msg.value)
    }
    case 'setValue':
      return [{ ...state, value: msg.value }, []]
    case 'clear':
      return [
        {
          ...state,
          value: [],
          inputValue: '',
          filteredItems: computeFiltered(state.items, '', state.allowCreate),
          highlightedValue: null,
        },
        [],
      ]
    case 'highlight':
      // Pointer-move fires a highlight per mouse tick; when the target is
      // already highlighted, return the SAME state reference so the reconciler
      // sees no change and skips the commit entirely.
      if (state.highlightedValue === msg.value) return [state, []]
      return [{ ...state, highlightedValue: msg.value }, []]
    case 'highlightNext':
      return [
        {
          ...state,
          highlightedValue: valueAt(
            state.filteredItems,
            nextEnabledIndex(
              state.filteredItems,
              navigableDisabled(state.disabledItems),
              indexOfValue(state.filteredItems, state.highlightedValue),
              1,
            ),
          ),
        },
        [],
      ]
    case 'highlightPrev':
      return [
        {
          ...state,
          highlightedValue: valueAt(
            state.filteredItems,
            nextEnabledIndex(
              state.filteredItems,
              navigableDisabled(state.disabledItems),
              indexOfValue(state.filteredItems, state.highlightedValue),
              -1,
            ),
          ),
        },
        [],
      ]
    case 'highlightFirst':
      return [
        {
          ...state,
          highlightedValue: firstEnabledValue(state.filteredItems, state.disabledItems),
        },
        [],
      ]
    case 'highlightLast':
      return [
        {
          ...state,
          highlightedValue: valueAt(
            state.filteredItems,
            lastEnabledIndex(state.filteredItems, navigableDisabled(state.disabledItems)),
          ),
        },
        [],
      ]
    case 'selectHighlighted': {
      const v = state.highlightedValue
      if (v === null || !state.filteredItems.includes(v)) return [state, []]
      if (v === CREATE_OPTION_VALUE) {
        return [state, [{ type: 'createOption', value: state.inputValue }]]
      }
      return commitSelection(state, v)
    }
    case 'setItems': {
      const disabled = msg.disabled ?? state.disabledItems
      const value = state.value.filter((v) => msg.items.includes(v) && !disabled.includes(v))
      const filteredItems = computeFiltered(msg.items, state.inputValue, state.allowCreate)
      // Value-keyed clamp: keep the highlight only when its value survives in
      // the new filtered list AND is not newly disabled; otherwise move to
      // the first enabled match while OPEN, or null while CLOSED — never
      // dangle aria-activedescendant on a filtered-out/disabled option, and
      // never manufacture one while closed (#265 A3, G3).
      const highlightedValue = resolveHighlightAfterReplace(
        state.highlightedValue,
        filteredItems,
        disabled,
        state.open,
      )
      return [
        {
          ...state,
          items: msg.items,
          disabledItems: disabled,
          filteredItems,
          highlightedValue,
          value,
        },
        [],
      ]
    }
    case 'loadStart':
      return [{ ...state, status: 'loading', requestId: msg.requestId, error: null }, []]
    case 'loadSuccess': {
      // Drop responses from superseded requests (stale-response protection,
      // #265 finding 10): a partially-stale write is worse than a dropped one,
      // so the whole message either applies as ONE swap or not at all.
      if (msg.requestId !== state.requestId) return [state, []]
      // `groups` is OPTIONAL but not "unchanged when omitted": an atomic
      // replacement with no `groups` is a flat (ungrouped) result, exactly
      // like `init()` with no `groups` option — carrying a PREVIOUS load's
      // groups forward would describe options this replacement never
      // mentioned as still belonging to a group that may no longer apply
      // (#265 A3).
      const groups = msg.groups ?? []
      const disabledItems = msg.disabled ?? state.disabledItems
      const filteredItems = computeFiltered(msg.items, state.inputValue, state.allowCreate)
      // Atomic replacement: items/groups/disabled/selected/filtering/highlight
      // all move together. A selection the fresh items (or the fresh disabled
      // list) no longer support is dropped in this same step — never left
      // dangling for a render in between. The highlight is resolved the same
      // way `setItems` does: kept only if still filtered-in AND still
      // enabled, otherwise moved to the first enabled match while open, or
      // null while closed (#265 G3) — a background load must not manufacture
      // a highlight before the control is ever opened.
      const value = state.value.filter((v) => msg.items.includes(v) && !disabledItems.includes(v))
      const highlightedValue = resolveHighlightAfterReplace(
        state.highlightedValue,
        filteredItems,
        disabledItems,
        state.open,
      )
      return [
        {
          ...state,
          items: msg.items,
          groups,
          disabledItems,
          value,
          filteredItems,
          highlightedValue,
          status: 'loaded',
          error: null,
        },
        [],
      ]
    }
    case 'loadError': {
      if (msg.requestId !== state.requestId) return [state, []]
      return [{ ...state, status: 'error', error: msg.error }, []]
    }
  }
}

export interface ComboboxItemParts {
  item: {
    role: 'option'
    id: string
    'aria-selected': Signal<boolean>
    'aria-disabled': Signal<'true' | undefined>
    'data-state': Signal<'selected' | undefined>
    'data-highlighted': Signal<'' | undefined>
    'data-disabled': Signal<'' | undefined>
    'data-create': '' | undefined
    'data-scope': 'combobox'
    'data-part': 'item'
    'data-value': string
    /** The option's live position in the FILTERED list (reactive — reused rows
     * never report a stale index). */
    'data-index': Signal<string>
    onClick: (e: MouseEvent) => void
    onPointerMove: (e: PointerEvent) => void
  }
}

export interface ComboboxGroupParts {
  group: {
    role: 'group'
    /** The group label's id, or absent when `hasLabel: false`. */
    'aria-labelledby': string | undefined
    'data-scope': 'combobox'
    'data-part': 'group'
    'data-group': string
  }
  groupLabel: {
    id: string
    'aria-hidden': 'true'
    'data-scope': 'combobox'
    'data-part': 'group-label'
    'data-group': string
  }
}

export interface ComboboxParts {
  root: {
    'data-scope': 'combobox'
    'data-part': 'root'
    'data-state': Signal<'open' | 'closed'>
  }
  input: {
    type: 'text'
    role: 'combobox'
    autocomplete: 'off'
    'aria-autocomplete': 'list'
    'aria-expanded': Signal<boolean>
    'aria-controls': string
    'aria-activedescendant': Signal<string | undefined>
    'aria-disabled': Signal<'true' | undefined>
    id: string
    disabled: Signal<boolean>
    value: Signal<string>
    'data-scope': 'combobox'
    'data-part': 'input'
    onInput: (e: Event) => void
    onKeyDown: (e: KeyboardEvent) => void
    onFocus: (e: FocusEvent) => void
  }
  trigger: {
    type: 'button'
    'aria-label': string
    'aria-expanded': Signal<boolean>
    'aria-controls': string
    tabindex: -1
    'data-scope': 'combobox'
    'data-part': 'trigger'
    onClick: (e: MouseEvent) => void
  }
  positioner: {
    'data-scope': 'combobox'
    'data-part': 'positioner'
    style: string
  }
  content: {
    role: 'listbox'
    id: string
    'aria-labelledby': string
    'aria-busy': Signal<'true' | undefined>
    tabindex: -1
    'data-state': Signal<'open' | 'closed'>
    'data-status': Signal<AsyncStatus>
    /** The mutually-exclusive load projection (#265 finding 11) — see
     * {@link LoadProjection}. Mirrors the top-level `loadState` signal. */
    'data-load-state': Signal<LoadProjection>
    'data-scope': 'combobox'
    'data-part': 'content'
  }
  /** The mutually-exclusive async load projection: `'initial-empty'` |
   * `'loading'` | `'stale-results'` | `'success'` | `'error'`. A single
   * signal instead of independent `isLoading`/`isEmpty`/`hasError` booleans,
   * so it can never contradict itself. See {@link LoadProjection}. */
  loadState: Signal<LoadProjection>
  /** Build the parts for an option by VALUE. The optional `index` is accepted
   * for call-site convenience only — it is NOT used for identity (highlight,
   * selection and ids are all value-keyed), so a reused row is never stale. */
  item: (value: string, index?: number) => ComboboxItemParts
  /** Parts for a labelled option group (`<optgroup>`-style section). Pass the
   * group id; render the section element with `group` and its label element
   * (referenced by `aria-labelledby`) with `groupLabel`. Group labels are not
   * options, so navigation skips them automatically. Mirrors `select`. */
  /**
   * A labelled group's parts. The group names its `label` part through
   * `aria-labelledby`; a consumer that renders the group WITHOUT that label
   * passes `{ hasLabel: false }` so it never names an element that does not
   * exist (an unlabelled `role="group"` is valid; a broken idref is not — the
   * `dialog` `hasDescription` rule, #268). Default: true.
   */
  group: (id: string, options?: { readonly hasLabel?: boolean }) => ComboboxGroupParts
  /** Polite live region announcing the result count / error to screen readers
   * as the async filter resolves. Render a visually-hidden element with these
   * attributes and the `text` signal as its content. */
  liveRegion: {
    role: 'status'
    'aria-live': 'polite'
    'aria-atomic': 'true'
    'data-scope': 'combobox'
    'data-part': 'live-region'
    text: Signal<string>
  }
  empty: {
    'data-scope': 'combobox'
    'data-part': 'empty'
  }
}

export interface ConnectOptions {
  id: string
  triggerLabel?: string
}

export function connect(
  state: Signal<ComboboxState>,
  send: Send<ComboboxMsg>,
  opts: ConnectOptions,
): ComboboxParts {
  const locale = comboboxLocale()
  const base = opts.id
  const inputId = `${base}:input`
  const contentId = `${base}:content`
  const itemId = (value: string): string => `${base}:item:${encodeURIComponent(value)}`
  const groupLabelId = (id: string): string => `${base}:group:${id}:label`
  const triggerLabel = opts.triggerLabel ?? locale.toggle

  // Derived once per update and shared by every item, instead of a full array
  // scan inside each item's props on every update (#124).
  const selected = membershipSet<string>()
  const disabled = membershipSet<string>()
  const filteredIndex = indexMap<string>()

  return {
    root: {
      // The ARIA combobox lives on the INPUT (see `input` below). The root is a
      // plain styling wrapper — duplicating role/aria-expanded/haspopup/controls
      // here created a second, nested combobox that confuses assistive tech.
      'data-scope': 'combobox',
      'data-part': 'root',
      'data-state': state.map((s) => (s.open ? 'open' : 'closed')),
    },
    input: {
      type: 'text',
      role: 'combobox',
      autocomplete: 'off',
      'aria-autocomplete': 'list',
      'aria-expanded': state.map((s) => s.open),
      'aria-controls': contentId,
      'aria-activedescendant': state.map((s) =>
        s.highlightedValue === null ? undefined : itemId(s.highlightedValue),
      ),
      'aria-disabled': state.map((s) => (s.disabled ? 'true' : undefined)),
      id: inputId,
      disabled: state.map((s) => s.disabled),
      value: state.map((s) => s.inputValue),
      'data-scope': 'combobox',
      'data-part': 'input',
      onInput: tagSend(send, ['setInputValue'], (e) => {
        const value = (e.target as HTMLInputElement).value
        send({ type: 'setInputValue', value })
      }),
      onKeyDown: tagSend(
        send,
        [
          'open',
          'highlightNext',
          'highlightPrev',
          'highlightFirst',
          'highlightLast',
          'selectHighlighted',
          'close',
        ],
        (e) => {
          switch (e.key) {
            case 'ArrowDown':
              e.preventDefault()
              send({ type: 'open' })
              send({ type: 'highlightNext' })
              return
            case 'ArrowUp':
              e.preventDefault()
              send({ type: 'open' })
              send({ type: 'highlightPrev' })
              return
            case 'Home':
              e.preventDefault()
              send({ type: 'highlightFirst' })
              return
            case 'End':
              e.preventDefault()
              send({ type: 'highlightLast' })
              return
            case 'Enter':
              e.preventDefault()
              send({ type: 'selectHighlighted' })
              return
            case 'Escape':
              e.preventDefault()
              send({ type: 'close' })
              return
          }
        },
      ),
      onFocus: tagSend(send, ['open'], () => send({ type: 'open' })),
    },
    trigger: {
      type: 'button',
      'aria-label': triggerLabel,
      'aria-expanded': state.map((s) => s.open),
      'aria-controls': contentId,
      tabindex: -1,
      'data-scope': 'combobox',
      'data-part': 'trigger',
      onClick: tagSend(send, ['open'], () => send({ type: 'open' })),
    },
    positioner: {
      'data-scope': 'combobox',
      'data-part': 'positioner',
      style: 'position:absolute;top:0;left:0;',
    },
    content: {
      role: 'listbox',
      id: contentId,
      'aria-labelledby': inputId,
      'aria-busy': state.map((s) => (s.status === 'loading' ? 'true' : undefined)),
      tabindex: -1,
      'data-state': state.map((s) => (s.open ? 'open' : 'closed')),
      'data-status': state.map((s) => s.status),
      'data-load-state': state.map(loadProjection),
      'data-scope': 'combobox',
      'data-part': 'content',
    },
    loadState: state.map(loadProjection),
    item: (value: string): ComboboxItemParts => {
      const isCreate = value === CREATE_OPTION_VALUE
      return {
        item: {
          role: 'option',
          id: itemId(value),
          'aria-selected': state.map((s) => selected(s.value).has(value)),
          'aria-disabled': state.map((s) =>
            !isCreate && disabled(s.disabledItems).has(value) ? 'true' : undefined,
          ),
          'data-state': state.map((s) => (selected(s.value).has(value) ? 'selected' : undefined)),
          'data-highlighted': state.map((s) => (s.highlightedValue === value ? '' : undefined)),
          'data-disabled': state.map((s) =>
            !isCreate && disabled(s.disabledItems).has(value) ? '' : undefined,
          ),
          'data-create': isCreate ? '' : undefined,
          'data-scope': 'combobox',
          'data-part': 'item',
          'data-value': value,
          'data-index': state.map((s) => String(filteredIndex(s.filteredItems).get(value) ?? -1)),
          onClick: tagSend(send, ['selectOption'], () => send({ type: 'selectOption', value })),
          onPointerMove: tagSend(send, ['highlight'], () => {
            // Guard the send too: skip dispatching entirely when the row is
            // already highlighted, so a stationary pointer doesn't re-enter the
            // reducer on every move event.
            if (state.peek()?.highlightedValue === value) return
            send({ type: 'highlight', value })
          }),
        },
      }
    },
    group: (id: string, options = {}): ComboboxGroupParts => ({
      group: {
        role: 'group',
        'aria-labelledby': options.hasLabel === false ? undefined : groupLabelId(id),
        'data-scope': 'combobox',
        'data-part': 'group',
        'data-group': id,
      },
      groupLabel: {
        id: groupLabelId(id),
        'aria-hidden': 'true',
        'data-scope': 'combobox',
        'data-part': 'group-label',
        'data-group': id,
      },
    }),
    liveRegion: {
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true',
      'data-scope': 'combobox',
      'data-part': 'live-region',
      text: state.map((s) => {
        if (s.status === 'error') return s.error ?? ''
        // `'idle'` as well as `'loaded'`: a combobox given its items
        // synchronously stays `'idle'` for its whole life, and announcing only
        // on `'loaded'` left the region permanently empty for that — the
        // ordinary case. Both mean "not fetching", so `filteredItems` is
        // settled. `'loading'` is the one status with nothing to say.
        if (s.status === 'idle' || s.status === 'loaded') {
          const n = s.filteredItems.filter((v) => v !== CREATE_OPTION_VALUE).length
          return locale.resultCount(n)
        }
        return ''
      }),
    },
    empty: {
      'data-scope': 'combobox',
      'data-part': 'empty',
    },
  }
}

export interface OverlayOptions {
  /**
   * Class applied to the positioner — the floating wrapper `div` this helper
   * builds around the content. Needed when styling with utilities rather than
   * the opt-in baseline stylesheet: it is the element that carries the
   * `z-index` for the floating layer.
   */
  positionerClass?: string
  state: Signal<ComboboxState>
  send: Send<ComboboxMsg>
  parts: ComboboxParts
  content: () => Renderable
  /**
   * Optional enter/leave transition for the combobox listbox (from
   * `@llui/transitions`). `enter` animates it in on open; `leave` defers the
   * unmount until its promise resolves, giving the raw-`open` combobox an exit
   * animation for free. Omitted ⇒ the listbox closes synchronously as before.
   *
   * @example combobox.overlay({ state, send, parts, content, transition: fade({ duration: 120 }) })
   */
  transition?: TransitionOptions
  placement?: Placement
  offset?: number
  flip?: boolean
  shift?: boolean
  sameWidth?: boolean
  target?: string | HTMLElement
}

export function overlay(opts: OverlayOptions): Mountable {
  // Anchored to the combobox INPUT (which stays visible while open); the listbox
  // is never focused (trigger-focused ARIA pattern with aria-activedescendant).
  return createOverlay({
    state: opts.state,
    transition: opts.transition,
    host: resolvePortalTarget(opts.target ?? 'body'),
    positioner: positionerProps(opts.parts.positioner, opts.positionerClass),
    content: opts.content,
    contentId: opts.parts.content.id,
    relationships: {
      placementAnchor: { id: opts.parts.input.id },
      nestedLayerOwner: { id: opts.parts.input.id },
      dismissIgnore: [{ id: opts.parts.input.id }],
    },
    mountWhen: (s) => s.open,
    onDismiss: () => opts.send({ type: 'close' }),
    floating: {
      placement: opts.placement ?? 'bottom-start',
      offset: opts.offset ?? 4,
      flip: opts.flip !== false,
      shift: opts.shift !== false,
      sameWidth: opts.sameWidth !== false,
    },
    dismiss: {},
  })
}

export const combobox = { init, update, connect, overlay, isCreateOption, CREATE_OPTION_VALUE }
