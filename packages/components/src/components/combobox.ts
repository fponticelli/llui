import type { Send, Signal, TransitionOptions, Mountable, Renderable } from '@llui/dom'
import { show, portal, onMount, div, useContext, tagSend } from '@llui/dom'
import { LocaleContext } from '../locale.js'
import { pushDismissable } from '../utils/dismissable.js'
import { resolvePortalTarget } from '../utils/portal-target.js'
import { attachFloating, type Placement } from '../utils/floating.js'

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
  highlightedIndex: number | null
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
  | { type: 'highlight'; index: number | null }
  /** @intent("Pick the currently-highlighted option in the filtered list") */
  | { type: 'selectHighlighted' }
  /** @humanOnly */
  | { type: 'setItems'; items: string[]; disabled?: string[] }
  /** @intent("Mark an async option fetch as started; pass the request's id") */
  | { type: 'loadStart'; requestId: number }
  /** @humanOnly */
  | { type: 'loadSuccess'; requestId: number; items: string[] }
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
    highlightedIndex: null,
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

function nextEnabledIndex(
  items: string[],
  disabled: string[],
  from: number | null,
  delta: 1 | -1,
): number | null {
  if (items.length === 0) return null
  const start = from === null ? (delta === 1 ? -1 : items.length) : from
  const n = items.length
  for (let i = 1; i <= n; i++) {
    const idx = (start + delta * i + n * n) % n
    const v = items[idx]!
    if (v === CREATE_OPTION_VALUE || !disabled.includes(v)) return idx
  }
  return null
}

function firstEnabledIndex(items: string[], disabled: string[]): number | null {
  for (let i = 0; i < items.length; i++) {
    const v = items[i]!
    if (v === CREATE_OPTION_VALUE || !disabled.includes(v)) return i
  }
  return null
}

function lastEnabledIndex(items: string[], disabled: string[]): number | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const v = items[i]!
    if (v === CREATE_OPTION_VALUE || !disabled.includes(v)) return i
  }
  return null
}

function applySelection(state: ComboboxState, value: string): string[] {
  if (state.disabledItems.includes(value)) return state.value
  if (state.selectionMode === 'single') return [value]
  const isActive = state.value.includes(value)
  return isActive ? state.value.filter((v) => v !== value) : [...state.value, value]
}

/** Commit a normal (non-create) option pick. */
function commitSelection(state: ComboboxState, picked: string): [ComboboxState, ComboboxEffect[]] {
  const value = applySelection(state, picked)
  const inputValue = state.selectionMode === 'single' ? picked : ''
  const filteredItems = computeFiltered(state.items, inputValue, state.allowCreate)
  const open = state.selectionMode === 'single' ? false : state.open
  return [
    {
      ...state,
      value,
      inputValue,
      filteredItems,
      open,
      highlightedIndex: open ? state.highlightedIndex : null,
    },
    [],
  ]
}

export function update(state: ComboboxState, msg: ComboboxMsg): [ComboboxState, ComboboxEffect[]] {
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
          highlightedIndex: state.open
            ? state.highlightedIndex
            : firstEnabledIndex(state.filteredItems, state.disabledItems),
        },
        [],
      ]
    case 'close':
      return [{ ...state, open: false, highlightedIndex: null }, []]
    case 'setInputValue': {
      const filteredItems = computeFiltered(state.items, msg.value, state.allowCreate)
      return [
        {
          ...state,
          inputValue: msg.value,
          filteredItems,
          open: true,
          highlightedIndex: firstEnabledIndex(filteredItems, state.disabledItems),
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
          highlightedIndex: null,
        },
        [],
      ]
    case 'highlight':
      return [{ ...state, highlightedIndex: msg.index }, []]
    case 'highlightNext':
      return [
        {
          ...state,
          highlightedIndex: nextEnabledIndex(
            state.filteredItems,
            state.disabledItems,
            state.highlightedIndex,
            1,
          ),
        },
        [],
      ]
    case 'highlightPrev':
      return [
        {
          ...state,
          highlightedIndex: nextEnabledIndex(
            state.filteredItems,
            state.disabledItems,
            state.highlightedIndex,
            -1,
          ),
        },
        [],
      ]
    case 'highlightFirst':
      return [
        { ...state, highlightedIndex: firstEnabledIndex(state.filteredItems, state.disabledItems) },
        [],
      ]
    case 'highlightLast':
      return [
        { ...state, highlightedIndex: lastEnabledIndex(state.filteredItems, state.disabledItems) },
        [],
      ]
    case 'selectHighlighted': {
      if (state.highlightedIndex === null) return [state, []]
      const v = state.filteredItems[state.highlightedIndex]
      if (v === undefined) return [state, []]
      if (v === CREATE_OPTION_VALUE) {
        return [state, [{ type: 'createOption', value: state.inputValue }]]
      }
      return commitSelection(state, v)
    }
    case 'setItems': {
      const disabled = msg.disabled ?? state.disabledItems
      const value = state.value.filter((v) => msg.items.includes(v) && !disabled.includes(v))
      const filteredItems = computeFiltered(msg.items, state.inputValue, state.allowCreate)
      // Clamp the highlight to the new list: a shrinking setItems can leave the
      // previous index out of bounds, which would dangle aria-activedescendant.
      const highlightedIndex =
        state.highlightedIndex !== null && state.highlightedIndex < filteredItems.length
          ? state.highlightedIndex
          : null
      return [
        {
          ...state,
          items: msg.items,
          disabledItems: disabled,
          filteredItems,
          highlightedIndex,
          value,
        },
        [],
      ]
    }
    case 'loadStart':
      return [{ ...state, status: 'loading', requestId: msg.requestId, error: null }, []]
    case 'loadSuccess': {
      // Drop responses from superseded requests (stale-response protection).
      if (msg.requestId !== state.requestId) return [state, []]
      return [
        {
          ...state,
          items: msg.items,
          filteredItems: computeFiltered(msg.items, state.inputValue, state.allowCreate),
          highlightedIndex: null,
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
    'data-index': string
    onClick: (e: MouseEvent) => void
    onPointerMove: (e: PointerEvent) => void
  }
}

export interface ComboboxGroupParts {
  group: {
    role: 'group'
    'aria-labelledby': string
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
    role: 'combobox'
    'aria-expanded': Signal<boolean>
    'aria-controls': string
    'aria-haspopup': 'listbox'
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
    'data-scope': 'combobox'
    'data-part': 'content'
  }
  item: (value: string, index: number) => ComboboxItemParts
  /** Parts for a labelled option group (`<optgroup>`-style section). Pass the
   * group id; render the section element with `group` and its label element
   * (referenced by `aria-labelledby`) with `groupLabel`. Group labels are not
   * options, so navigation skips them automatically. Mirrors `select`. */
  group: (id: string) => ComboboxGroupParts
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
  const locale = useContext(LocaleContext)
  const base = opts.id
  const inputId = `${base}:input`
  const contentId = `${base}:content`
  const itemId = (index: number): string => `${base}:item:${index}`
  const groupLabelId = (id: string): string => `${base}:group:${id}:label`
  const triggerLabel = opts.triggerLabel ?? locale.combobox.toggle

  const countText = (n: number): string => (n === 1 ? '1 result' : `${n} results`)

  return {
    root: {
      role: 'combobox',
      'aria-expanded': state.map((s) => s.open),
      'aria-controls': contentId,
      'aria-haspopup': 'listbox',
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
      'aria-activedescendant': state.map((s) => {
        const idx = s.highlightedIndex
        return idx === null ? undefined : itemId(idx)
      }),
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
      'data-scope': 'combobox',
      'data-part': 'content',
    },
    item: (value: string, index: number): ComboboxItemParts => {
      const isCreate = value === CREATE_OPTION_VALUE
      return {
        item: {
          role: 'option',
          id: itemId(index),
          'aria-selected': state.map((s) => s.value.includes(value)),
          'aria-disabled': state.map((s) =>
            !isCreate && s.disabledItems.includes(value) ? 'true' : undefined,
          ),
          'data-state': state.map((s) => (s.value.includes(value) ? 'selected' : undefined)),
          'data-highlighted': state.map((s) => (s.highlightedIndex === index ? '' : undefined)),
          'data-disabled': state.map((s) =>
            !isCreate && s.disabledItems.includes(value) ? '' : undefined,
          ),
          'data-create': isCreate ? '' : undefined,
          'data-scope': 'combobox',
          'data-part': 'item',
          'data-value': value,
          'data-index': String(index),
          onClick: tagSend(send, ['selectOption'], () => send({ type: 'selectOption', value })),
          onPointerMove: tagSend(send, ['highlight'], () => send({ type: 'highlight', index })),
        },
      }
    },
    group: (id: string): ComboboxGroupParts => ({
      group: {
        role: 'group',
        'aria-labelledby': groupLabelId(id),
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
        if (s.status === 'loaded') {
          const n = s.filteredItems.filter((v) => v !== CREATE_OPTION_VALUE).length
          return countText(n)
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
  state: Signal<ComboboxState>
  send: Send<ComboboxMsg>
  parts: ComboboxParts
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
  const targetOpt = opts.target ?? 'body'
  const placement = opts.placement ?? 'bottom-start'
  const offset = opts.offset ?? 4
  const flip = opts.flip !== false
  const shift = opts.shift !== false
  const sameWidth = opts.sameWidth !== false
  const parts = opts.parts
  const contentId = parts.content.id
  const inputId = parts.input.id
  const host = resolvePortalTarget(targetOpt)

  return show(
    opts.state.map((s) => s.open),
    () => [
      portal(() => {
        const dismissable = onMount(() => {
          const contentEl = document.getElementById(contentId)
          const inputEl = document.getElementById(inputId)
          if (!contentEl || !inputEl) return

          const cleanups: Array<() => void> = []
          const positioner = contentEl.closest('[data-part="positioner"]') as HTMLElement | null
          const floatingEl = positioner ?? contentEl
          if (sameWidth) {
            floatingEl.style.minWidth = `${inputEl.offsetWidth}px`
          }
          cleanups.push(
            attachFloating({
              anchor: inputEl,
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
              ignore: () => [inputEl],
              onDismiss: () => opts.send({ type: 'close' }),
            }),
          )
          return () => {
            for (let i = cleanups.length - 1; i >= 0; i--) cleanups[i]!()
          }
        })
        return [dismissable, div(parts.positioner, opts.content())]
      }, host),
    ],
  )
}

export const combobox = { init, update, connect, overlay, isCreateOption, CREATE_OPTION_VALUE }
