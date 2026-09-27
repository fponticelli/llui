import {
  div,
  button,
  span,
  h3,
  p,
  input,
  svg,
  path,
  each,
  text,
  onMount,
  select as domSelect,
  option as domOption,
} from '@llui/dom'
import type { Send, Signal, Renderable, Mountable } from '@llui/dom'
import { popover } from '@llui/components/popover'
import { tooltip } from '@llui/components/tooltip'
import { hoverCard } from '@llui/components/hover-card'
import { menu, type MenuItem, type MenuParts } from '@llui/components/menu'
import { contextMenu, type ContextMenuParts } from '@llui/components/context-menu'
import { select } from '@llui/components/select'
import { combobox } from '@llui/components/combobox'
import { drawer } from '@llui/components/drawer'
import { dialog } from '@llui/components/dialog'
import { alertDialog } from '@llui/components/alert-dialog'
import { toast, nextToastId } from '@llui/components/toast'
import type { ToastPlacement } from '@llui/components/toast'
import {
  confirmDialog,
  type ConfirmDialogState,
  type ConfirmDialogMsg,
  openWith,
} from '@llui/components/patterns/confirm-dialog'
import {
  commandMenu,
  watchHotkey,
  type Command,
  type CommandMenuEffect,
} from '@llui/components/patterns/command-menu'
import { searchableSelect } from '@llui/components/patterns/searchable-select'
import { sectionGroup, card } from '../shared/ui'
import {
  registerToastHandler,
  registerConfirmHandler,
  showToast,
  askConfirm,
  type ToastKind,
} from '../shared/bus'
import {
  composeModules,
  mergeHandlers,
  type ModulesState,
  type ModulesMsg,
} from '../shared/modules'

const FRUITS = [
  'Apple',
  'Apricot',
  'Banana',
  'Blackberry',
  'Blueberry',
  'Cherry',
  'Coconut',
  'Fig',
  'Grape',
  'Lemon',
  'Mango',
  'Orange',
  'Papaya',
  'Peach',
  'Pear',
  'Pineapple',
  'Raspberry',
  'Strawberry',
  'Watermelon',
]

// Menu item trees. These are the machine's own `MenuNode`s, not bare labels:
// `navigable`/`findItem`/`nextNav` read `.value` and `.kind` off every entry, so
// a list of strings gave the machine nothing to navigate — measured on the
// rendered page, `aria-activedescendant` stayed null and no item ever took
// `data-highlighted`, through any number of arrow presses.
//
// Fixing the shape restores the STATE half only. The highlight is not yet
// VISIBLE here: `theme.css` styles menu and context-menu items with
// `[data-state='highlighted']` while the machine publishes a bare
// `data-highlighted` (the spelling `select`/`combobox` already use), so the
// rule matches nothing and the highlighted item computes a transparent
// background. That is #248, fixed on its own branch; the two changes are
// independent and the highlight appears when both land.
//
// Declared once and used by BOTH `init` and the view so the two cannot drift.
// `Share` and `More` are real nested submenus (`children`), not decoration —
// they're what exercises the machine's per-level `openPath`, hover-intent
// timers, and (via `menu.subOverlay`/`contextMenu.subOverlay`) a REAL,
// engine-owned floating overlay per level instead of the fixed top-left
// corner the stub positioner used to render at (#265 A4).
const MENU_ITEMS: MenuItem[] = [
  { value: 'Edit', kind: 'action' },
  { value: 'Duplicate', kind: 'action' },
  {
    value: 'Share',
    kind: 'action',
    children: [
      { value: 'Email', kind: 'action' },
      { value: 'Copy Link', kind: 'action' },
    ],
  },
  { value: 'Archive', kind: 'action' },
  { value: 'Delete', kind: 'action' },
]
const CONTEXT_MENU_ITEMS: MenuItem[] = [
  { value: 'Cut', kind: 'action' },
  { value: 'Copy', kind: 'action' },
  { value: 'Paste', kind: 'action' },
  {
    value: 'More',
    kind: 'action',
    children: [
      { value: 'Rename', kind: 'action' },
      { value: 'Duplicate', kind: 'action' },
    ],
  },
  { value: 'Delete', kind: 'action' },
]

// Select options, shared by `init` and the view for the same reason.
const COLORS = ['Red', 'Green', 'Blue', 'Purple', 'Orange']

// Non-color cue per ToastType — see `toastTypeIcons()` in `view` below and
// `menus-overlays.css`'s matching `[data-icon]` rules.
const TOAST_TYPE_GLYPHS: Record<string, string> = {
  info: 'ℹ',
  success: '✓',
  warning: '⚠',
  error: '✕',
  loading: '⟳',
  custom: '✦',
}

// Command palette commands. JSON-serializable: execution is surfaced as an
// `execute` effect keyed by `id`, handled in `onEffect` below.
const COMMANDS: Command[] = [
  { id: 'new-file', label: 'New File', group: 'File', keywords: ['create', 'add'], shortcut: '⌘N' },
  { id: 'open-file', label: 'Open File…', group: 'File', keywords: ['load'], shortcut: '⌘O' },
  { id: 'save', label: 'Save', group: 'File', keywords: ['write', 'persist'], shortcut: '⌘S' },
  { id: 'copy', label: 'Copy', group: 'Edit', keywords: ['clipboard'], shortcut: '⌘C' },
  { id: 'paste', label: 'Paste', group: 'Edit', keywords: ['clipboard'], shortcut: '⌘V' },
  { id: 'find', label: 'Find in File', group: 'Edit', keywords: ['search'], shortcut: '⌘F' },
  { id: 'toggle-theme', label: 'Toggle Theme', group: 'View', keywords: ['dark', 'light'] },
  { id: 'zen', label: 'Zen Mode', group: 'View', keywords: ['focus', 'distraction'] },
]

// confirm is excluded from `children` because it has a custom handler that
// updates sibling state (`message`) when the dialog confirms or cancels.
const children = {
  popover,
  tooltip,
  hoverCard,
  menu,
  contextMenu,
  select,
  combobox,
  drawer,
  dialog,
  alertDialog,
  toast,
  commandMenu,
  searchSelect: searchableSelect,
} as const

export type State = ModulesState<typeof children> & {
  confirm: ConfirmDialogState
  message: string
}
export type Msg =
  | ModulesMsg<typeof children>
  /**
   * @intent("Handle confirm dialog actions")
   * @example("{\"type\":\"confirm\",\"msg\":{\"type\":\"confirm\"}}")
   */
  | { type: 'confirm'; msg: ConfirmDialogMsg }
  /**
   * @intent("Emit a new toast notification")
   * @example("{\"type\":\"emitToast\",\"kind\":\"success\",\"title\":\"Saved\",\"description\":\"Changes persisted.\"}")
   */
  | { type: 'emitToast'; kind: ToastKind; title: string; description: string }
  /**
   * @intent("Ask for user confirmation before a destructive action")
   * @example("{\"type\":\"askConfirm\",\"tag\":\"deleteAccount\",\"title\":\"Delete account?\",\"description\":\"This cannot be undone.\",\"destructive\":true}")
   */
  | { type: 'askConfirm'; tag: string; title: string; description: string; destructive: boolean }

// command-menu is the only child that emits effects; its `execute` effect is
// routed by the root app into `onEffect` (below).
export type Effect = CommandMenuEffect

export const init = (): [State, Effect[]] => [
  {
    popover: popover.init({ open: false }),
    tooltip: tooltip.init({ open: false }),
    hoverCard: hoverCard.init({ open: false }),
    menu: menu.init({ items: MENU_ITEMS, open: false }),
    contextMenu: contextMenu.init({ items: CONTEXT_MENU_ITEMS }),
    select: select.init({ items: COLORS, value: ['Blue'] }),
    combobox: combobox.init({ items: FRUITS }),
    drawer: drawer.init({ open: false }),
    dialog: dialog.init({ open: false }),
    alertDialog: alertDialog.init({ open: false }),
    // #265 finding 3: `animated: true` is what makes the exit lifecycle real
    // (create → dismiss/tick → closing → animationEnd → removal) rather than
    // a synchronous removal with nothing for `motion.css`'s closing rules to
    // ever apply to.
    toast: toast.init({ placement: 'bottom-end', animated: true }),
    commandMenu: commandMenu.init({ commands: COMMANDS }),
    searchSelect: searchableSelect.init({
      items: FRUITS,
      placeholder: 'Pick a fruit',
    }),
    confirm: confirmDialog.init(),
    message: '',
  },
  [],
]

export const update = mergeHandlers<State, Msg, Effect>(
  composeModules<State, Msg, Effect>(children),
  (state, msg) => {
    if (msg.type !== 'confirm') return null
    const [confirm] = confirmDialog.update(state.confirm, msg.msg)
    if (msg.msg.type === 'confirm') {
      return [{ ...state, confirm, message: `Confirmed: ${state.confirm.tag}` }, []]
    }
    if (msg.msg.type === 'cancel') {
      return [{ ...state, confirm, message: 'Cancelled' }, []]
    }
    return [{ ...state, confirm }, []]
  },
  (state, msg) => {
    if (msg.type !== 'emitToast') return null
    const [ts] = toast.update(state.toast, {
      type: 'create',
      toast: {
        id: nextToastId(),
        type: msg.kind,
        title: msg.title,
        description: msg.description,
        duration: 3000,
        dismissable: true,
      },
    })
    return [{ ...state, toast: ts }, []]
  },
  (state, msg) => {
    if (msg.type !== 'askConfirm') return null
    const [c] = confirmDialog.update(
      state.confirm,
      openWith(msg.tag, {
        title: msg.title,
        description: msg.description,
        destructive: msg.destructive,
      }),
    )
    return [{ ...state, confirm: c }, []]
  },
)

// The root app routes this section's effects here. command-menu emits a single
// effect shape — `{ type: 'execute'; commandId: string }` — when the user runs a
// command. We perform the command's side effect; for the demo that's a toast.
export function onEffect(effect: Effect, _send: Send<Msg>): void {
  if (effect.type === 'execute') {
    const command = COMMANDS.find((c) => c.id === effect.commandId)
    showToast('success', 'Command', command?.label ?? effect.commandId)
  }
}

export function view(state: Signal<State>, send: Send<Msg>): Renderable {
  // Register bus handlers so other sections can trigger toast/confirm
  registerToastHandler((kind, title, description) =>
    send({ type: 'emitToast', kind, title, description }),
  )
  registerConfirmHandler((tag, title, description, destructive) =>
    send({ type: 'askConfirm', tag, title, description, destructive }),
  )

  const po = popover.connect(state.at('popover'), (m) => send({ type: 'popover', msg: m }), {
    id: 'pop-demo',
  })
  const tp = tooltip.connect(state.at('tooltip'), (m) => send({ type: 'tooltip', msg: m }), {
    id: 'tip-demo',
    delayOpen: 300,
  })
  const hc = hoverCard.connect(state.at('hoverCard'), (m) => send({ type: 'hoverCard', msg: m }), {
    id: 'hc-demo',
    openDelay: 400,
  })
  const me = menu.connect(state.at('menu'), (m) => send({ type: 'menu', msg: m }), {
    id: 'menu-demo',
    onSelect: () => showToast('info', 'Menu action', 'An item was selected'),
  })
  const cm = contextMenu.connect(
    state.at('contextMenu'),
    (m) => send({ type: 'contextMenu', msg: m }),
    {
      id: 'cm-demo',
    },
  )
  const se = select.connect(state.at('select'), (m) => send({ type: 'select', msg: m }), {
    id: 'sel-demo',
    placeholder: 'Choose a color',
  })
  const co = combobox.connect(state.at('combobox'), (m) => send({ type: 'combobox', msg: m }), {
    id: 'cb-demo',
  })
  const dr = drawer.connect(state.at('drawer'), (m) => send({ type: 'drawer', msg: m }), {
    id: 'drawer-demo',
    side: 'right',
  })
  const dlg = dialog.connect(state.at('dialog'), (m) => send({ type: 'dialog', msg: m }), {
    id: 'dialog-demo',
  })
  const adlg = alertDialog.connect(
    state.at('alertDialog'),
    (m) => send({ type: 'alertDialog', msg: m }),
    {
      id: 'alert-dialog-demo',
    },
  )
  const toastParts = toast.connect(state.at('toast'), (m) => send({ type: 'toast', msg: m }))
  // command-menu emits an `execute` effect when a command runs; the root app
  // routes it to this section's `onEffect`, which performs the side effect (a
  // toast). The view only needs to forward messages to the section reducer.
  const sendCommandMenu = (m: Parameters<typeof commandMenu.update>[1]): void =>
    send({ type: 'commandMenu', msg: m })
  const cmd = commandMenu.connect(state.at('commandMenu'), sendCommandMenu, { id: 'cmdk-demo' })
  const SSEL_ID = 'ssel-demo'
  const ssel = searchableSelect.connect(
    state.at('searchSelect'),
    (m) => send({ type: 'searchSelect', msg: m }),
    { id: SSEL_ID },
  )
  // The currently-highlighted option's VALUE (not its index). Built once here,
  // outside the option each(), so the per-row highlight binding compares the
  // row's stable value against it — keeping the highlight correct after the
  // filter shifts positions, without a frozen build-time index.
  const ssselHighlightValue = state.at('searchSelect').map((ss) => ss.combobox.highlightedValue)

  // Global ⌘K / Ctrl+K hotkey opens the command palette.
  const hotkeyMount = onMount(() => watchHotkey((m) => send({ type: 'commandMenu', msg: m })))

  // #265 finding 3: the machine owns no interval of its own by design (see
  // `toast.ts`'s header) — it expects the CONSUMER to drive `tick(id,
  // elapsedMs)`. Without a real driver, a finite-`duration` toast's countdown
  // never advances and create→tick→closing→animationEnd→removal is only ever
  // demonstrated by an explicit dismiss, never by real elapsed time. This
  // ticks every counting-down toast every 250ms with the actual wall-clock
  // delta, so the reducer's own `remainingMs <= 0` branch drives the real
  // close (animated, since `toast.init({ animated: true })` above).
  const toastTickMount = onMount(() => {
    let last = Date.now()
    const id = setInterval(() => {
      const now = Date.now()
      const elapsedMs = now - last
      last = now
      for (const t of state.peek().toast.toasts) {
        if (t.duration !== null) {
          send({ type: 'toast', msg: { type: 'tick', id: t.id, elapsedMs } })
        }
      }
    }, 250)
    return () => clearInterval(id)
  })

  // Every ToastType's own glyph, always mounted (six per toast row) and
  // shown only under its own `data-type` via menus-overlays.css — never
  // resolved once from the toast's `type` in JS, so an `update` patching a
  // mounted toast's `type` (the loading→success demo below) swaps the
  // visible glyph reactively with no rebuild (#265 finding: `loading` used
  // to be distinguished only by `cursor: progress`).
  const toastTypeIcons = (): Mountable[] =>
    Object.entries(TOAST_TYPE_GLYPHS).map(([type, glyph]) =>
      span(
        {
          'data-scope': 'toast',
          'data-part': 'type-icon',
          'data-icon': type,
          'aria-hidden': 'true',
        },
        [text(glyph)],
      ),
    )

  const selectItems = (): Renderable =>
    COLORS.map((v, i) => div({ ...se.item(v, i).item }, [text(v)]))
  // Recursive: a `children` node renders a real subTrigger + an ENGINE-OWNED
  // submenu overlay (`menu.subOverlay`/`contextMenu.subOverlay`, #265 A4) —
  // `subOverlayFor` closes over the right per-machine state/parts so this
  // helper itself stays state-shape-agnostic, and builds both the
  // subpositioner and subcontent wrapper divs itself (real anchored floating
  // geometry, gated on `openPath` membership internally).
  const renderMenuTree = (
    items: MenuItem[],
    parts: Pick<
      MenuParts | ContextMenuParts,
      'item' | 'subTrigger' | 'subPositioner' | 'subContent'
    >,
    subOverlayFor: (value: string, content: () => Renderable) => Mountable,
  ): Renderable =>
    items.flatMap((it): Renderable => {
      if (it.children && it.children.length > 0) {
        return [
          div({ ...parts.subTrigger(it.value) }, [text(it.value), text(' ›')]),
          subOverlayFor(it.value, () => [
            div(
              { ...parts.subContent(it.value) },
              renderMenuTree(it.children!, parts, subOverlayFor),
            ),
          ]),
        ]
      }
      return [div({ ...parts.item(it.value).item }, [text(it.value)])]
    })
  const menuItems = (): Renderable =>
    renderMenuTree(MENU_ITEMS, me, (value, content) =>
      menu.subOverlay({ value, state: state.at('menu'), parts: me, content }),
    )
  const ctxMenuItems = (): Renderable =>
    renderMenuTree(CONTEXT_MENU_ITEMS, cm, (value, content) =>
      contextMenu.subOverlay({ value, state: state.at('contextMenu'), parts: cm, content }),
    )

  // Per-row parts come from the machine's own `toast(item)` builder (never
  // hand-rolled attributes) so the demo proves the REAL contract: reactive
  // role/aria-live/data-type (an `update` patching `type` on a mounted toast
  // repaints all three with no rebuild), plus the close trigger and the
  // pause-on-hover/focus wiring — #265 findings 3 and 8.
  const toastRegion = div({ ...toastParts.region }, [
    each(state.at('toast.toasts'), {
      key: (t) => t.id,
      render: (item) => {
        const parts = toastParts.toast(item)
        return [
          div({ ...parts.root }, [
            ...toastTypeIcons(),
            div({ class: 'flex flex-col gap-1' }, [
              div({ ...parts.title }, [text(item.map((t) => t.title ?? ''))]),
              div({ ...parts.description }, [text(item.map((t) => t.description ?? ''))]),
            ]),
            button({ ...parts.closeTrigger }, [text('×')]),
          ]),
        ]
      },
    }),
  ])

  const confirmOverlay = confirmDialog.view({
    state: state.at('confirm'),
    send: (m) => send({ type: 'confirm', msg: m }),
    id: 'confirm-dialog',
  })

  const drawerOverlay = drawer.overlay({
    state: state.at('drawer'),
    send: (m) => send({ type: 'drawer', msg: m }),
    parts: dr,
    // `backdrop` renders BEFORE `content` — both share the same
    // `--llui-z-dialog` z-index (see menus-overlays.css), so DOM order alone
    // decides paint order and content always wins (#265 finding 4).
    content: () => [
      div({ ...dr.backdrop }),
      div({ ...dr.content }, [
        h3({ ...dr.title, class: 'text-lg font-semibold' }, [text('Drawer panel')]),
        p({ class: 'mt-2 text-sm text-muted-foreground' }, [
          text('Slide-in panel with focus trap, scroll lock, dismissable layer.'),
        ]),
        button({ ...dr.closeTrigger, class: 'btn btn-secondary mt-4' }, [text('Close')]),
      ]),
    ],
  })

  const dialogOverlay = dialog.overlay({
    state: state.at('dialog'),
    send: (m) => send({ type: 'dialog', msg: m }),
    parts: dlg,
    // `backdrop` renders BEFORE `content` — both share the same
    // `--llui-z-dialog` z-index (see menus-overlays.css), so DOM order alone
    // decides paint order and content always wins (#265 finding 4).
    content: () => [
      div({ ...dlg.backdrop }),
      div({ ...dlg.content }, [
        button({ ...dlg.closeTrigger }, [text('×')]),
        h3({ ...dlg.title }, [text('Edit profile')]),
        p({ ...dlg.description }, [
          text('Make changes to your profile. Click save when you are done.'),
        ]),
        div({ class: 'mt-6 flex justify-end gap-3' }, [
          button(
            {
              class: 'btn btn-secondary',
              onClick: () => send({ type: 'dialog', msg: { type: 'close' } }),
            },
            [text('Cancel')],
          ),
          button(
            {
              class: 'btn btn-primary',
              onClick: () => {
                send({ type: 'dialog', msg: { type: 'close' } })
                showToast('success', 'Profile saved', 'Your changes were saved.')
              },
            },
            [text('Save')],
          ),
        ]),
      ]),
    ],
  })

  const alertDialogOverlay = alertDialog.overlay({
    state: state.at('alertDialog'),
    send: (m) => send({ type: 'alertDialog', msg: m }),
    parts: adlg,
    // `backdrop` renders BEFORE `content` — both share the same
    // `--llui-z-dialog` z-index (see menus-overlays.css), so DOM order alone
    // decides paint order and content always wins (#265 finding 4).
    content: () => [
      div({ ...adlg.backdrop }),
      div({ ...adlg.content }, [
        button({ ...adlg.closeTrigger }, [text('×')]),
        h3({ ...adlg.title }, [text('Revoke API key?')]),
        p({ ...adlg.description }, [
          text('Any client using this key will lose access immediately.'),
        ]),
        div({ class: 'mt-6 flex justify-end gap-3' }, [
          button(
            {
              class: 'btn btn-secondary',
              onClick: () => send({ type: 'alertDialog', msg: { type: 'close' } }),
            },
            [text('Cancel')],
          ),
          button(
            {
              class: 'btn btn-danger',
              onClick: () => {
                send({ type: 'alertDialog', msg: { type: 'close' } })
                showToast('error', 'Key revoked', 'The API key has been revoked.')
              },
            },
            [text('Revoke')],
          ),
        ]),
      ]),
    ],
  })

  const commandMenuOverlay = dialog.overlay({
    state: state.at('commandMenu').map((c) => ({ open: c.open })),
    send: (m) => {
      if (m.type === 'close') send({ type: 'commandMenu', msg: { type: 'escape' } })
    },
    parts: cmd.dialog,
    // `backdrop` renders BEFORE `content` — both share the same
    // `--llui-z-dialog` z-index (see menus-overlays.css), so DOM order alone
    // decides paint order and content always wins (#265 finding 4).
    content: () => [
      div({ ...cmd.dialog.backdrop }),
      div(
        {
          ...cmd.dialog.content,
          class:
            'w-[32rem] max-w-[90vw] overflow-hidden rounded-lg border border-border bg-card shadow-2xl',
        },
        [
          div({ ...cmd.combobox.root, class: 'border-b border-border' }, [
            input({
              ...cmd.combobox.input,
              class: 'w-full px-4 py-3 text-sm outline-none',
              placeholder: 'Type a command…',
              onKeyDown: (e: KeyboardEvent) => {
                if (e.key === 'Escape') {
                  e.preventDefault()
                  send({ type: 'commandMenu', msg: { type: 'escape' } })
                  return
                }
                if (e.key === 'Enter') {
                  e.preventDefault()
                  const first = state.peek().commandMenu.filtered.find((c) => !c.disabled)
                  if (first) sendCommandMenu({ type: 'execute', commandId: first.id })
                }
              },
            }),
          ]),
          div({ ...cmd.combobox.content, class: 'max-h-72 overflow-y-auto p-1' }, [
            each(state.at('commandMenu.filtered'), {
              key: (c) => c.id,
              render: (item, index) => {
                const cmdItem = item.peek()
                const parts = cmd.combobox.item(cmdItem.id, index.peek()).item
                return [
                  div(
                    {
                      ...parts,
                      class:
                        'flex cursor-pointer items-center justify-between rounded px-3 py-2 text-sm data-[highlighted]:bg-accent',
                    },
                    [
                      span([text(item.at('label'))]),
                      span({ class: 'text-xs text-muted-foreground' }, [
                        text(item.map((c) => c.shortcut ?? '')),
                      ]),
                    ],
                  ),
                ]
              },
            }),
            div({ ...cmd.empty, class: 'px-3 py-6 text-center text-sm text-muted-foreground' }, [
              text('No matching commands'),
            ]),
          ]),
        ],
      ),
    ],
    closeOnOutsideClick: true,
  })

  const searchSelectOverlay = searchableSelect.overlay({
    state: state.at('searchSelect'),
    send: (m) => send({ type: 'searchSelect', msg: m }),
    parts: ssel,
    content: () => [
      div(
        {
          class: 'min-w-[12rem] overflow-hidden rounded-md border border-border bg-card shadow-lg',
        },
        [
          div({ class: 'border-b border-border p-1' }, [
            input({
              ...ssel.input,
              class: 'w-full rounded px-2 py-1.5 text-sm outline-none',
              placeholder: 'Search fruits…',
            }),
          ]),
          div({ ...ssel.content, class: 'max-h-60 overflow-y-auto p-1' }, [
            each(state.at('searchSelect.combobox.filteredItems'), {
              key: (v) => v,
              render: (item, index) => {
                const value = item.peek()
                // The value-dependent fields (role, aria-selected, onClick, …) are
                // stable per row since the each() is keyed by value. But the row's
                // POSITION shifts when the list is filtered, so the position-derived
                // fields must follow the LIVE `index` signal — otherwise the
                // build-time index freezes and the keyboard highlight +
                // aria-activedescendant desync after the first filter. `id` /
                // `data-index` track the live position; `data-highlighted` is keyed
                // by VALUE (the highlighted slot's value) so it stays correct
                // regardless of position with a single state.map.
                const parts = ssel.item(value, index.peek()).item
                return [
                  div(
                    {
                      ...parts,
                      id: index.map((i) => `${SSEL_ID}:item:${i}`),
                      'data-index': index.map((i) => String(i)),
                      'data-highlighted': ssselHighlightValue.map((hv) =>
                        hv === value ? '' : undefined,
                      ),
                      onPointerMove: () =>
                        send({
                          type: 'searchSelect',
                          msg: { type: 'highlight', value },
                        }),
                      class:
                        'cursor-pointer rounded px-3 py-1.5 text-sm data-[highlighted]:bg-accent data-[state=selected]:font-semibold',
                    },
                    [text(item)],
                  ),
                ]
              },
            }),
            div(
              {
                ...ssel.empty,
                class: 'px-3 py-4 text-center text-sm text-muted-foreground',
              },
              [text('No results')],
            ),
          ]),
        ],
      ),
    ],
  })

  return [
    // Placed so the ⌘K hotkey and toast-tick onMounts register (a discarded
    // onMount() is inert).
    hotkeyMount,
    toastTickMount,
    sectionGroup('Overlays', [
      card('Popover', [
        button({ ...po.trigger, class: 'btn btn-primary' }, [text('Show info')]),
        popover.overlay({
          state: state.at('popover'),
          send: (m) => send({ type: 'popover', msg: m }),
          parts: po,
          content: () => [
            div(
              {
                ...po.content,
                class: 'min-w-[16rem] rounded-md border border-border bg-card p-4 shadow-lg',
              },
              [
                h3({ ...po.title, class: 'text-sm font-semibold' }, [text('Did you know?')]),
                p({ class: 'mt-1 text-xs text-muted-foreground' }, [
                  text('LLui gives each binding a chunked mask of the state paths it reads.'),
                ]),
                button({ ...po.closeTrigger, class: 'btn btn-secondary mt-3 btn-sm' }, [
                  text('Got it'),
                ]),
                div({ ...po.arrow }),
              ],
            ),
          ],
          placement: 'bottom-start',
          arrowSelector: "[data-part='arrow']",
        }),
      ]),
      card('Tooltip', [
        button({ ...tp.trigger, class: 'btn btn-secondary' }, [text('Hover me')]),
        tooltip.overlay({
          state: state.at('tooltip'),
          send: (m) => send({ type: 'tooltip', msg: m }),
          parts: tp,
          content: () => [
            div({ ...tp.content }, [text('This is a tooltip'), div({ ...tp.arrow })]),
          ],
          arrowSelector: "[data-part='arrow']",
        }),
      ]),
      card('Hover Card', [
        span({ ...hc.trigger, class: 'underline decoration-dotted cursor-pointer' }, [
          text('Hover for details'),
        ]),
        hoverCard.overlay({
          state: state.at('hoverCard'),
          send: (m) => send({ type: 'hoverCard', msg: m }),
          parts: hc,
          content: () => [
            div({ ...hc.content }, [
              h3({ class: 'text-sm font-semibold' }, [text('LLui Components')]),
              p({ class: 'mt-1 text-xs text-muted-foreground' }, [
                text('Full keyboard, screen-reader, pointer support.'),
              ]),
              div({ ...hc.arrow }),
            ]),
          ],
          arrowSelector: "[data-part='arrow']",
        }),
      ]),
      card('Menu', [
        me.directionSync,
        button({ ...me.trigger, class: 'btn btn-secondary flex items-center gap-1.5' }, [
          text('Actions'),
          svg(
            {
              xmlns: 'http://www.w3.org/2000/svg',
              width: '16',
              height: '16',
              viewBox: '0 0 24 24',
              fill: 'none',
              stroke: 'currentColor',
              'stroke-width': '2',
              'stroke-linecap': 'round',
              'stroke-linejoin': 'round',
              'aria-hidden': 'true',
            },
            [path({ d: 'M6 9l6 6 6-6' })],
          ),
        ]),
        menu.overlay({
          state: state.at('menu'),
          send: (m) => send({ type: 'menu', msg: m }),
          parts: me,
          content: () => [div({ ...me.content }, menuItems())],
        }),
      ]),
      card('Context Menu', [
        cm.directionSync,
        div(
          {
            ...cm.trigger,
            class:
              'p-8 bg-muted border-2 border-dashed border-border rounded-md text-center text-muted-foreground select-none',
          },
          [text('Right-click me')],
        ),
        contextMenu.overlay({
          state: state.at('contextMenu'),
          send: (m) => send({ type: 'contextMenu', msg: m }),
          parts: cm,
          content: () => [div({ ...cm.content }, ctxMenuItems())],
        }),
      ]),
      card('Select', [
        button(
          { ...se.trigger, 'aria-label': 'Select color', class: 'flex items-center gap-1.5' },
          [
            span([text(se.valueText)]),
            svg(
              {
                xmlns: 'http://www.w3.org/2000/svg',
                width: '16',
                height: '16',
                viewBox: '0 0 24 24',
                fill: 'none',
                stroke: 'currentColor',
                'stroke-width': '2',
                'stroke-linecap': 'round',
                'stroke-linejoin': 'round',
                'aria-hidden': 'true',
              },
              [path({ d: 'M6 9l6 6 6-6' })],
            ),
          ],
        ),
        select.overlay({
          state: state.at('select'),
          send: (m) => send({ type: 'select', msg: m }),
          parts: se,
          content: () => [div({ ...se.content }, selectItems())],
        }),
      ]),
      card('Combobox', [
        div({ ...co.root, class: 'relative' }, [
          input({ ...co.input, placeholder: 'Search fruits…' }),
        ]),
        combobox.overlay({
          state: state.at('combobox'),
          send: (m) => send({ type: 'combobox', msg: m }),
          parts: co,
          content: () => [
            div({ ...co.content }, [
              each(state.at('combobox.filteredItems'), {
                key: (v) => v,
                render: (item, index) => {
                  const parts = co.item(item.peek(), index.peek()).item
                  return [div({ ...parts }, [text(item)])]
                },
              }),
            ]),
          ],
        }),
        div({ class: 'mt-3 text-sm text-muted-foreground' }, [
          text('Selected: '),
          text(state.at('combobox').map((c) => c.value[0] ?? 'none')),
        ]),
      ]),
      card('Searchable Select', [
        button(
          {
            ...ssel.trigger,
            class: 'btn btn-secondary flex w-full items-center justify-between gap-1.5',
          },
          [
            span([text(ssel.triggerLabel)]),
            svg(
              {
                xmlns: 'http://www.w3.org/2000/svg',
                width: '16',
                height: '16',
                viewBox: '0 0 24 24',
                fill: 'none',
                stroke: 'currentColor',
                'stroke-width': '2',
                'stroke-linecap': 'round',
                'stroke-linejoin': 'round',
                'aria-hidden': 'true',
              },
              [path({ d: 'M6 9l6 6 6-6' })],
            ),
          ],
        ),
        div({ class: 'mt-3 text-sm text-muted-foreground' }, [
          text('Selected: '),
          text(state.at('searchSelect.combobox.value').map((v) => v[0] ?? 'none')),
        ]),
        p({ class: 'mt-1 text-xs text-muted-foreground' }, [
          text('Filter-only input — typed text never commits; pick from the list.'),
        ]),
      ]),
      card('Drawer', [button({ ...dr.trigger, class: 'btn btn-primary' }, [text('Open drawer')])]),
      card('Dialog', [
        button({ ...dlg.trigger, class: 'btn btn-primary' }, [text('Edit profile')]),
      ]),
      card('Alert Dialog', [
        button({ ...adlg.trigger, class: 'btn btn-danger' }, [text('Revoke API key…')]),
        p({ class: 'mt-2 text-xs text-muted-foreground' }, [
          text('role="alertdialog" — outside-click does not dismiss by default.'),
        ]),
      ]),
      card('Command Menu', [
        button(
          {
            class: 'btn btn-primary flex items-center gap-2',
            onClick: () => send({ type: 'commandMenu', msg: { type: 'open' } }),
          },
          [
            text('Open palette'),
            span({ class: 'rounded bg-white/20 px-1.5 py-0.5 text-xs font-mono' }, [text('⌘K')]),
          ],
        ),
        p({ class: 'mt-2 text-xs text-muted-foreground' }, [
          text(
            'Type to filter, ↑↓ to navigate, Enter to run. Executed commands toast + rank as recents.',
          ),
        ]),
      ]),
      card('Toast', [
        // #265 A6: a real placement control + a real direction toggle, so the
        // region's six `ToastPlacement`s and their LTR/RTL logical mirroring
        // (menus-overlays.css's `inset-inline-start`/`inset-inline-end`) are
        // reachable from the ACTUAL demo, not only from an isolated scenario
        // renderer — see `registry/test/toast-live-demos.browser.test.ts`.
        div({ class: 'mb-3 flex flex-wrap items-center gap-2' }, [
          span({ id: 'toast-placement-label', class: 'text-sm font-medium' }, [text('Placement')]),
          (() => {
            const options: { value: ToastPlacement; label: string }[] = [
              { value: 'top', label: 'Top' },
              { value: 'top-start', label: 'Top start' },
              { value: 'top-end', label: 'Top end' },
              { value: 'bottom', label: 'Bottom' },
              { value: 'bottom-start', label: 'Bottom start' },
              { value: 'bottom-end', label: 'Bottom end' },
            ]
            return domSelect(
              {
                id: 'toast-placement-select',
                class: 'btn btn-secondary btn-sm',
                'aria-labelledby': 'toast-placement-label',
                value: state.at('toast.placement'),
                onChange: (e: Event) => {
                  const placement = (e.target as HTMLSelectElement).value as ToastPlacement
                  send({ type: 'toast', msg: { type: 'setPlacement', placement } })
                },
              },
              options.map((o) => domOption({ value: o.value }, [text(o.label)])),
            )
          })(),
          button(
            {
              id: 'toast-direction-toggle',
              class: 'btn btn-secondary btn-sm',
              type: 'button',
              onClick: () => {
                const root = document.documentElement
                root.dir = root.dir === 'rtl' ? 'ltr' : 'rtl'
              },
            },
            [text('Toggle direction (LTR/RTL)')],
          ),
        ]),
        // #265 finding 3: both demos exercise the exact six-value ToastType
        // vocabulary (`ToastKind` is a direct alias of `ToastType` — see
        // `../shared/bus.ts`), not a demo-local subset.
        div({ class: 'flex flex-wrap gap-2' }, [
          button(
            {
              id: 'toast-trigger-info',
              class: 'btn btn-secondary btn-sm',
              onClick: () =>
                showToast('info', 'For your information', 'This is an informational message.'),
            },
            [text('Info')],
          ),
          button(
            {
              id: 'toast-trigger-success',
              class: 'btn btn-primary btn-sm',
              onClick: () => showToast('success', 'Saved!', 'Your changes have been saved.'),
            },
            [text('Success')],
          ),
          button(
            {
              id: 'toast-trigger-warning',
              class: 'btn btn-secondary btn-sm',
              onClick: () => showToast('warning', 'Quota nearly full', 'Storage is above 90%.'),
            },
            [text('Warning')],
          ),
          button(
            {
              id: 'toast-trigger-error',
              class: 'btn btn-danger btn-sm',
              onClick: () => showToast('error', 'Something went wrong', 'Please try again later.'),
            },
            [text('Error')],
          ),
          button(
            {
              id: 'toast-trigger-custom',
              class: 'btn btn-secondary btn-sm',
              onClick: () =>
                showToast('custom', 'Review requested', 'A teammate requested your review.'),
            },
            [text('Custom')],
          ),
          button(
            {
              id: 'toast-trigger-loading',
              class: 'btn btn-secondary btn-sm',
              onClick: () => showToast('loading', 'Working on it', 'This may take a moment.'),
            },
            [text('Loading')],
          ),
          button(
            {
              id: 'toast-trigger-async',
              class: 'btn btn-secondary btn-sm',
              // #265 findings 3 & 8: create a real 'loading' toast, then PATCH
              // the SAME mounted row's type/title/description to 'success' —
              // never creating a second toast — proving the update contract
              // (reactive `data-type`/role/aria-live/text) live rather than in
              // a unit test alone. The id is captured here so the follow-up
              // `update` targets the exact row `create` just mounted.
              onClick: () => {
                const id = nextToastId()
                send({
                  type: 'toast',
                  msg: {
                    type: 'create',
                    toast: {
                      id,
                      type: 'loading',
                      title: 'Deploying',
                      description: 'Uploading the release bundle…',
                      duration: null,
                      dismissable: true,
                    },
                  },
                })
                setTimeout(() => {
                  send({
                    type: 'toast',
                    msg: {
                      type: 'update',
                      id,
                      patch: {
                        type: 'success',
                        title: 'Deploy complete',
                        description: 'The release is live.',
                        duration: 3000,
                      },
                    },
                  })
                }, 1200)
              },
            },
            [text('Async (loading → success)')],
          ),
        ]),
      ]),
      card('Confirm Dialog', [
        p({ class: 'mb-3 text-sm text-muted-foreground' }, [
          text('Last action: '),
          span({ class: 'font-medium' }, [text(state.at('message').map((m) => m || 'none'))]),
        ]),
        button(
          {
            class: 'btn btn-danger',
            onClick: () =>
              askConfirm('demo-delete', 'Delete this item?', 'This cannot be undone.', true),
          },
          [text('Delete item…')],
        ),
      ]),
    ]),
    toastRegion,
    confirmOverlay,
    drawerOverlay,
    dialogOverlay,
    alertDialogOverlay,
    commandMenuOverlay,
    searchSelectOverlay,
  ]
}
