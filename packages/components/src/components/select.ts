import type { Send, Signal, Mountable, Renderable, TransitionOptions } from '@llui/dom'
import { tagSend } from '@llui/dom'
import { type Placement } from '../utils/floating.js'
import { resolvePortalTarget } from '../utils/portal-target.js'
import { createOverlay } from '../utils/overlay-engine.js'
import {
  typeaheadAccumulate,
  typeaheadMatchByItems,
  isTypeaheadKey,
  TYPEAHEAD_TIMEOUT_MS,
} from '../utils/typeahead.js'

/**
 * Select — a trigger button that opens a listbox dropdown. Value(s) are
 * visible on the trigger. Supports single or multiple selection.
 * Positioned relative to the trigger via `@floating-ui/dom`.
 */

export type SelectionMode = 'single' | 'multiple'

/**
 * A labelled section of options (rendered like `<optgroup>`). `items` are the
 * option VALUES belonging to the group, in visual order. Groups are an
 * additive, parallel structure: the flat `items` list always remains the
 * source of truth for navigation/highlight indices and item ids — when
 * `groups` is provided without an explicit `items` list, `init` derives the
 * flat list by concatenating each group's `items` in order. A plain flat
 * `string[]` (no groups) keeps working unchanged. Group LABELS are never
 * options, so highlight/typeahead/arrow navigation skips over them for free.
 */
export interface SelectGroup {
  id: string
  label: string
  items: string[]
}

export interface SelectState {
  open: boolean
  value: string[]
  items: string[]
  groups: SelectGroup[]
  disabledItems: string[]
  selectionMode: SelectionMode
  /** The highlighted option's VALUE (not its index). Value-based identity keeps
   * the highlight pinned to the right option when the list is filtered or
   * reordered and rows are reused (value-keyed `each`). */
  highlightedValue: string | null
  disabled: boolean
  required: boolean
  typeahead: string
  typeaheadExpiresAt: number
}

export type SelectMsg =
  /** @intent("Open the select dropdown") */
  | { type: 'open' }
  /** @intent("Close the select dropdown") */
  | { type: 'close' }
  /** @intent("Toggle the select dropdown open/closed") */
  | { type: 'toggle' }
  /** @intent("Pick the option with the given value (toggles in multi-select)") */
  | { type: 'selectOption'; value: string }
  /** @intent("Replace the selected values with the provided list") */
  | { type: 'setValue'; value: string[] }
  /** @intent("Clear all selected values") */
  | { type: 'clear' }
  /** @humanOnly */
  | { type: 'highlight'; value: string | null }
  /** @humanOnly */
  | { type: 'highlightNext' }
  /** @humanOnly */
  | { type: 'highlightPrev' }
  /** @humanOnly */
  | { type: 'highlightFirst' }
  /** @humanOnly */
  | { type: 'highlightLast' }
  /** @intent("Pick the currently-highlighted option") */
  | { type: 'selectHighlighted' }
  /** @humanOnly */
  | { type: 'setItems'; items: string[]; disabled?: string[] }
  /** @humanOnly */
  | { type: 'typeahead'; char: string; now: number }

export interface SelectInit {
  value?: string[]
  items?: string[]
  /** Optional labelled sections. When provided without `items`, the flat
   * `items` list is derived by concatenating each group's `items` in order. */
  groups?: SelectGroup[]
  disabledItems?: string[]
  selectionMode?: SelectionMode
  disabled?: boolean
  required?: boolean
}

export function init(opts: SelectInit = {}): SelectState {
  const groups = opts.groups ?? []
  const items = opts.items ?? groups.flatMap((g) => g.items)
  return {
    open: false,
    value: opts.value ?? [],
    items,
    groups,
    disabledItems: opts.disabledItems ?? [],
    selectionMode: opts.selectionMode ?? 'single',
    highlightedValue: null,
    disabled: opts.disabled ?? false,
    required: opts.required ?? false,
    typeahead: '',
    typeaheadExpiresAt: 0,
  }
}

function firstEnabledIndex(items: string[], disabled: string[]): number | null {
  for (let i = 0; i < items.length; i++) {
    if (!disabled.includes(items[i]!)) return i
  }
  return null
}

function lastEnabledIndex(items: string[], disabled: string[]): number | null {
  for (let i = items.length - 1; i >= 0; i--) {
    if (!disabled.includes(items[i]!)) return i
  }
  return null
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
    if (!disabled.includes(items[idx]!)) return idx
  }
  return null
}

function applySelection(state: SelectState, value: string): string[] {
  if (state.disabledItems.includes(value)) return state.value
  if (state.selectionMode === 'single') return [value]
  const isActive = state.value.includes(value)
  return isActive ? state.value.filter((v) => v !== value) : [...state.value, value]
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

/** The VALUE of the first selected item (when it still exists), or null. */
function firstSelectedValue(state: SelectState): string | null {
  const v = state.value[0]
  if (v === undefined) return null
  return state.items.includes(v) ? v : null
}

/** The value to highlight when the listbox opens: the first selected option, or
 * the first enabled option. */
function highlightOnOpen(state: SelectState): string | null {
  return (
    firstSelectedValue(state) ??
    valueAt(state.items, firstEnabledIndex(state.items, state.disabledItems))
  )
}

export function update(state: SelectState, msg: SelectMsg): [SelectState, never[]] {
  if (state.disabled && msg.type !== 'setItems') return [state, []]
  switch (msg.type) {
    case 'open':
      return [{ ...state, open: true, highlightedValue: highlightOnOpen(state) }, []]
    case 'close':
      return [{ ...state, open: false, highlightedValue: null }, []]
    case 'toggle':
      return state.open
        ? [{ ...state, open: false, highlightedValue: null }, []]
        : [{ ...state, open: true, highlightedValue: highlightOnOpen(state) }, []]
    case 'selectOption': {
      const value = applySelection(state, msg.value)
      // Single mode closes on selection; multi stays open
      const open = state.selectionMode === 'single' ? false : state.open
      const highlightedValue = open ? state.highlightedValue : null
      return [{ ...state, value, open, highlightedValue }, []]
    }
    case 'setValue':
      return [{ ...state, value: msg.value }, []]
    case 'clear':
      return [{ ...state, value: [] }, []]
    case 'highlight':
      // No-op when already at the target: return the same reference so the
      // pointer-move storm doesn't trigger a commit on every mouse tick.
      if (state.highlightedValue === msg.value) return [state, []]
      return [{ ...state, highlightedValue: msg.value }, []]
    case 'highlightNext':
      return [
        {
          ...state,
          highlightedValue: valueAt(
            state.items,
            nextEnabledIndex(
              state.items,
              state.disabledItems,
              indexOfValue(state.items, state.highlightedValue),
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
            state.items,
            nextEnabledIndex(
              state.items,
              state.disabledItems,
              indexOfValue(state.items, state.highlightedValue),
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
          highlightedValue: valueAt(
            state.items,
            firstEnabledIndex(state.items, state.disabledItems),
          ),
        },
        [],
      ]
    case 'highlightLast':
      return [
        {
          ...state,
          highlightedValue: valueAt(
            state.items,
            lastEnabledIndex(state.items, state.disabledItems),
          ),
        },
        [],
      ]
    case 'selectHighlighted': {
      const v = state.highlightedValue
      if (v === null || !state.items.includes(v)) return [state, []]
      const value = applySelection(state, v)
      const open = state.selectionMode === 'single' ? false : state.open
      return [{ ...state, value, open, highlightedValue: open ? state.highlightedValue : null }, []]
    }
    case 'setItems': {
      const disabled = msg.disabled ?? state.disabledItems
      const value = state.value.filter((v) => msg.items.includes(v) && !disabled.includes(v))
      // Drop the highlight when its value no longer exists (or became disabled).
      const highlightedValue =
        state.highlightedValue !== null &&
        msg.items.includes(state.highlightedValue) &&
        !disabled.includes(state.highlightedValue)
          ? state.highlightedValue
          : null
      return [{ ...state, items: msg.items, disabledItems: disabled, value, highlightedValue }, []]
    }
    case 'typeahead': {
      const acc = typeaheadAccumulate(state.typeahead, msg.char, msg.now, state.typeaheadExpiresAt)
      const match = typeaheadMatchByItems(
        state.items,
        state.disabledItems,
        acc,
        indexOfValue(state.items, state.highlightedValue),
      )
      return [
        {
          ...state,
          typeahead: acc,
          typeaheadExpiresAt: msg.now + TYPEAHEAD_TIMEOUT_MS,
          highlightedValue: match === null ? state.highlightedValue : valueAt(state.items, match),
        },
        [],
      ]
    }
  }
}

export interface SelectItemParts {
  item: {
    role: 'option'
    id: string
    'aria-selected': Signal<boolean>
    'aria-disabled': Signal<'true' | undefined>
    'data-state': Signal<'selected' | undefined>
    'data-highlighted': Signal<'' | undefined>
    'data-disabled': Signal<'' | undefined>
    'data-scope': 'select'
    'data-part': 'item'
    'data-value': string
    /** The option's live position in the flat item list (reactive — reused rows
     * never report a stale index). */
    'data-index': Signal<string>
    onClick: (e: MouseEvent) => void
    onPointerMove: (e: PointerEvent) => void
  }
}

export interface SelectGroupParts {
  group: {
    role: 'group'
    'aria-labelledby': string
    'data-scope': 'select'
    'data-part': 'group'
    'data-group': string
  }
  groupLabel: {
    id: string
    'aria-hidden': 'true'
    'data-scope': 'select'
    'data-part': 'group-label'
    'data-group': string
  }
}

export interface SelectParts {
  trigger: {
    type: 'button'
    role: 'combobox'
    'aria-haspopup': 'listbox'
    'aria-expanded': Signal<boolean>
    'aria-controls': string
    'aria-activedescendant': Signal<string | undefined>
    'aria-disabled': Signal<'true' | undefined>
    'aria-required': Signal<'true' | undefined>
    id: string
    disabled: Signal<boolean>
    'data-state': Signal<'open' | 'closed'>
    'data-scope': 'select'
    'data-part': 'trigger'
    onClick: (e: MouseEvent) => void
    onKeyDown: (e: KeyboardEvent) => void
  }
  positioner: {
    'data-scope': 'select'
    'data-part': 'positioner'
    style: string
  }
  content: {
    role: 'listbox'
    id: string
    'aria-multiselectable': Signal<'true' | undefined>
    'aria-labelledby': string
    tabindex: -1
    'data-state': Signal<'open' | 'closed'>
    'data-scope': 'select'
    'data-part': 'content'
    onKeyDown: (e: KeyboardEvent) => void
  }
  hiddenSelect: {
    'aria-hidden': 'true'
    tabindex: -1
    style: string
    /** Native form field name, or `undefined` when `name` was not supplied. */
    name: string | undefined
    disabled: Signal<boolean>
    multiple: Signal<boolean>
    required: Signal<boolean>
    'data-scope': 'select'
    'data-part': 'hidden-select'
  }
  /** An `<option>` for the hidden native `<select>`. Render one per item inside
   * `hiddenSelect` so the browser submits the selection under the form `name`. */
  hiddenOption: (value: string) => {
    value: string
    selected: Signal<boolean>
    'data-scope': 'select'
    'data-part': 'hidden-option'
  }
  /** Build the parts for an option by VALUE. The optional `index` is accepted
   * for call-site convenience only — it is NOT used for identity (highlight,
   * selection and ids are all value-keyed), so a reused row is never stale. */
  item: (value: string, index?: number) => SelectItemParts
  /** Parts for a labelled option group (`<optgroup>`-style section). Pass the
   * group id; render the section element with `group` and its label element
   * (referenced by `aria-labelledby`) with `groupLabel`. Group labels are not
   * options, so navigation skips them automatically. */
  group: (id: string) => SelectGroupParts
  /** Selected value(s) — use for rendering the trigger label. */
  valueText: Signal<string>
}

export interface ConnectOptions {
  id: string
  /** Text to show in trigger when empty. */
  placeholder?: string
  /** Join multi-value labels with this separator. */
  separator?: string
  /**
   * Native form-field name. When set, the `hiddenSelect` part becomes a real
   * form control that submits the current selection under this name — render
   * `<select {...parts.hiddenSelect}>` with one `<option {...parts.hiddenOption(v)}>`
   * per item. Without a `name`, the hidden select carries no value into a form.
   */
  name?: string
}

const HIDDEN_STYLE =
  'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;'

export function connect(
  state: Signal<SelectState>,
  send: Send<SelectMsg>,
  opts: ConnectOptions,
): SelectParts {
  const base = opts.id
  const triggerId = `${base}:trigger`
  const contentId = `${base}:content`
  const itemId = (value: string): string => `${base}:item:${encodeURIComponent(value)}`
  const groupLabelId = (id: string): string => `${base}:group:${id}:label`
  const placeholder = opts.placeholder ?? ''
  const separator = opts.separator ?? ', '

  // Single keydown handler. DOM focus, aria-activedescendant, and this handler
  // all live on the TRIGGER (the combobox element) — the trigger-focused ARIA
  // pattern. Branch on open state: closed → open the popup; open → navigate the
  // (virtually-focused) options without ever moving DOM focus off the trigger.
  // Wired to BOTH trigger and content so it stays correct regardless of which
  // element is focused.
  const handleKey = (e: KeyboardEvent): void => {
    if (!(state.peek()?.open ?? false)) {
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
      }
      return
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        send({ type: 'highlightNext' })
        return
      case 'ArrowUp':
        e.preventDefault()
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
      case ' ':
        e.preventDefault()
        send({ type: 'selectHighlighted' })
        return
      case 'Escape':
        e.preventDefault()
        send({ type: 'close' })
        return
      default:
        if (isTypeaheadKey(e)) {
          send({ type: 'typeahead', char: e.key, now: Date.now() })
        }
    }
  }

  return {
    trigger: {
      type: 'button',
      role: 'combobox',
      'aria-haspopup': 'listbox',
      'aria-expanded': state.map((s) => s.open),
      'aria-controls': contentId,
      'aria-activedescendant': state.map((s) =>
        s.highlightedValue === null ? undefined : itemId(s.highlightedValue),
      ),
      'aria-disabled': state.map((s) => (s.disabled ? 'true' : undefined)),
      'aria-required': state.map((s) => (s.required ? 'true' : undefined)),
      id: triggerId,
      disabled: state.map((s) => s.disabled),
      'data-state': state.map((s) => (s.open ? 'open' : 'closed')),
      'data-scope': 'select',
      'data-part': 'trigger',
      onClick: tagSend(send, ['toggle'], () => send({ type: 'toggle' })),
      onKeyDown: handleKey,
    },
    positioner: {
      'data-scope': 'select',
      'data-part': 'positioner',
      style: 'position:absolute;top:0;left:0;',
    },
    content: {
      role: 'listbox',
      id: contentId,
      'aria-multiselectable': state.map((s) =>
        s.selectionMode === 'multiple' ? 'true' : undefined,
      ),
      'aria-labelledby': triggerId,
      tabindex: -1,
      'data-state': state.map((s) => (s.open ? 'open' : 'closed')),
      'data-scope': 'select',
      'data-part': 'content',
      onKeyDown: handleKey,
    },
    hiddenSelect: {
      'aria-hidden': 'true',
      tabindex: -1,
      style: HIDDEN_STYLE,
      name: opts.name,
      disabled: state.map((s) => s.disabled),
      multiple: state.map((s) => s.selectionMode === 'multiple'),
      required: state.map((s) => s.required),
      'data-scope': 'select',
      'data-part': 'hidden-select',
    },
    hiddenOption: (value: string) => ({
      value,
      selected: state.map((s) => s.value.includes(value)),
      'data-scope': 'select',
      'data-part': 'hidden-option',
    }),
    item: (value: string): SelectItemParts => ({
      item: {
        role: 'option',
        id: itemId(value),
        'aria-selected': state.map((s) => s.value.includes(value)),
        'aria-disabled': state.map((s) => (s.disabledItems.includes(value) ? 'true' : undefined)),
        'data-state': state.map((s) => (s.value.includes(value) ? 'selected' : undefined)),
        'data-highlighted': state.map((s) => (s.highlightedValue === value ? '' : undefined)),
        'data-disabled': state.map((s) => (s.disabledItems.includes(value) ? '' : undefined)),
        'data-scope': 'select',
        'data-part': 'item',
        'data-value': value,
        'data-index': state.map((s) => String(s.items.indexOf(value))),
        onClick: tagSend(send, ['selectOption'], () => send({ type: 'selectOption', value })),
        onPointerMove: tagSend(send, ['highlight'], () => {
          if (state.peek()?.highlightedValue === value) return
          send({ type: 'highlight', value })
        }),
      },
    }),
    group: (id: string): SelectGroupParts => ({
      group: {
        role: 'group',
        'aria-labelledby': groupLabelId(id),
        'data-scope': 'select',
        'data-part': 'group',
        'data-group': id,
      },
      groupLabel: {
        id: groupLabelId(id),
        'aria-hidden': 'true',
        'data-scope': 'select',
        'data-part': 'group-label',
        'data-group': id,
      },
    }),
    valueText: state.map((s) => {
      const v = s.value
      if (v.length === 0) return placeholder
      return v.join(separator)
    }),
  }
}

export interface OverlayOptions {
  state: Signal<SelectState>
  send: Send<SelectMsg>
  parts: SelectParts
  content: () => Renderable
  /**
   * Optional enter/leave transition for the select listbox (from
   * `@llui/transitions`). `enter` animates it in on open; `leave` defers the
   * unmount until its promise resolves, giving the raw-`open` select an exit
   * animation for free. Omitted ⇒ the listbox closes synchronously as before.
   *
   * @example select.overlay({ state, send, parts, content, transition: fade({ duration: 120 }) })
   */
  transition?: TransitionOptions
  placement?: Placement
  offset?: number
  flip?: boolean
  shift?: boolean
  /** Match content width to trigger width (default: true). */
  sameWidth?: boolean
  target?: string | HTMLElement
}

export function overlay(opts: OverlayOptions): Mountable {
  // Trigger-focused ARIA pattern: DOM focus stays on the trigger (which carries
  // aria-activedescendant + the keydown handler); the listbox is never focused.
  // On close, focus is restored to the trigger when it lingered inside the
  // overlay (e.g. after picking an option, which would otherwise drop focus to
  // <body>).
  return createOverlay({
    state: opts.state,
    transition: opts.transition,
    host: resolvePortalTarget(opts.target ?? 'body'),
    positioner: opts.parts.positioner,
    content: opts.content,
    contentId: opts.parts.content.id,
    anchorId: opts.parts.trigger.id,
    requireAnchor: true,
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
    focusOnOpenId: opts.parts.trigger.id,
    restoreFocus: { boundary: 'content', allowAnchorActive: true },
  })
}

export const select = { init, update, connect, overlay }
