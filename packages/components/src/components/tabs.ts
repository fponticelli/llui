import type { Send } from '@llui/dom'
import { flipArrow } from '../utils/direction.js'

/**
 * Tabs — tabbed interface with keyboard navigation. Each tab has a value
 * (string) that identifies both the trigger and the associated panel.
 *
 * Two activation modes:
 *   - `'automatic'` (default): focusing a trigger also activates it.
 *   - `'manual'`: arrow keys move focus without activating; Enter/Space activates.
 */

export type Orientation = 'horizontal' | 'vertical'
export type Activation = 'automatic' | 'manual'

export interface TabsState {
  value: string
  items: string[]
  disabledItems: string[]
  orientation: Orientation
  activation: Activation
  /** The currently focused (but not necessarily active) tab. For manual mode. */
  focused: string | null
  /** Whether Arrow navigation wraps at the ends of the tab list. Default: true. */
  loopFocus: boolean
  /** Whether clicking the active tab deselects it (empty value). Default: false. */
  deselectable: boolean
}

export type TabsMsg =
  /** @intent("Set Value") */
  | { type: 'setValue'; value: string }
  /** @humanOnly */
  | { type: 'setItems'; items: string[]; disabled?: string[] }
  /** @humanOnly */
  | { type: 'focusTab'; value: string }
  /** @humanOnly */
  | { type: 'focusNext'; from: string }
  /** @humanOnly */
  | { type: 'focusPrev'; from: string }
  /** @humanOnly */
  | { type: 'focusFirst' }
  /** @humanOnly */
  | { type: 'focusLast' }
  /** @intent("Activate Focused") */
  | { type: 'activateFocused' }

export interface TabsInit {
  value?: string
  items?: string[]
  disabledItems?: string[]
  orientation?: Orientation
  activation?: Activation
  loopFocus?: boolean
  deselectable?: boolean
}

export function init(opts: TabsInit = {}): TabsState {
  const items = opts.items ?? []
  return {
    value: opts.value ?? items[0] ?? '',
    items,
    disabledItems: opts.disabledItems ?? [],
    orientation: opts.orientation ?? 'horizontal',
    activation: opts.activation ?? 'automatic',
    focused: null,
    loopFocus: opts.loopFocus ?? true,
    deselectable: opts.deselectable ?? false,
  }
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

function nextEnabled(
  items: string[],
  disabled: string[],
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

export function update(state: TabsState, msg: TabsMsg): [TabsState, never[]] {
  switch (msg.type) {
    case 'setValue':
      if (state.disabledItems.includes(msg.value)) return [state, []]
      return [{ ...state, value: msg.value }, []]
    case 'setItems': {
      const disabled = msg.disabled ?? state.disabledItems
      // Ensure value still points to an existing enabled item
      let value = state.value
      if (!msg.items.includes(value) || disabled.includes(value)) {
        value = firstEnabled(msg.items, disabled) ?? ''
      }
      return [{ ...state, items: msg.items, disabledItems: disabled, value }, []]
    }
    case 'focusTab': {
      if (state.disabledItems.includes(msg.value)) return [state, []]
      const next: TabsState = { ...state, focused: msg.value }
      if (state.activation === 'automatic') {
        // Deselectable: clicking the already-active tab clears the value.
        next.value = state.deselectable && state.value === msg.value ? '' : msg.value
      }
      return [next, []]
    }
    case 'focusNext': {
      const to = nextEnabled(state.items, state.disabledItems, msg.from, 1, state.loopFocus)
      if (to === null) return [state, []]
      const next: TabsState = { ...state, focused: to }
      if (state.activation === 'automatic') next.value = to
      return [next, []]
    }
    case 'focusPrev': {
      const to = nextEnabled(state.items, state.disabledItems, msg.from, -1, state.loopFocus)
      if (to === null) return [state, []]
      const next: TabsState = { ...state, focused: to }
      if (state.activation === 'automatic') next.value = to
      return [next, []]
    }
    case 'focusFirst': {
      const to = firstEnabled(state.items, state.disabledItems)
      if (to === null) return [state, []]
      const next: TabsState = { ...state, focused: to }
      if (state.activation === 'automatic') next.value = to
      return [next, []]
    }
    case 'focusLast': {
      const to = lastEnabled(state.items, state.disabledItems)
      if (to === null) return [state, []]
      const next: TabsState = { ...state, focused: to }
      if (state.activation === 'automatic') next.value = to
      return [next, []]
    }
    case 'activateFocused': {
      if (state.focused === null) return [state, []]
      return [{ ...state, value: state.focused }, []]
    }
  }
}

export interface TabsItemParts<S> {
  trigger: {
    type: 'button'
    role: 'tab'
    'aria-selected': (s: S) => boolean
    'aria-controls': string
    'aria-disabled': (s: S) => 'true' | undefined
    id: string
    'data-state': (s: S) => 'active' | 'inactive'
    'data-disabled': (s: S) => '' | undefined
    'data-scope': 'tabs'
    'data-part': 'trigger'
    'data-value': string
    tabIndex: (s: S) => number
    onClick: (e: MouseEvent) => void
    onKeyDown: (e: KeyboardEvent) => void
    onFocus: (e: FocusEvent) => void
  }
  panel: {
    role: 'tabpanel'
    id: string
    'aria-labelledby': string
    tabIndex: 0
    hidden: (s: S) => boolean
    'data-state': (s: S) => 'active' | 'inactive'
    'data-scope': 'tabs'
    'data-part': 'panel'
    'data-value': string
  }
}

export interface TabsParts<S> {
  root: {
    'data-scope': 'tabs'
    'data-part': 'root'
    'data-orientation': (s: S) => Orientation
  }
  /**
   * A movable underline/highlight element. Position tracks the active
   * trigger via CSS custom properties written by `watchTabIndicator()`:
   *   `--indicator-left`, `--indicator-top`, `--indicator-width`,
   *   `--indicator-height` — all in pixels.
   * The consumer styles the indicator using these properties (e.g.
   * `transform: translateX(var(--indicator-left))`).
   */
  indicator: {
    'data-scope': 'tabs'
    'data-part': 'indicator'
    'data-orientation': (s: S) => Orientation
  }
  list: {
    role: 'tablist'
    'aria-orientation': (s: S) => Orientation
    'data-scope': 'tabs'
    'data-part': 'list'
  }
  item: (value: string) => TabsItemParts<S>
}

export interface ConnectOptions {
  id: string
  /**
   * Called whenever a tab is clicked/activated. Useful for anchor-style
   * navigation where the tab's value is a URL path and you want to push
   * to the history or router.
   */
  onNavigate?: (value: string) => void
}

export function connect<S>(
  get: (s: S) => TabsState,
  send: Send<TabsMsg>,
  opts: ConnectOptions,
): TabsParts<S> {
  const base = opts.id
  const triggerId = (v: string): string => `${base}:trigger:${v}`
  const panelId = (v: string): string => `${base}:panel:${v}`

  return {
    root: {
      'data-scope': 'tabs',
      'data-part': 'root',
      'data-orientation': (s) => get(s).orientation,
    },
    list: {
      role: 'tablist',
      'aria-orientation': (s) => get(s).orientation,
      'data-scope': 'tabs',
      'data-part': 'list',
    },
    indicator: {
      'data-scope': 'tabs',
      'data-part': 'indicator',
      'data-orientation': (s) => get(s).orientation,
    },
    item: (value: string): TabsItemParts<S> => ({
      trigger: {
        type: 'button',
        role: 'tab',
        'aria-selected': (s) => get(s).value === value,
        'aria-controls': panelId(value),
        'aria-disabled': (s) => (get(s).disabledItems.includes(value) ? 'true' : undefined),
        id: triggerId(value),
        'data-state': (s) => (get(s).value === value ? 'active' : 'inactive'),
        'data-disabled': (s) => (get(s).disabledItems.includes(value) ? '' : undefined),
        'data-scope': 'tabs',
        'data-part': 'trigger',
        'data-value': value,
        tabIndex: (s) => (get(s).value === value ? 0 : -1),
        onClick: () => {
          send({ type: 'focusTab', value })
          opts.onNavigate?.(value)
        },
        onFocus: () => {
          // `focusTab` handles automatic activation
          send({ type: 'focusTab', value })
        },
        onKeyDown: (e: KeyboardEvent) => {
          // Read orientation from the ancestor [data-part="list"] so the
          // handler can dispatch the correct arrow keys per WAI-ARIA.
          // Horizontal tabs: ArrowLeft/Right navigate; vertical: Up/Down.
          const target = e.currentTarget as HTMLElement | null
          const list = target?.closest(
            '[data-scope="tabs"][data-part="list"]',
          ) as HTMLElement | null
          const orientation =
            (list?.getAttribute('aria-orientation') as Orientation | null) ?? 'horizontal'
          const key = flipArrow(e.key, e.currentTarget as Element)
          const nextKey = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight'
          const prevKey = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft'
          switch (key) {
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
            case 'Enter':
            case ' ':
              e.preventDefault()
              send({ type: 'activateFocused' })
              return
          }
        },
      },
      panel: {
        role: 'tabpanel',
        id: panelId(value),
        'aria-labelledby': triggerId(value),
        tabIndex: 0,
        hidden: (s) => get(s).value !== value,
        'data-state': (s) => (get(s).value === value ? 'active' : 'inactive'),
        'data-scope': 'tabs',
        'data-part': 'panel',
        'data-value': value,
      },
    }),
  }
}

/**
 * Track the active tab trigger and update CSS custom properties on the
 * indicator element so it can be animated into position. Call from
 * `onMount` with the tabs root element; the returned function removes
 * the observers.
 *
 * Sets `--indicator-left`, `--indicator-top`, `--indicator-width`,
 * `--indicator-height` on the indicator element every time the active
 * trigger changes or the list resizes. Style the indicator with:
 *   transform: translate(var(--indicator-left), var(--indicator-top));
 *   width: var(--indicator-width);
 *   height: var(--indicator-height);
 */
export function watchTabIndicator(root: HTMLElement): () => void {
  const indicator = root.querySelector<HTMLElement>('[data-scope="tabs"][data-part="indicator"]')
  const list = root.querySelector<HTMLElement>('[data-scope="tabs"][data-part="list"]')
  if (!indicator || !list) return () => {}

  const sync = (): void => {
    const active = list.querySelector<HTMLElement>(
      '[data-scope="tabs"][data-part="trigger"][data-state="active"]',
    )
    if (!active) return
    indicator.style.setProperty('--indicator-left', `${active.offsetLeft}px`)
    indicator.style.setProperty('--indicator-top', `${active.offsetTop}px`)
    indicator.style.setProperty('--indicator-width', `${active.offsetWidth}px`)
    indicator.style.setProperty('--indicator-height', `${active.offsetHeight}px`)
  }

  sync()

  const mo = new MutationObserver(sync)
  mo.observe(list, { attributes: true, attributeFilter: ['data-state'], subtree: true })

  // ResizeObserver may be absent in older environments or jsdom — skip
  // gracefully; layout changes that don't involve a data-state flip just
  // won't reposition the indicator until the next attribute change.
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(sync) : null
  ro?.observe(list)

  return () => {
    mo.disconnect()
    ro?.disconnect()
  }
}

export const tabs = { init, update, connect, watchTabIndicator }
