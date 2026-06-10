import { tagSend } from '@llui/dom'
import type { Send, Signal } from '@llui/dom'

/**
 * Toolbar — a roving-tabindex container for a set of controls (buttons,
 * toggles, menu triggers). The toolbar is a single tab stop: Tab moves focus
 * into the active item and a subsequent Tab leaves the toolbar entirely. Arrow
 * keys rove focus between enabled items, skipping separators and disabled
 * items; Home/End jump to the first/last enabled item.
 *
 * Toolbar is interaction-agnostic: an item may itself be a toggle or a menu
 * trigger. The toolbar only manages which item holds the single tab stop.
 */

export type Orientation = 'horizontal' | 'vertical'

export interface ToolbarState {
  items: string[]
  disabledItems: string[]
  focused: string | null
  orientation: Orientation
  loopFocus: boolean
  disabled: boolean
}

export type ToolbarMsg =
  /** @humanOnly */
  | { type: 'setItems'; items: string[]; disabled?: string[] }
  /** @humanOnly */
  | { type: 'setFocused'; value: string }
  /** @humanOnly */
  | { type: 'focusNext'; from: string }
  /** @humanOnly */
  | { type: 'focusPrev'; from: string }
  /** @humanOnly */
  | { type: 'focusFirst' }
  /** @humanOnly */
  | { type: 'focusLast' }

export interface ToolbarInit {
  items?: string[]
  disabledItems?: string[]
  focused?: string | null
  orientation?: Orientation
  loopFocus?: boolean
  disabled?: boolean
}

export function init(opts: ToolbarInit = {}): ToolbarState {
  return {
    items: opts.items ?? [],
    disabledItems: opts.disabledItems ?? [],
    focused: opts.focused ?? null,
    orientation: opts.orientation ?? 'horizontal',
    loopFocus: opts.loopFocus ?? true,
    disabled: opts.disabled ?? false,
  }
}

function nextEnabled(
  items: string[],
  disabled: string[],
  from: string,
  delta: 1 | -1,
  loop: boolean,
): string | null {
  if (items.length === 0) return null
  const idx = items.indexOf(from)
  if (idx === -1) return null
  const n = items.length
  for (let i = 1; i <= n; i++) {
    const raw = idx + delta * i
    if (!loop && (raw < 0 || raw >= n)) return null
    const next = items[((raw % n) + n) % n]!
    if (!disabled.includes(next)) return next
  }
  return null
}

function firstEnabled(items: string[], disabled: string[]): string | null {
  for (const v of items) if (!disabled.includes(v)) return v
  return null
}

function lastEnabled(items: string[], disabled: string[]): string | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const v = items[i]!
    if (!disabled.includes(v)) return v
  }
  return null
}

export function update(state: ToolbarState, msg: ToolbarMsg): [ToolbarState, never[]] {
  if (state.disabled && msg.type !== 'setItems') return [state, []]
  switch (msg.type) {
    case 'setItems': {
      const disabled = msg.disabled ?? state.disabledItems
      const focused =
        state.focused && msg.items.includes(state.focused) && !disabled.includes(state.focused)
          ? state.focused
          : null
      return [{ ...state, items: msg.items, disabledItems: disabled, focused }, []]
    }
    case 'setFocused':
      if (!state.items.includes(msg.value) || state.disabledItems.includes(msg.value))
        return [state, []]
      return [{ ...state, focused: msg.value }, []]
    case 'focusNext': {
      const to = nextEnabled(state.items, state.disabledItems, msg.from, 1, state.loopFocus)
      return to === null ? [state, []] : [{ ...state, focused: to }, []]
    }
    case 'focusPrev': {
      const to = nextEnabled(state.items, state.disabledItems, msg.from, -1, state.loopFocus)
      return to === null ? [state, []] : [{ ...state, focused: to }, []]
    }
    case 'focusFirst': {
      const to = firstEnabled(state.items, state.disabledItems)
      return to === null ? [state, []] : [{ ...state, focused: to }, []]
    }
    case 'focusLast': {
      const to = lastEnabled(state.items, state.disabledItems)
      return to === null ? [state, []] : [{ ...state, focused: to }, []]
    }
  }
}

export interface ToolbarItemParts {
  root: {
    'data-scope': 'toolbar'
    'data-part': 'item'
    'data-value': string
    'data-disabled': Signal<'' | undefined>
    'aria-disabled': Signal<'true' | undefined>
    tabindex: Signal<number>
    onKeyDown: (e: KeyboardEvent) => void
    onFocus: () => void
  }
}

export interface ToolbarGroupParts {
  root: {
    role: 'group'
    'data-scope': 'toolbar'
    'data-part': 'group'
    'aria-labelledby': string
  }
  label: {
    id: string
    'data-scope': 'toolbar'
    'data-part': 'group-label'
  }
}

export interface ToolbarParts {
  root: {
    role: 'toolbar'
    'aria-orientation': Signal<Orientation>
    'aria-label': string | undefined
    'aria-disabled': Signal<'true' | undefined>
    'data-scope': 'toolbar'
    'data-part': 'root'
    'data-orientation': Signal<Orientation>
    'data-disabled': Signal<'' | undefined>
  }
  separator: {
    role: 'separator'
    'aria-orientation': Signal<Orientation>
    'data-scope': 'toolbar'
    'data-part': 'separator'
  }
  item: (value: string) => ToolbarItemParts
  group: (label: string) => ToolbarGroupParts
}

export interface ConnectOptions {
  id: string
  label?: string
}

export function connect(
  state: Signal<ToolbarState>,
  send: Send<ToolbarMsg>,
  opts: ConnectOptions,
): ToolbarParts {
  const groupLabelId = (label: string): string => `${opts.id}:group:${label}`

  // The toolbar is a single tab stop: the focused item (or, if none is
  // focused, the first enabled item) carries tabindex 0; every other item is
  // -1 and is reached only via arrow keys.
  const tabStop = (value: string): Signal<number> =>
    state.map((s) => {
      if (s.disabled || s.disabledItems.includes(value)) return -1
      if (s.focused === value) return 0
      if (s.focused === null && firstEnabled(s.items, s.disabledItems) === value) return 0
      return -1
    })

  return {
    root: {
      role: 'toolbar',
      'aria-orientation': state.map((s) => s.orientation),
      'aria-label': opts.label,
      'aria-disabled': state.map((s) => (s.disabled ? 'true' : undefined)),
      'data-scope': 'toolbar',
      'data-part': 'root',
      'data-orientation': state.map((s) => s.orientation),
      'data-disabled': state.map((s) => (s.disabled ? '' : undefined)),
    },
    separator: {
      role: 'separator',
      // A separator's orientation is flipped relative to the toolbar: a
      // horizontal toolbar gets vertical separators and vice versa.
      'aria-orientation': state.map((s) =>
        s.orientation === 'horizontal' ? 'vertical' : 'horizontal',
      ),
      'data-scope': 'toolbar',
      'data-part': 'separator',
    },
    item: (value: string): ToolbarItemParts => ({
      root: {
        'data-scope': 'toolbar',
        'data-part': 'item',
        'data-value': value,
        'data-disabled': state.map((s) =>
          s.disabledItems.includes(value) || s.disabled ? '' : undefined,
        ),
        'aria-disabled': state.map((s) =>
          s.disabledItems.includes(value) || s.disabled ? 'true' : undefined,
        ),
        tabindex: tabStop(value),
        onFocus: tagSend(send, ['setFocused'], () => send({ type: 'setFocused', value })),
        onKeyDown: tagSend(send, ['focusNext', 'focusPrev', 'focusFirst', 'focusLast'], (e) => {
          const isVertical =
            (e.currentTarget as HTMLElement | null)?.closest('[data-orientation="vertical"]') !==
            null
          const nextKey = isVertical ? 'ArrowDown' : 'ArrowRight'
          const prevKey = isVertical ? 'ArrowUp' : 'ArrowLeft'
          switch (e.key) {
            case nextKey:
              e.preventDefault()
              send({ type: 'focusNext', from: value })
              return
            case prevKey:
              e.preventDefault()
              send({ type: 'focusPrev', from: value })
              return
            case 'Home':
              e.preventDefault()
              send({ type: 'focusFirst' })
              return
            case 'End':
              e.preventDefault()
              send({ type: 'focusLast' })
              return
          }
        }),
      },
    }),
    group: (label: string): ToolbarGroupParts => ({
      root: {
        role: 'group',
        'data-scope': 'toolbar',
        'data-part': 'group',
        'aria-labelledby': groupLabelId(label),
      },
      label: {
        id: groupLabelId(label),
        'data-scope': 'toolbar',
        'data-part': 'group-label',
      },
    }),
  }
}

export const toolbar = { init, update, connect }
