import { div, button, span, h3, p, input, svg, path, each, text, onMount } from '@llui/dom'
import type { Send, Signal, Renderable } from '@llui/dom'
import { popover } from '@llui/components/popover'
import { tooltip } from '@llui/components/tooltip'
import { hoverCard } from '@llui/components/hover-card'
import { menu } from '@llui/components/menu'
import { contextMenu } from '@llui/components/context-menu'
import { select } from '@llui/components/select'
import { combobox } from '@llui/components/combobox'
import { drawer } from '@llui/components/drawer'
import { dialog } from '@llui/components/dialog'
import { alertDialog } from '@llui/components/alert-dialog'
import { toast, nextToastId } from '@llui/components/toast'
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
   * @example({"type":"confirm","msg":{"type":"confirm"}})
   */
  | { type: 'confirm'; msg: ConfirmDialogMsg }
  /**
   * @intent("Emit a new toast notification")
   * @example({"type":"emitToast","kind":"success","title":"Saved","description":"Changes persisted."})
   */
  | { type: 'emitToast'; kind: ToastKind; title: string; description: string }
  /**
   * @intent("Ask for user confirmation before a destructive action")
   * @example({"type":"askConfirm","tag":"deleteAccount","title":"Delete account?","description":"This cannot be undone.","destructive":true})
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
    menu: menu.init({ items: ['Edit', 'Duplicate', 'Archive', 'Delete'], open: false }),
    contextMenu: contextMenu.init({ items: ['Cut', 'Copy', 'Paste', 'Delete'] }),
    select: select.init({ items: ['Red', 'Green', 'Blue', 'Purple', 'Orange'], value: ['Blue'] }),
    combobox: combobox.init({ items: FRUITS }),
    drawer: drawer.init({ open: false }),
    dialog: dialog.init({ open: false }),
    alertDialog: alertDialog.init({ open: false }),
    toast: toast.init({ placement: 'bottom-end' }),
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

  const selectItems = (): Renderable =>
    ['Red', 'Green', 'Blue', 'Purple', 'Orange'].map((v, i) =>
      div({ ...se.item(v, i).item }, [text(v)]),
    )
  const menuItems = (): Renderable =>
    ['Edit', 'Duplicate', 'Archive', 'Delete'].map((v) => div({ ...me.item(v).item }, [text(v)]))
  const ctxMenuItems = (): Renderable =>
    ['Cut', 'Copy', 'Paste', 'Delete'].map((v) => div({ ...cm.item(v).item }, [text(v)]))

  const toastRegion = div({ ...toastParts.region }, [
    each(state.at('toast.toasts'), {
      key: (t) => t.id,
      render: (item) => [
        div({ 'data-scope': 'toast', 'data-part': 'root', 'data-type': item.at('type') }, [
          div({ 'data-scope': 'toast', 'data-part': 'title' }, [
            text(item.map((t) => t.title ?? '')),
          ]),
          div({ 'data-scope': 'toast', 'data-part': 'description' }, [
            text(item.map((t) => t.description ?? '')),
          ]),
        ]),
      ],
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
    content: () => [
      div({ ...dr.content }, [
        h3({ ...dr.title, class: 'text-lg font-semibold' }, [text('Drawer panel')]),
        p({ class: 'mt-2 text-sm text-text-muted' }, [
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
    content: () => [
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
    content: () => [
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
    content: () => [
      div(
        {
          ...cmd.dialog.content,
          class:
            'w-[32rem] max-w-[90vw] overflow-hidden rounded-lg border border-border bg-surface shadow-2xl',
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
                        'flex cursor-pointer items-center justify-between rounded px-3 py-2 text-sm data-[highlighted]:bg-surface-hover',
                    },
                    [
                      span([text(item.at('label'))]),
                      span({ class: 'text-xs text-text-muted' }, [
                        text(item.map((c) => c.shortcut ?? '')),
                      ]),
                    ],
                  ),
                ]
              },
            }),
            div({ ...cmd.empty, class: 'px-3 py-6 text-center text-sm text-text-muted' }, [
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
          class:
            'min-w-[12rem] overflow-hidden rounded-md border border-border bg-surface shadow-lg',
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
                        'cursor-pointer rounded px-3 py-1.5 text-sm data-[highlighted]:bg-surface-hover data-[state=selected]:font-semibold',
                    },
                    [text(item)],
                  ),
                ]
              },
            }),
            div(
              {
                ...ssel.empty,
                class: 'px-3 py-4 text-center text-sm text-text-muted',
              },
              [text('No results')],
            ),
          ]),
        ],
      ),
    ],
  })

  return [
    // Placed so the ⌘K hotkey onMount registers (a discarded onMount() is inert).
    hotkeyMount,
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
                class: 'min-w-[16rem] rounded-md border border-border bg-surface p-4 shadow-lg',
              },
              [
                h3({ ...po.title, class: 'text-sm font-semibold' }, [text('Did you know?')]),
                p({ class: 'mt-1 text-xs text-text-muted' }, [
                  text('LLui gives each binding a chunked mask of the state paths it reads.'),
                ]),
                button({ ...po.closeTrigger, class: 'btn btn-secondary mt-3 text-xs' }, [
                  text('Got it'),
                ]),
              ],
            ),
          ],
          placement: 'bottom-start',
        }),
      ]),
      card('Tooltip', [
        button({ ...tp.trigger, class: 'btn btn-secondary' }, [text('Hover me')]),
        tooltip.overlay({
          state: state.at('tooltip'),
          send: (m) => send({ type: 'tooltip', msg: m }),
          parts: tp,
          content: () => [div({ ...tp.content }, [text('This is a tooltip')])],
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
              p({ class: 'mt-1 text-xs text-text-muted' }, [
                text('Full keyboard, screen-reader, pointer support.'),
              ]),
            ]),
          ],
        }),
      ]),
      card('Menu', [
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
        div(
          {
            ...cm.trigger,
            class:
              'p-8 bg-surface-muted border-2 border-dashed border-border rounded-md text-center text-text-muted select-none',
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
        div({ class: 'mt-3 text-sm text-text-muted' }, [
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
        div({ class: 'mt-3 text-sm text-text-muted' }, [
          text('Selected: '),
          text(state.at('searchSelect.combobox.value').map((v) => v[0] ?? 'none')),
        ]),
        p({ class: 'mt-1 text-xs text-text-muted' }, [
          text('Filter-only input — typed text never commits; pick from the list.'),
        ]),
      ]),
      card('Drawer', [button({ ...dr.trigger, class: 'btn btn-primary' }, [text('Open drawer')])]),
      card('Dialog', [
        button({ ...dlg.trigger, class: 'btn btn-primary' }, [text('Edit profile')]),
      ]),
      card('Alert Dialog', [
        button({ ...adlg.trigger, class: 'btn btn-danger' }, [text('Revoke API key…')]),
        p({ class: 'mt-2 text-xs text-text-muted' }, [
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
        p({ class: 'mt-2 text-xs text-text-muted' }, [
          text(
            'Type to filter, ↑↓ to navigate, Enter to run. Executed commands toast + rank as recents.',
          ),
        ]),
      ]),
      card('Toast', [
        div({ class: 'flex gap-2' }, [
          button(
            {
              class: 'btn btn-secondary text-xs',
              onClick: () =>
                showToast('info', 'For your information', 'This is an informational message.'),
            },
            [text('Info')],
          ),
          button(
            {
              class: 'btn btn-primary text-xs',
              onClick: () => showToast('success', 'Saved!', 'Your changes have been saved.'),
            },
            [text('Success')],
          ),
          button(
            {
              class: 'btn btn-danger text-xs',
              onClick: () => showToast('error', 'Something went wrong', 'Please try again later.'),
            },
            [text('Error')],
          ),
        ]),
      ]),
      card('Confirm Dialog', [
        p({ class: 'mb-3 text-sm text-text-muted' }, [
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
