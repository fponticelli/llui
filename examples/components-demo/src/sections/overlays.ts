import {
  component,
  mergeHandlers,
  sliceHandler,
  div,
  button,
  span,
  text,
  h3,
  p,
  input,
} from '@llui/dom'
import { popover, type PopoverState, type PopoverMsg } from '@llui/components/popover'
import { tooltip, type TooltipState, type TooltipMsg } from '@llui/components/tooltip'
import { hoverCard, type HoverCardState, type HoverCardMsg } from '@llui/components/hover-card'
import { menu, type MenuState, type MenuMsg } from '@llui/components/menu'
import {
  contextMenu,
  type ContextMenuState,
  type ContextMenuMsg,
} from '@llui/components/context-menu'
import { select, type SelectState, type SelectMsg } from '@llui/components/select'
import { combobox, type ComboboxState, type ComboboxMsg } from '@llui/components/combobox'
import { drawer, type DrawerState, type DrawerMsg } from '@llui/components/drawer'
import { dialog, type DialogState, type DialogMsg } from '@llui/components/dialog'
import {
  alertDialog,
  type AlertDialogState,
  type AlertDialogMsg,
} from '@llui/components/alert-dialog'
import { toast, type ToasterState, type ToasterMsg, nextToastId } from '@llui/components/toast'
import {
  confirmDialog,
  type ConfirmDialogState,
  type ConfirmDialogMsg,
  openWith,
} from '@llui/components/patterns/confirm-dialog'
import { sectionGroup, card } from '../shared/ui'
import {
  registerToastHandler,
  registerConfirmHandler,
  showToast,
  askConfirm,
  type ToastKind,
} from '../shared/bus'

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

type State = {
  popover: PopoverState
  tooltip: TooltipState
  hoverCard: HoverCardState
  menu: MenuState
  contextMenu: ContextMenuState
  select: SelectState
  combobox: ComboboxState
  drawer: DrawerState
  dialog: DialogState
  alertDialog: AlertDialogState
  toast: ToasterState
  confirm: ConfirmDialogState
  message: string
}
type Msg =
  | { type: 'popover'; msg: PopoverMsg }
  | { type: 'tooltip'; msg: TooltipMsg }
  | { type: 'hoverCard'; msg: HoverCardMsg }
  | { type: 'menu'; msg: MenuMsg }
  | { type: 'contextMenu'; msg: ContextMenuMsg }
  | { type: 'select'; msg: SelectMsg }
  | { type: 'combobox'; msg: ComboboxMsg }
  | { type: 'drawer'; msg: DrawerMsg }
  | { type: 'dialog'; msg: DialogMsg }
  | { type: 'alertDialog'; msg: AlertDialogMsg }
  | { type: 'toast'; msg: ToasterMsg }
  | { type: 'confirm'; msg: ConfirmDialogMsg }
  | { type: 'emitToast'; kind: ToastKind; title: string; description: string }
  | { type: 'askConfirm'; tag: string; title: string; description: string; destructive: boolean }

let localSend: (m: Msg) => void = () => {
  throw new Error('send not initialized')
}

const init = (): [State, never[]] => [
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
    confirm: confirmDialog.init(),
    message: '',
  },
  [],
]

const update = mergeHandlers<State, Msg, never>(
  sliceHandler({
    get: (s) => s.popover,
    set: (s, v) => ({ ...s, popover: v }),
    narrow: (m) => (m.type === 'popover' ? m.msg : null),
    sub: popover.update,
  }),
  sliceHandler({
    get: (s) => s.tooltip,
    set: (s, v) => ({ ...s, tooltip: v }),
    narrow: (m) => (m.type === 'tooltip' ? m.msg : null),
    sub: tooltip.update,
  }),
  sliceHandler({
    get: (s) => s.hoverCard,
    set: (s, v) => ({ ...s, hoverCard: v }),
    narrow: (m) => (m.type === 'hoverCard' ? m.msg : null),
    sub: hoverCard.update,
  }),
  sliceHandler({
    get: (s) => s.menu,
    set: (s, v) => ({ ...s, menu: v }),
    narrow: (m) => (m.type === 'menu' ? m.msg : null),
    sub: menu.update,
  }),
  sliceHandler({
    get: (s) => s.contextMenu,
    set: (s, v) => ({ ...s, contextMenu: v }),
    narrow: (m) => (m.type === 'contextMenu' ? m.msg : null),
    sub: contextMenu.update,
  }),
  sliceHandler({
    get: (s) => s.select,
    set: (s, v) => ({ ...s, select: v }),
    narrow: (m) => (m.type === 'select' ? m.msg : null),
    sub: select.update,
  }),
  sliceHandler({
    get: (s) => s.combobox,
    set: (s, v) => ({ ...s, combobox: v }),
    narrow: (m) => (m.type === 'combobox' ? m.msg : null),
    sub: combobox.update,
  }),
  sliceHandler({
    get: (s) => s.drawer,
    set: (s, v) => ({ ...s, drawer: v }),
    narrow: (m) => (m.type === 'drawer' ? m.msg : null),
    sub: drawer.update,
  }),
  sliceHandler({
    get: (s) => s.dialog,
    set: (s, v) => ({ ...s, dialog: v }),
    narrow: (m) => (m.type === 'dialog' ? m.msg : null),
    sub: dialog.update,
  }),
  sliceHandler({
    get: (s) => s.alertDialog,
    set: (s, v) => ({ ...s, alertDialog: v }),
    narrow: (m) => (m.type === 'alertDialog' ? m.msg : null),
    sub: alertDialog.update,
  }),
  sliceHandler({
    get: (s) => s.toast,
    set: (s, v) => ({ ...s, toast: v }),
    narrow: (m) => (m.type === 'toast' ? m.msg : null),
    sub: toast.update,
  }),
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

export const App = component<State, Msg, never>({
  name: 'OverlaysSection',
  init,
  update,
  view: ({ send, each }) => {
    localSend = send
    // Register bus handlers so other sections can trigger toast/confirm
    registerToastHandler((kind, title, description) =>
      send({ type: 'emitToast', kind, title, description }),
    )
    registerConfirmHandler((tag, title, description, destructive) =>
      send({ type: 'askConfirm', tag, title, description, destructive }),
    )

    const po = popover.connect<State>(
      (s) => s.popover,
      (m) => send({ type: 'popover', msg: m }),
      { id: 'pop-demo' },
    )
    const tp = tooltip.connect<State>(
      (s) => s.tooltip,
      (m) => send({ type: 'tooltip', msg: m }),
      { id: 'tip-demo', delayOpen: 300 },
    )
    const hc = hoverCard.connect<State>(
      (s) => s.hoverCard,
      (m) => send({ type: 'hoverCard', msg: m }),
      { id: 'hc-demo', openDelay: 400 },
    )
    const me = menu.connect<State>(
      (s) => s.menu,
      (m) => send({ type: 'menu', msg: m }),
      {
        id: 'menu-demo',
        onSelect: () => showToast('info', 'Menu action', 'An item was selected'),
      },
    )
    const cm = contextMenu.connect<State>(
      (s) => s.contextMenu,
      (m) => send({ type: 'contextMenu', msg: m }),
      { id: 'cm-demo' },
    )
    const se = select.connect<State>(
      (s) => s.select,
      (m) => send({ type: 'select', msg: m }),
      { id: 'sel-demo', placeholder: 'Choose a color' },
    )
    const co = combobox.connect<State>(
      (s) => s.combobox,
      (m) => send({ type: 'combobox', msg: m }),
      { id: 'cb-demo' },
    )
    const dr = drawer.connect<State>(
      (s) => s.drawer,
      (m) => send({ type: 'drawer', msg: m }),
      { id: 'drawer-demo', side: 'right' },
    )
    const dlg = dialog.connect<State>(
      (s) => s.dialog,
      (m) => send({ type: 'dialog', msg: m }),
      { id: 'dialog-demo' },
    )
    const adlg = alertDialog.connect<State>(
      (s) => s.alertDialog,
      (m) => send({ type: 'alertDialog', msg: m }),
      { id: 'alert-dialog-demo' },
    )
    const toastParts = toast.connect<State>(
      (s) => s.toast,
      (m) => send({ type: 'toast', msg: m }),
    )

    const selectItems = (): Node[] =>
      ['Red', 'Green', 'Blue', 'Purple', 'Orange'].map((v, i) =>
        div({ ...se.item(v, i).item }, [text(v)]),
      )
    const menuItems = (): Node[] =>
      ['Edit', 'Duplicate', 'Archive', 'Delete'].map((v) => div({ ...me.item(v).item }, [text(v)]))
    const ctxMenuItems = (): Node[] =>
      ['Cut', 'Copy', 'Paste', 'Delete'].map((v) => div({ ...cm.item(v).item }, [text(v)]))

    type Toast = { id: string; type: string; title?: string; description?: string }
    const toastRegion = div(
      { ...toastParts.region },
      each({
        items: (s) => s.toast.toasts,
        key: (t) => t.id,
        render: ({ item }) => [
          div({ 'data-scope': 'toast', 'data-part': 'root', 'data-type': item.type }, [
            div({ 'data-scope': 'toast', 'data-part': 'title' }, [text(() => item.title() ?? '')]),
            div({ 'data-scope': 'toast', 'data-part': 'description' }, [
              text(() => item.description() ?? ''),
            ]),
          ]),
        ],
      }),
    )

    const confirmOverlay = confirmDialog.view<State>({
      get: (s) => s.confirm,
      send: (m) => send({ type: 'confirm', msg: m }),
      id: 'confirm-dialog',
    })

    const drawerOverlay = drawer.overlay<State>({
      get: (s) => s.drawer,
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

    const dialogOverlay = dialog.overlay<State>({
      get: (s) => s.dialog,
      send: (m) => send({ type: 'dialog', msg: m }),
      parts: dlg,
      content: () => [
        div({ ...dlg.content }, [
          button({ ...dlg.closeTrigger }, [text('\u00d7')]),
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

    const alertDialogOverlay = alertDialog.overlay<State>({
      get: (s) => s.alertDialog,
      send: (m) => send({ type: 'alertDialog', msg: m }),
      parts: adlg,
      content: () => [
        div({ ...adlg.content }, [
          button({ ...adlg.closeTrigger }, [text('\u00d7')]),
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

    return [
      sectionGroup('Overlays', [
        card('Popover', [
          button({ ...po.trigger, class: 'btn btn-primary' }, [text('Show info')]),
          ...popover.overlay<State>({
            get: (s) => s.popover,
            send: (m) => send({ type: 'popover', msg: m }),
            parts: po,
            content: () => [
              div(
                {
                  ...po.content,
                  class: 'min-w-[16rem] rounded-md border border-slate-200 bg-white p-4 shadow-lg',
                },
                [
                  h3({ ...po.title, class: 'text-sm font-semibold' }, [text('Did you know?')]),
                  p({ class: 'mt-1 text-xs text-text-muted' }, [
                    text('LLui compiles state paths into bitmasks at build time.'),
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
          ...tooltip.overlay<State>({
            get: (s) => s.tooltip,
            send: (m) => send({ type: 'tooltip', msg: m }),
            parts: tp,
            content: () => [div({ ...tp.content }, [text('This is a tooltip')])],
          }),
        ]),
        card('Hover Card', [
          span({ ...hc.trigger, class: 'underline decoration-dotted cursor-pointer' }, [
            text('Hover for details'),
          ]),
          ...hoverCard.overlay<State>({
            get: (s) => s.hoverCard,
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
          button({ ...me.trigger, class: 'btn btn-secondary' }, [text('Actions ▾')]),
          ...menu.overlay<State>({
            get: (s) => s.menu,
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
          ...contextMenu.overlay<State>({
            get: (s) => s.contextMenu,
            send: (m) => send({ type: 'contextMenu', msg: m }),
            parts: cm,
            content: () => [div({ ...cm.content }, ctxMenuItems())],
          }),
        ]),
        card('Select', [
          button({ ...se.trigger }, [
            span([text((s: State) => se.valueText(s))]),
            span({ class: 'ml-2 text-text-muted' }, [text('▾')]),
          ]),
          ...select.overlay<State>({
            get: (s) => s.select,
            send: (m) => send({ type: 'select', msg: m }),
            parts: se,
            content: () => [div({ ...se.content }, selectItems())],
          }),
        ]),
        card('Combobox', [
          div({ ...co.root, class: 'relative' }, [
            input({ ...co.input, placeholder: 'Search fruits…' }),
          ]),
          ...combobox.overlay<State>({
            get: (s) => s.combobox,
            send: (m) => send({ type: 'combobox', msg: m }),
            parts: co,
            content: () => [
              div(
                { ...co.content },
                each({
                  items: (s) => s.combobox.filteredItems,
                  key: (v) => v,
                  render: ({ item, index }) => {
                    const value = item((t: string) => t)()
                    const idx = index()
                    const parts = co.item(value, idx).item
                    return [div({ ...parts }, [text(value)])]
                  },
                }),
              ),
            ],
          }),
          div({ class: 'mt-3 text-sm text-text-muted' }, [
            text('Selected: '),
            text((s: State) => s.combobox.value[0] ?? 'none'),
          ]),
        ]),
        card('Drawer', [
          button({ ...dr.trigger, class: 'btn btn-primary' }, [text('Open drawer')]),
        ]),
        card('Dialog', [
          button({ ...dlg.trigger, class: 'btn btn-primary' }, [text('Edit profile')]),
        ]),
        card('Alert Dialog', [
          button({ ...adlg.trigger, class: 'btn btn-danger' }, [text('Revoke API key…')]),
          p({ class: 'mt-2 text-xs text-text-muted' }, [
            text('role="alertdialog" — outside-click does not dismiss by default.'),
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
                onClick: () =>
                  showToast('error', 'Something went wrong', 'Please try again later.'),
              },
              [text('Error')],
            ),
          ]),
        ]),
        card('Confirm Dialog', [
          p({ class: 'mb-3 text-sm text-text-muted' }, [
            text('Last action: '),
            span({ class: 'font-medium' }, [text((s: State) => s.message || 'none')]),
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
      ...confirmOverlay,
      ...drawerOverlay,
      ...dialogOverlay,
      ...alertDialogOverlay,
    ]
  },
})

// Silence unused var (the bus handlers reference localSend indirectly via send closure)
void localSend
