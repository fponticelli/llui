import type { Send, Signal, TransitionOptions, Mountable, Renderable } from '@llui/dom'
import { show, portal, onMount, div, tagSend } from '@llui/dom'
import { attachFloating, type Placement } from '../utils/floating.js'
import { pushDismissable } from '../utils/dismissable.js'
import { resolvePortalTarget } from '../utils/portal-target.js'
import { isTypeaheadKey } from '../utils/typeahead.js'
import {
  init as comboboxInit,
  update as comboboxUpdate,
  connect as comboboxConnect,
  type ComboboxState,
  type ComboboxMsg,
  type ComboboxGroup,
  type SelectionMode,
  type AsyncStatus,
} from '../components/combobox.js'

/**
 * SearchableSelect — a select with a filter input ("a select, but
 * searchable"), preset over `combobox`.
 *
 * It is a thin, opinionated wrapper around the `combobox` machine that bakes
 * in the canonical shadcn-style anatomy:
 *
 * - A **trigger button** displays the current selection (NOT the filter text).
 * - The **search input** lives INSIDE the popup, above the listbox.
 * - `aria-activedescendant` wiring is inherited from `combobox` unchanged.
 *
 * The defining behavior versus a raw combobox: the input is **filter-only**.
 * The typed text never becomes the committed value — selection comes ONLY from
 * the items list. Combobox's single-select would normally copy the picked
 * label into `inputValue`; this preset overrides that so the filter is always
 * reset to empty after a commit, after closing, and (by default) when opening.
 * Set `prefillFilter` to instead seed the filter with the current selection's
 * label (and the consumer should select-all the input on open).
 *
 * Selection modes:
 * - `single` (default) — one value; trigger shows its label.
 * - `multiple` — toggles values, stays open; trigger shows a joined / counted
 *   summary. For an editable-chips experience, compose with `tags-input` in the
 *   trigger — there is no hard dependency.
 *
 * Async option loading and option groups are inherited from `combobox` as
 * passthrough: pass `groups`, drive `loadStart`/`loadSuccess`/`loadError`
 * through `combobox` messages via `setItems`, etc. (see `combobox` docs).
 */

export type { SelectionMode, AsyncStatus, ComboboxGroup }

export interface SearchableSelectState {
  /** Whether the popup is open. Mirrors `combobox.open`; kept at the top level
   * so consumers can read it without reaching into the nested machine. */
  open: boolean
  /** The underlying combobox machine state. `value` is the source of truth for
   * the selection; `inputValue` is the filter (never the committed value). */
  combobox: ComboboxState
  /** When opening, seed the filter with the selected label (and the consumer
   * should select-all). When false (default) the filter opens empty. */
  prefillFilter: boolean
  /** Trigger placeholder shown when nothing is selected. */
  placeholder: string
  /** Separator used to join multiple selected labels in the trigger. */
  separator: string
}

export type SearchableSelectMsg =
  /** @intent("Open the searchable select popup") */
  | { type: 'open' }
  /** @intent("Close the popup (resets the filter)") */
  | { type: 'close' }
  /** @intent("Set the filter text (re-runs the item filter; never commits a value)") */
  | { type: 'setFilter'; value: string }
  /** @intent("Select the option with the given value (toggles in multi-select)") */
  | { type: 'selectValue'; value: string }
  /** @intent("Replace the selected values with the provided list") */
  | { type: 'setValue'; value: string[] }
  /** @intent("Clear the current selection") */
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
  | { type: 'highlight'; index: number | null }
  /** @intent("Select the currently-highlighted option (the only commit path from the keyboard)") */
  | { type: 'selectHighlighted' }
  /** @humanOnly */
  | { type: 'triggerType'; char: string }
  /** @humanOnly */
  | { type: 'setItems'; items: string[]; disabled?: string[] }

export interface SearchableSelectInit {
  value?: string[]
  items?: string[]
  /** Optional labelled sections (passthrough to `combobox`). */
  groups?: ComboboxGroup[]
  disabledItems?: string[]
  selectionMode?: SelectionMode
  disabled?: boolean
  /** Seed the filter with the selected label on open (default: false → empty). */
  prefillFilter?: boolean
  /** Trigger text when nothing is selected. */
  placeholder?: string
  /** Join multiple selected labels with this separator in the trigger. */
  separator?: string
}

export function init(opts: SearchableSelectInit = {}): SearchableSelectState {
  const combobox = comboboxInit({
    value: opts.value,
    items: opts.items,
    groups: opts.groups,
    disabledItems: opts.disabledItems,
    selectionMode: opts.selectionMode,
    disabled: opts.disabled,
    // never creatable: a searchable-select can never commit free text
    allowCreate: false,
  })
  return {
    open: combobox.open,
    combobox,
    prefillFilter: opts.prefillFilter ?? false,
    placeholder: opts.placeholder ?? '',
    separator: opts.separator ?? ', ',
  }
}

/** Wrap a combobox sub-update, syncing the top-level `open` mirror. */
function lift(state: SearchableSelectState, combobox: ComboboxState): SearchableSelectState {
  return { ...state, combobox, open: combobox.open }
}

export function update(
  state: SearchableSelectState,
  msg: SearchableSelectMsg,
): [SearchableSelectState, never[]] {
  switch (msg.type) {
    case 'open': {
      const [c] = comboboxUpdate(state.combobox, { type: 'open' })
      // Decide the initial filter. Default: empty. prefillFilter: the selected
      // label (single mode only — multi has no single label to seed).
      const seed =
        state.prefillFilter && c.selectionMode === 'single' && c.value.length > 0
          ? (c.value[0] ?? '')
          : ''
      if (seed === '') return [lift(state, c), []]
      const [c2] = comboboxUpdate(c, { type: 'setInputValue', value: seed })
      return [lift(state, { ...c2, open: true }), []]
    }
    case 'close': {
      const [c] = comboboxUpdate(state.combobox, { type: 'close' })
      // Reset the filter so the next open is clean and the trigger shows the
      // committed label, never a stale filter.
      const [c2] = comboboxUpdate(c, { type: 'setInputValue', value: '' })
      return [lift(state, { ...c2, open: false, highlightedIndex: null }), []]
    }
    case 'setFilter': {
      const [c] = comboboxUpdate(state.combobox, { type: 'setInputValue', value: msg.value })
      return [lift(state, c), []]
    }
    case 'selectValue': {
      // Filter-only contract: a value can only be committed if it is a real
      // item. This prevents free text from ever becoming the committed value.
      if (!state.combobox.items.includes(msg.value)) return [state, []]
      const [c] = comboboxUpdate(state.combobox, { type: 'selectOption', value: msg.value })
      // The picked label must never leak into the input.
      return [lift(state, resetFilter(c)), []]
    }
    case 'selectHighlighted': {
      const [c] = comboboxUpdate(state.combobox, { type: 'selectHighlighted' })
      return [lift(state, resetFilter(c)), []]
    }
    case 'setValue': {
      const [c] = comboboxUpdate(state.combobox, { type: 'setValue', value: msg.value })
      return [lift(state, c), []]
    }
    case 'clear': {
      const [c] = comboboxUpdate(state.combobox, { type: 'clear' })
      return [lift(state, c), []]
    }
    case 'highlight': {
      const [c] = comboboxUpdate(state.combobox, { type: 'highlight', index: msg.index })
      return [lift(state, c), []]
    }
    case 'highlightNext': {
      const [c] = comboboxUpdate(state.combobox, { type: 'highlightNext' })
      return [lift(state, c), []]
    }
    case 'highlightPrev': {
      const [c] = comboboxUpdate(state.combobox, { type: 'highlightPrev' })
      return [lift(state, c), []]
    }
    case 'highlightFirst': {
      const [c] = comboboxUpdate(state.combobox, { type: 'highlightFirst' })
      return [lift(state, c), []]
    }
    case 'highlightLast': {
      const [c] = comboboxUpdate(state.combobox, { type: 'highlightLast' })
      return [lift(state, c), []]
    }
    case 'triggerType': {
      // Closed-trigger typeahead: open the popup, seed the filter with the
      // typed character, and let the filter highlight the first match.
      const [c] = comboboxUpdate(state.combobox, { type: 'open' })
      const [c2] = comboboxUpdate(c, { type: 'setInputValue', value: msg.char })
      return [lift(state, c2), []]
    }
    case 'setItems': {
      const [c] = comboboxUpdate(state.combobox, {
        type: 'setItems',
        items: msg.items,
        disabled: msg.disabled,
      })
      return [lift(state, c), []]
    }
  }
}

/** After a commit, force the filter back to empty (re-deriving the filtered
 * list from the now-empty query) without touching the committed `value` or the
 * open/highlight state the combobox just computed. */
function resetFilter(c: ComboboxState): ComboboxState {
  if (c.inputValue === '') return c
  // Re-run the combobox filter against an empty query. We do this by sending a
  // setInputValue('') but preserving the open/highlight the commit produced —
  // setInputValue would re-open and re-highlight, so reconcile carefully.
  const [refiltered] = comboboxUpdate(c, { type: 'setInputValue', value: '' })
  return {
    ...refiltered,
    open: c.open,
    highlightedIndex: c.open ? refiltered.highlightedIndex : null,
  }
}

export interface SearchableSelectItemParts {
  item: {
    role: 'option'
    id: string
    'aria-selected': Signal<boolean>
    'aria-disabled': Signal<'true' | undefined>
    'data-state': Signal<'selected' | undefined>
    'data-highlighted': Signal<'' | undefined>
    'data-disabled': Signal<'' | undefined>
    'data-scope': 'searchable-select'
    'data-part': 'item'
    'data-value': string
    'data-index': string
    onClick: (e: MouseEvent) => void
    onPointerMove: (e: PointerEvent) => void
  }
}

export interface SearchableSelectGroupParts {
  group: {
    role: 'group'
    'aria-labelledby': string
    'data-scope': 'searchable-select'
    'data-part': 'group'
    'data-group': string
  }
  groupLabel: {
    id: string
    'aria-hidden': 'true'
    'data-scope': 'searchable-select'
    'data-part': 'group-label'
    'data-group': string
  }
}

export interface SearchableSelectParts {
  root: {
    'data-scope': 'searchable-select'
    'data-part': 'root'
    'data-state': Signal<'open' | 'closed'>
  }
  /** The closed-state trigger button. Displays the selection (via
   * `triggerLabel`) and opens the popup. Handles closed-trigger typeahead. */
  trigger: {
    type: 'button'
    role: 'combobox'
    'aria-haspopup': 'listbox'
    'aria-expanded': Signal<boolean>
    'aria-controls': string
    'aria-disabled': Signal<'true' | undefined>
    id: string
    disabled: Signal<boolean>
    'data-scope': 'searchable-select'
    'data-part': 'trigger'
    'data-state': Signal<'open' | 'closed'>
    onClick: (e: MouseEvent) => void
    onKeyDown: (e: KeyboardEvent) => void
  }
  /** Text to render inside the trigger: placeholder, single label, or a joined
   * multi-select summary. */
  triggerLabel: Signal<string>
  /** Whether a selection exists (drive showing/hiding the clear button). */
  hasValue: Signal<boolean>
  /** The filter input rendered inside the popup, above the listbox. */
  input: {
    type: 'text'
    role: 'combobox'
    autocomplete: 'off'
    'aria-autocomplete': 'list'
    'aria-expanded': Signal<boolean>
    'aria-controls': string
    'aria-activedescendant': Signal<string | undefined>
    id: string
    value: Signal<string>
    'data-scope': 'searchable-select'
    'data-part': 'input'
    onInput: (e: Event) => void
    onKeyDown: (e: KeyboardEvent) => void
  }
  positioner: {
    'data-scope': 'searchable-select'
    'data-part': 'positioner'
    style: string
  }
  content: {
    role: 'listbox'
    id: string
    'aria-labelledby': string
    'aria-busy': Signal<'true' | undefined>
    'aria-multiselectable': Signal<'true' | undefined>
    tabindex: -1
    'data-state': Signal<'open' | 'closed'>
    'data-status': Signal<AsyncStatus>
    'data-scope': 'searchable-select'
    'data-part': 'content'
  }
  item: (value: string, index: number) => SearchableSelectItemParts
  group: (id: string) => SearchableSelectGroupParts
  /** Clear-selection trigger. Render only when `hasValue` is true. */
  clear: {
    type: 'button'
    'aria-label': string
    tabindex: -1
    'data-scope': 'searchable-select'
    'data-part': 'clear'
    onClick: (e: MouseEvent) => void
  }
  /** Polite live region announcing the no-results / result count. */
  liveRegion: {
    role: 'status'
    'aria-live': 'polite'
    'aria-atomic': 'true'
    'data-scope': 'searchable-select'
    'data-part': 'live-region'
    text: Signal<string>
  }
  /** Empty-state container (render when the filtered list is empty). */
  empty: {
    'data-scope': 'searchable-select'
    'data-part': 'empty'
    hidden: Signal<boolean>
  }
}

export interface ConnectOptions {
  id: string
  /** aria-label for the clear button. */
  clearLabel?: string
  /** Text shown in the empty-state live region when no items match. */
  emptyText?: string
}

const SCOPE = 'searchable-select' as const

function triggerLabelOf(s: SearchableSelectState): string {
  const value = s.combobox.value
  if (value.length === 0) return s.placeholder
  return value.join(s.separator)
}

export function connect(
  state: Signal<SearchableSelectState>,
  send: Send<SearchableSelectMsg>,
  opts: ConnectOptions,
): SearchableSelectParts {
  const base = opts.id
  const triggerId = `${base}:trigger`
  const clearLabel = opts.clearLabel ?? 'Clear selection'
  const emptyText = opts.emptyText ?? 'No results'

  // Build the underlying combobox parts over the nested machine. We translate
  // combobox messages back into searchable-select messages so the wrapper's
  // filter-only / reset semantics always run.
  const comboboxSend: Send<ComboboxMsg> = (m) => {
    switch (m.type) {
      case 'open':
        send({ type: 'open' })
        return
      case 'close':
        send({ type: 'close' })
        return
      case 'setInputValue':
        send({ type: 'setFilter', value: m.value })
        return
      case 'selectOption':
        send({ type: 'selectValue', value: m.value })
        return
      case 'selectHighlighted':
        send({ type: 'selectHighlighted' })
        return
      case 'setValue':
        send({ type: 'setValue', value: m.value })
        return
      case 'clear':
        send({ type: 'clear' })
        return
      case 'highlight':
        send({ type: 'highlight', index: m.index })
        return
      case 'highlightNext':
        send({ type: 'highlightNext' })
        return
      case 'highlightPrev':
        send({ type: 'highlightPrev' })
        return
      case 'highlightFirst':
        send({ type: 'highlightFirst' })
        return
      case 'highlightLast':
        send({ type: 'highlightLast' })
        return
      case 'setItems':
        send({ type: 'setItems', items: m.items, disabled: m.disabled })
        return
      // async load messages are driven by the consumer directly; ignore here
      default:
        return
    }
  }

  const cb = comboboxConnect(
    state.map((s) => s.combobox),
    comboboxSend,
    { id: base },
  )
  const contentId = cb.content.id

  const handleTriggerKey = tagSend(
    send,
    ['open', 'highlightLast', 'triggerType'],
    (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
        case 'Enter':
        case ' ':
          e.preventDefault()
          send({ type: 'open' })
          return
        case 'ArrowUp':
          e.preventDefault()
          send({ type: 'open' })
          send({ type: 'highlightLast' })
          return
        default:
          if (isTypeaheadKey(e)) {
            e.preventDefault()
            send({ type: 'triggerType', char: e.key })
          }
      }
    },
  )

  return {
    root: {
      'data-scope': SCOPE,
      'data-part': 'root',
      'data-state': state.map((s) => (s.open ? 'open' : 'closed')),
    },
    trigger: {
      type: 'button',
      role: 'combobox',
      'aria-haspopup': 'listbox',
      'aria-expanded': state.map((s) => s.open),
      'aria-controls': contentId,
      'aria-disabled': state.map((s) => (s.combobox.disabled ? 'true' : undefined)),
      id: triggerId,
      disabled: state.map((s) => s.combobox.disabled),
      'data-scope': SCOPE,
      'data-part': 'trigger',
      'data-state': state.map((s) => (s.open ? 'open' : 'closed')),
      onClick: tagSend(send, ['open'], () => send({ type: 'open' })),
      onKeyDown: handleTriggerKey,
    },
    triggerLabel: state.map(triggerLabelOf),
    hasValue: state.map((s) => s.combobox.value.length > 0),
    input: {
      type: 'text',
      role: 'combobox',
      autocomplete: 'off',
      'aria-autocomplete': 'list',
      'aria-expanded': cb.input['aria-expanded'],
      'aria-controls': contentId,
      'aria-activedescendant': cb.input['aria-activedescendant'],
      id: cb.input.id,
      value: state.map((s) => s.combobox.inputValue),
      'data-scope': SCOPE,
      'data-part': 'input',
      onInput: tagSend(send, ['setFilter'], (e: Event) => {
        const value = (e.target as HTMLInputElement).value
        send({ type: 'setFilter', value })
      }),
      onKeyDown: cb.input.onKeyDown,
    },
    positioner: {
      'data-scope': SCOPE,
      'data-part': 'positioner',
      style: cb.positioner.style,
    },
    content: {
      role: 'listbox',
      id: contentId,
      'aria-labelledby': cb.input.id,
      'aria-busy': cb.content['aria-busy'],
      'aria-multiselectable': state.map((s) =>
        s.combobox.selectionMode === 'multiple' ? 'true' : undefined,
      ),
      tabindex: -1,
      'data-state': state.map((s) => (s.open ? 'open' : 'closed')),
      'data-status': cb.content['data-status'],
      'data-scope': SCOPE,
      'data-part': 'content',
    },
    item: (value: string, index: number): SearchableSelectItemParts => {
      const inner = cb.item(value, index).item
      return {
        item: {
          role: 'option',
          id: inner.id,
          'aria-selected': inner['aria-selected'],
          'aria-disabled': inner['aria-disabled'],
          'data-state': inner['data-state'],
          'data-highlighted': inner['data-highlighted'],
          'data-disabled': inner['data-disabled'],
          'data-scope': SCOPE,
          'data-part': 'item',
          'data-value': value,
          'data-index': String(index),
          onClick: inner.onClick,
          onPointerMove: inner.onPointerMove,
        },
      }
    },
    group: (id: string): SearchableSelectGroupParts => {
      const inner = cb.group(id)
      return {
        group: {
          role: 'group',
          'aria-labelledby': inner.group['aria-labelledby'],
          'data-scope': SCOPE,
          'data-part': 'group',
          'data-group': id,
        },
        groupLabel: {
          id: inner.groupLabel.id,
          'aria-hidden': 'true',
          'data-scope': SCOPE,
          'data-part': 'group-label',
          'data-group': id,
        },
      }
    },
    clear: {
      type: 'button',
      'aria-label': clearLabel,
      tabindex: -1,
      'data-scope': SCOPE,
      'data-part': 'clear',
      onClick: tagSend(send, ['clear'], () => send({ type: 'clear' })),
    },
    liveRegion: {
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true',
      'data-scope': SCOPE,
      'data-part': 'live-region',
      text: state.map((s) => {
        const cbs = s.combobox
        if (cbs.status === 'error') return cbs.error ?? ''
        if (!s.open) return ''
        const n = cbs.filteredItems.length
        if (n === 0) return emptyText
        return n === 1 ? '1 result' : `${n} results`
      }),
    },
    empty: {
      'data-scope': SCOPE,
      'data-part': 'empty',
      hidden: state.map((s) => s.combobox.filteredItems.length > 0),
    },
  }
}

export interface OverlayOptions {
  state: Signal<SearchableSelectState>
  send: Send<SearchableSelectMsg>
  parts: SearchableSelectParts
  /** Renders the popup body (filter input + listbox). */
  content: () => Renderable
  placement?: Placement
  offset?: number
  flip?: boolean
  shift?: boolean
  sameWidth?: boolean
  transition?: TransitionOptions
  target?: string | HTMLElement
}

export function overlay(opts: OverlayOptions): Mountable {
  // Shadcn-style anatomy: the popup is anchored to the trigger button (which is
  // what's visible while closed); the filter input lives INSIDE the popup. On
  // open we focus the input; Esc / outside-click dismiss to `close` (which
  // resets the filter). This mirrors the combobox/select overlay shape but
  // anchors to the trigger rather than the input.
  const rawTarget = opts.target ?? 'body'
  const placement = opts.placement ?? 'bottom-start'
  const offset = opts.offset ?? 4
  const flip = opts.flip !== false
  const shift = opts.shift !== false
  const sameWidth = opts.sameWidth !== false
  const parts = opts.parts
  const contentId = parts.content.id
  const inputId = parts.input.id
  const triggerId = parts.trigger.id

  return show(
    opts.state.map((s) => s.open),
    () => {
      const host = resolvePortalTarget(rawTarget) ?? document.body
      return [
        portal(() => {
          const dismissable = onMount(() => {
            const contentEl = document.getElementById(contentId)
            const triggerEl = document.getElementById(triggerId)
            const inputEl = document.getElementById(inputId)
            if (!contentEl || !triggerEl) return

            const cleanups: Array<() => void> = []
            const positioner = contentEl.closest('[data-part="positioner"]') as HTMLElement | null
            const floatingEl = positioner ?? contentEl
            if (sameWidth) {
              floatingEl.style.minWidth = `${triggerEl.offsetWidth}px`
            }
            cleanups.push(
              attachFloating({
                anchor: triggerEl,
                floating: floatingEl,
                placement,
                offset,
                flip,
                shift,
              }),
            )
            cleanups.push(
              pushDismissable({
                element: contentEl,
                ignore: () => [triggerEl],
                onDismiss: () => {
                  opts.send({ type: 'close' })
                  triggerEl.focus()
                },
              }),
            )
            if (inputEl instanceof HTMLInputElement) {
              inputEl.focus({ preventScroll: true })
              const seed = inputEl.value
              // prefillFilter convention: when the filter is pre-seeded, select it
              // all so the user's first keystroke replaces it.
              if (seed !== '') inputEl.setSelectionRange(0, seed.length)
            }
            return () => {
              for (let i = cleanups.length - 1; i >= 0; i--) cleanups[i]!()
            }
          })
          return [dismissable, div(parts.positioner, opts.content())]
        }, host),
      ]
    },
  )
}

export const searchableSelect = { init, update, connect, overlay }
