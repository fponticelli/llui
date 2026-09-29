import type { Send, ReadSignal, Signal, Mountable } from '@llui/dom'
import { div, input, h2, span, text, each } from '@llui/dom'
import {
  connect as dialogConnect,
  overlay as dialogOverlay,
  type DialogParts,
  type DialogState,
} from '../components/dialog.js'
import {
  connect as comboboxConnect,
  type ComboboxParts,
  type ComboboxState,
  type ComboboxGroup,
} from '../components/combobox.js'
import { finiteOrDefault } from '../utils/number.js'
import { firstEnabledIndex, lastEnabledIndex, nextEnabledIndex } from '../utils/list-navigation.js'

/**
 * CommandMenu — a ⌘K command palette.
 *
 * Composes `dialog` (modal, focus trap, scroll lock) with `combobox` (filtered
 * + grouped listbox, highlight) into a single keyboard-driven palette opened by
 * a global hotkey. The machine owns the composed slice; the DOM listener lives
 * in the `watchHotkey()` mount helper (never inside the reducer), mirroring
 * `theme-switch`'s `watchSystemTheme` convention.
 *
 * The single agent-resolvable surface is `execute { commandId }`: an agent can
 * drive the palette end-to-end without simulating keystrokes — open the menu,
 * then `execute` directly. Filtering matches a command's `label` and any of its
 * `keywords`. A `recents` ranking is maintained in the reducer: the most
 * recently executed commands bubble to the front of the (unfiltered) list.
 *
 * Escape follows the cmdk convention: a first Escape with a non-empty query
 * clears the query (staying open); a second Escape (empty query) closes.
 *
 * The keyboard HIGHLIGHT is machine state (`highlighted`, a command id), again
 * following cmdk: an open palette always highlights the first enabled filtered
 * command, a filter keeps a highlight that is still visible and re-seeds one
 * that is not, and arrows/Home/End walk the enabled filtered commands. It is
 * projected onto the combobox's `aria-activedescendant` / `data-highlighted`,
 * so Enter runs exactly the command a screen reader announced.
 *
 * ```ts
 * onMount(() => watchHotkey((m) => send({ type: 'cmd', msg: m })))
 *
 * view: ({ state, send }) =>
 *   commandMenu.view({
 *     state: state.at('cmd'),
 *     send: (m) => send({ type: 'cmd', msg: m }),
 *     id: 'cmdk',
 *   })
 * ```
 */

/** A single palette command. JSON-serializable (no functions): execution is
 * surfaced as an `execute` effect keyed by `id`, never a callback in state. */
export interface Command {
  id: string
  label: string
  /** Optional group/section label. Commands without a group fall into ''. */
  group?: string
  /** Extra terms matched by the filter in addition to `label`. */
  keywords?: string[]
  /** Pre-rendered keybinding hint, e.g. 'mod+s'. Surfaced via `shortcutHint`. */
  shortcut?: string
  disabled?: boolean
}

/** A labelled section of filtered commands, in visual order. */
export interface CommandGroup {
  label: string
  commands: Command[]
}

export interface CommandMenuState {
  open: boolean
  query: string
  commands: Command[]
  /** Filtered (and recents-ranked) flat command list. */
  filtered: Command[]
  /** Filtered commands bucketed into groups (group order preserved). */
  filteredGroups: CommandGroup[]
  /** Most-recently-executed command ids, most-recent first (deduped). */
  recents: string[]
  /** Max recents retained for ranking. */
  maxRecents: number
  /**
   * The keyboard-highlighted command id (the combobox's active descendant).
   * Always an ENABLED member of `filtered` while open; `null` when closed or
   * when nothing enabled matches.
   */
  highlighted: string | null
}

export type CommandMenuMsg =
  /** @intent("Open the command palette") */
  | { type: 'open' }
  /** @intent("Close the command palette") */
  | { type: 'close' }
  /** @intent("Set the search query (re-runs the filter)") */
  | { type: 'setQuery'; query: string }
  /** @intent("Run the command with the given id, then close the palette") */
  | { type: 'execute'; commandId: string }
  /** @humanOnly */
  | { type: 'escape' }
  /** @humanOnly */
  | { type: 'highlight'; commandId: string }
  /** @humanOnly */
  | { type: 'highlightNext' }
  /** @humanOnly */
  | { type: 'highlightPrev' }
  /** @humanOnly */
  | { type: 'highlightFirst' }
  /** @humanOnly */
  | { type: 'highlightLast' }
  /** @humanOnly */
  | { type: 'executeHighlighted' }
  /** @humanOnly */
  | { type: 'setCommands'; commands: Command[] }

/**
 * Effects emitted by the command-menu machine. `execute` is the single
 * agent-resolvable surface: the consumer's `onEffect` runs the side effect for
 * the picked command id (the machine never performs IO).
 */
export type CommandMenuEffect =
  /** @intent("Run the side effect for the executed command id") */
  { type: 'execute'; commandId: string }

export interface CommandMenuInit {
  commands?: Command[]
  recents?: string[]
  maxRecents?: number
  open?: boolean
}

function matches(command: Command, query: string): boolean {
  if (query === '') return true
  const q = query.toLowerCase()
  if (command.label.toLowerCase().includes(q)) return true
  return (command.keywords ?? []).some((k) => k.toLowerCase().includes(q))
}

/** Stable sort that bubbles recents to the front while preserving the original
 * order among equally-ranked commands. */
function rankByRecents(commands: Command[], recents: string[]): Command[] {
  if (recents.length === 0) return commands
  const rank = (id: string): number => {
    const i = recents.indexOf(id)
    return i === -1 ? recents.length : i
  }
  return commands
    .map((command, index) => ({ command, index }))
    .sort((a, b) => {
      const ra = rank(a.command.id)
      const rb = rank(b.command.id)
      if (ra !== rb) return ra - rb
      return a.index - b.index
    })
    .map((entry) => entry.command)
}

function computeFiltered(state: { commands: Command[]; query: string; recents: string[] }): {
  filtered: Command[]
  filteredGroups: CommandGroup[]
} {
  const matching = state.commands.filter((c) => matches(c, state.query))
  const ranked = rankByRecents(matching, state.recents)
  // Group order follows first appearance in the ranked list.
  const order: string[] = []
  const buckets = new Map<string, Command[]>()
  for (const command of ranked) {
    const label = command.group ?? ''
    if (!buckets.has(label)) {
      buckets.set(label, [])
      order.push(label)
    }
    buckets.get(label)!.push(command)
  }
  const filteredGroups = order.map((label) => ({ label, commands: buckets.get(label)! }))
  return { filtered: ranked, filteredGroups }
}

function enabledIds(filtered: Command[]): { items: string[]; disabled: string[] } {
  return {
    items: filtered.map((c) => c.id),
    disabled: filtered.filter((c) => c.disabled).map((c) => c.id),
  }
}

function isHighlightable(filtered: Command[], id: string | null): id is string {
  return id !== null && filtered.some((c) => c.id === id && !c.disabled)
}

function recompute(state: CommandMenuState): CommandMenuState {
  const { filtered, filteredGroups } = computeFiltered(state)
  // cmdk: an open palette always highlights something it can run. A highlight
  // still visible after a filter survives; one filtered out re-seeds to the
  // first enabled command, never a stale id `aria-activedescendant` would name.
  let highlighted: string | null = null
  if (state.open) {
    if (isHighlightable(filtered, state.highlighted)) highlighted = state.highlighted
    else {
      const { items, disabled } = enabledIds(filtered)
      const index = firstEnabledIndex(items, disabled)
      highlighted = index === null ? null : items[index]!
    }
  }
  return { ...state, filtered, filteredGroups, highlighted }
}

function move(state: CommandMenuState, to: 'next' | 'prev' | 'first' | 'last'): CommandMenuState {
  const { items, disabled } = enabledIds(state.filtered)
  const from = state.highlighted === null ? -1 : items.indexOf(state.highlighted)
  const index =
    to === 'first'
      ? firstEnabledIndex(items, disabled)
      : to === 'last'
        ? lastEnabledIndex(items, disabled)
        : nextEnabledIndex(items, disabled, from === -1 ? null : from, to === 'next' ? 1 : -1)
  const highlighted = index === null ? null : items[index]!
  if (highlighted === state.highlighted) return state
  return { ...state, highlighted }
}

export function init(opts: CommandMenuInit = {}): CommandMenuState {
  const commands = opts.commands ?? []
  const recents = opts.recents ?? []
  return recompute({
    open: opts.open ?? false,
    query: '',
    commands,
    filtered: [],
    filteredGroups: [],
    recents,
    maxRecents: finiteOrDefault(opts.maxRecents, 50),
    highlighted: null,
  })
}

function pushRecent(recents: string[], id: string, max: number): string[] {
  return [id, ...recents.filter((r) => r !== id)].slice(0, max)
}

function execute(
  state: CommandMenuState,
  commandId: string,
): [CommandMenuState, CommandMenuEffect[]] {
  const command = state.commands.find((c) => c.id === commandId)
  if (!command || command.disabled) return [state, []]
  const recents = pushRecent(state.recents, command.id, state.maxRecents)
  return [
    recompute({ ...state, open: false, query: '', recents }),
    [{ type: 'execute', commandId: command.id }],
  ]
}

export function update(
  state: CommandMenuState,
  msg: CommandMenuMsg,
): [CommandMenuState, CommandMenuEffect[]] {
  switch (msg.type) {
    case 'open':
      return [recompute({ ...state, open: true, query: '', highlighted: null }), []]
    case 'close':
      return [recompute({ ...state, open: false, query: '' }), []]
    case 'setQuery':
      return [recompute({ ...state, query: msg.query }), []]
    case 'execute':
      return execute(state, msg.commandId)
    case 'executeHighlighted':
      if (!state.open || state.highlighted === null) return [state, []]
      return execute(state, state.highlighted)
    case 'highlight':
      // A pointer-move fires per tick: an unchanged or unrunnable target
      // returns the SAME state so the reconciler skips the commit.
      if (!state.open || state.highlighted === msg.commandId) return [state, []]
      if (!isHighlightable(state.filtered, msg.commandId)) return [state, []]
      return [{ ...state, highlighted: msg.commandId }, []]
    case 'highlightNext':
      return [state.open ? move(state, 'next') : state, []]
    case 'highlightPrev':
      return [state.open ? move(state, 'prev') : state, []]
    case 'highlightFirst':
      return [state.open ? move(state, 'first') : state, []]
    case 'highlightLast':
      return [state.open ? move(state, 'last') : state, []]
    case 'escape':
      // cmdk convention: clear a non-empty query first, then close.
      if (state.query !== '') return [recompute({ ...state, query: '' }), []]
      return [recompute({ ...state, open: false }), []]
    case 'setCommands':
      return [recompute({ ...state, commands: msg.commands }), []]
  }
}

/**
 * Listen for the global command-palette hotkey. Returns a cleanup function.
 * Call from `onMount`; the DOM listener never lives inside the machine.
 *
 * `combo` is a `+`-joined chord, e.g. `'mod+k'` (default). `mod` matches the
 * platform-conventional accelerator (⌘ on macOS, Ctrl elsewhere); since both
 * map to either `metaKey` or `ctrlKey` here, `mod` accepts either modifier.
 */
export function watchHotkey(send: Send<CommandMenuMsg>, combo: string = 'mod+k'): () => void {
  if (typeof document === 'undefined') return () => {}
  const parts = combo.toLowerCase().split('+')
  const key = parts[parts.length - 1] ?? ''
  const wantMod = parts.includes('mod')
  const wantShift = parts.includes('shift')
  const wantAlt = parts.includes('alt')
  const handler = (e: KeyboardEvent): void => {
    if (e.key.toLowerCase() !== key) return
    if (wantMod && !(e.metaKey || e.ctrlKey)) return
    if (!wantMod && (e.metaKey || e.ctrlKey)) return
    if (wantShift !== e.shiftKey) return
    if (wantAlt !== e.altKey) return
    e.preventDefault()
    send({ type: 'open' })
  }
  document.addEventListener('keydown', handler)
  return () => document.removeEventListener('keydown', handler)
}

export interface CommandMenuParts {
  /** Dialog parts (content/title/positioner/backdrop) for the modal shell. */
  dialog: DialogParts
  /** Combobox parts (root/input/content/item/group/...) for the search + list. */
  combobox: ComboboxParts
  /** Accessor for a command's keybinding hint (empty string when none). */
  shortcutHint: (commandId: string) => ReadSignal<string>
  /** Empty-state part: `data-empty` is set when the filtered list is empty. */
  empty: {
    'data-scope': 'command-menu'
    'data-part': 'empty'
    role: 'status'
    'data-empty': ReadSignal<'' | undefined>
  }
}

export interface ConnectOptions {
  /** Unique id per palette instance (used for ARIA wiring). */
  id: string
  /**
   * Whether the consumer renders `dialog.description` (default: false — the
   * palette's own `view()` renders a title and no description). Forwarded to
   * the dialog so `aria-describedby` never names a missing element (#268).
   */
  hasDescription?: boolean
}

/** The combobox group id for a command group label ('' is the ungrouped bucket). */
function groupKey(label: string): string {
  return label === '' ? '__ungrouped' : label
}

/**
 * Project the composed slice into dialog + combobox part bags plus a
 * `shortcutHint` accessor and an empty-state part. The dialog/combobox sends
 * are adapted to command-menu messages: the consumer spreads these onto
 * elements exactly like the base components.
 */
export function connect(
  state: ReadSignal<CommandMenuState>,
  send: Send<CommandMenuMsg>,
  opts: ConnectOptions,
): CommandMenuParts {
  const dialog = dialogConnect(
    state.map((s): DialogState => ({ open: s.open })),
    (m) => {
      if (m.type === 'close') send({ type: 'close' })
      else if (m.type === 'open') send({ type: 'open' })
      else if (m.type === 'toggle') send({ type: state.peek().open ? 'close' : 'open' })
      else if (m.type === 'setOpen') send({ type: m.open ? 'open' : 'close' })
    },
    { id: opts.id, role: 'dialog', hasDescription: opts.hasDescription ?? false },
  )

  const combobox = comboboxConnect(
    state.map(
      (s): ComboboxState => ({
        open: s.open,
        value: [],
        inputValue: s.query,
        items: s.filtered.map((c) => c.id),
        groups: s.filteredGroups.map(
          (g): ComboboxGroup => ({
            id: groupKey(g.label),
            label: g.label,
            items: g.commands.map((c) => c.id),
          }),
        ),
        disabledItems: s.commands.filter((c) => c.disabled).map((c) => c.id),
        filteredItems: s.filtered.map((c) => c.id),
        highlightedValue: s.highlighted,
        selectionMode: 'single',
        disabled: false,
        allowCreate: false,
        status: 'idle',
        requestId: 0,
        error: null,
      }),
    ),
    (m) => {
      switch (m.type) {
        case 'setInputValue':
          send({ type: 'setQuery', query: m.value })
          return
        case 'selectOption':
          send({ type: 'execute', commandId: m.value })
          return
        case 'close':
          send({ type: 'escape' })
          return
        case 'highlight':
          if (m.value !== null) send({ type: 'highlight', commandId: m.value })
          return
        case 'highlightNext':
        case 'highlightPrev':
        case 'highlightFirst':
        case 'highlightLast':
          send({ type: m.type })
          return
        case 'selectHighlighted':
          send({ type: 'executeHighlighted' })
          return
        // `open` (the palette is already open whenever its input exists),
        // clear / setValue / setItems / load* are not palette concepts; the
        // agent drives selection via `execute`.
        default:
          return
      }
    },
    { id: `${opts.id}:combobox` },
  )

  return {
    dialog,
    combobox,
    shortcutHint: (commandId: string) =>
      state.map((s) => s.commands.find((c) => c.id === commandId)?.shortcut ?? ''),
    empty: {
      'data-scope': 'command-menu',
      'data-part': 'empty',
      role: 'status',
      'data-empty': state.map((s) => (s.filtered.length === 0 ? '' : undefined)),
    },
  }
}

export interface CommandMenuViewOptions {
  /** A PATH signal: the view slices `filteredGroups` with `.at()` so the list is
   * gated on that path alone. */
  state: Signal<CommandMenuState>
  send: Send<CommandMenuMsg>
  id: string
  inputLabel?: string
  /** Custom class for the content root. */
  contentClass?: string
  /** Accessible title for the palette dialog (default: 'Command palette'). */
  title?: string
  /** Empty-state text (default: 'No matching commands'). */
  emptyText?: string
}

/**
 * Default palette view: a combobox (search input + grouped command list) inside
 * the dialog overlay. The listbox owns one `option` per FILTERED command,
 * bucketed into labelled `group`s (an ungrouped command sits directly in the
 * listbox, with no group and so no dangling label reference). The combobox
 * input's own key handling drives the machine's highlight — arrows/Home/End
 * move it, Enter runs it, Escape clears the query then closes — and a pointer
 * click runs the clicked command. Consumers wanting a custom row template
 * should drive the part bags from `connect()` directly.
 */
export function view(opts: CommandMenuViewOptions): Mountable {
  const parts = connect(opts.state, opts.send, { id: opts.id })
  const title = opts.title ?? 'Command palette'
  const emptyText = opts.emptyText ?? 'No matching commands'

  // A command row. Keyed by command id, so the id captured here is the row's
  // identity for its whole life; label/shortcut still read reactively.
  const commandRow = (command: Signal<Command>): Mountable => {
    const id = command.peek().id
    return div({ ...parts.combobox.item(id).item, class: 'command-menu__item' }, [
      span({ class: 'command-menu__label' }, [text(command.at('label'))]),
      span({ class: 'command-menu__shortcut', 'aria-hidden': 'true' }, [
        text(command.map((c) => c.shortcut ?? '')),
      ]),
    ])
  }

  return dialogOverlay({
    state: opts.state.map((s) => ({ open: s.open })),
    send: (m) => {
      if (m.type === 'close') opts.send({ type: 'escape' })
    },
    parts: parts.dialog,
    content: () => [
      div({ ...parts.dialog.content, class: opts.contentClass ?? 'command-menu' }, [
        h2({ ...parts.dialog.title, class: 'command-menu__title' }, [text(title)]),
        div({ ...parts.combobox.root, class: 'command-menu__search' }, [
          input({
            ...parts.combobox.input,
            // The search field is named by the palette's title (#268 audit):
            // a placeholder is a hint, not a label.
            'aria-labelledby': parts.dialog.title.id,
            class: 'command-menu__input',
            placeholder: opts.inputLabel ?? 'Type a command…',
          }),
        ]),
        // The empty-state `status` sits BESIDE the listbox: a listbox may own
        // only options and groups (#268 audit).
        div({ ...parts.combobox.content, class: 'command-menu__list' }, [
          each(opts.state.at('filteredGroups'), {
            key: (g) => g.label,
            render: (group) => {
              // Keyed by label, so the label is fixed for the row's life.
              const label = group.peek().label
              const rows = each(group.at('commands'), {
                key: (c) => c.id,
                render: (c) => [commandRow(c)],
              })
              if (label === '') {
                return [div({ class: 'command-menu__group', 'data-ungrouped': '' }, [rows])]
              }
              const groupParts = parts.combobox.group(groupKey(label))
              return [
                div({ ...groupParts.group, class: 'command-menu__group' }, [
                  div({ ...groupParts.groupLabel, class: 'command-menu__group-label' }, [
                    text(label),
                  ]),
                  rows,
                ]),
              ]
            },
          }),
        ]),
        div({ ...parts.empty, class: 'command-menu__empty' }, [text(emptyText)]),
      ]),
    ],
    closeOnOutsideClick: true,
  })
}

export const commandMenu = { init, update, connect, view, watchHotkey }
