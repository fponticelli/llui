import { div, text, type Mountable, type Send, type Signal } from '@llui/dom'
import * as dialogC from '@llui/components/dialog'
import * as alertDialogC from '@llui/components/alert-dialog'
import * as drawerC from '@llui/components/drawer'
import * as popoverC from '@llui/components/popover'
import * as tooltipC from '@llui/components/tooltip'
import * as hoverCardC from '@llui/components/hover-card'
import * as menuC from '@llui/components/menu'
import * as selectC from '@llui/components/select'
import { Button } from '../components/ui/button'
import {
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../components/ui/dialog'
import { AlertDialogActions } from '../components/ui/alert-dialog'
import {
  SheetBackdrop,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '../components/ui/sheet'
import { PopoverArrow, PopoverContent } from '../components/ui/popover'
import { TooltipArrow, TooltipContent } from '../components/ui/tooltip'
import { HoverCardContent } from '../components/ui/hover-card'
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from '../components/ui/dropdown-menu'
import {
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectViewport,
  SelectItemIndicator,
} from '../components/ui/select'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Avatar, AvatarFallback } from '../components/ui/avatar'
import { row, section } from './shared'

export interface State {
  dialog: dialogC.DialogState
  confirm: alertDialogC.AlertDialogState
  sheet: drawerC.DrawerState
  popover: popoverC.PopoverState
  tooltip: tooltipC.TooltipState
  hoverCard: hoverCardC.HoverCardState
  menu: menuC.MenuState
  select: selectC.SelectState
}

export type Msg =
  | { type: 'dialog'; msg: dialogC.DialogMsg }
  | { type: 'confirm'; msg: alertDialogC.AlertDialogMsg }
  | { type: 'sheet'; msg: drawerC.DrawerMsg }
  | { type: 'popover'; msg: popoverC.PopoverMsg }
  | { type: 'tooltip'; msg: tooltipC.TooltipMsg }
  | { type: 'hoverCard'; msg: hoverCardC.HoverCardMsg }
  | { type: 'menu'; msg: menuC.MenuMsg }
  | { type: 'select'; msg: selectC.SelectMsg }

const MENU_ITEMS = [
  { value: 'profile', kind: 'action' as const },
  { value: 'settings', kind: 'action' as const },
  { value: 'logout', kind: 'action' as const },
]
const FRAMEWORKS = ['llui', 'solid', 'svelte', 'vue']

export const init = (): [State, never[]] => [
  {
    dialog: dialogC.init(),
    confirm: alertDialogC.init(),
    sheet: drawerC.init(),
    popover: popoverC.init(),
    tooltip: tooltipC.init(),
    hoverCard: hoverCardC.init(),
    menu: menuC.init({ items: MENU_ITEMS }),
    select: selectC.init({ items: FRAMEWORKS, value: ['llui'] }),
  },
  [],
]

export function update(state: State, msg: Msg): [State, never[]] {
  switch (msg.type) {
    case 'dialog':
      return [{ ...state, dialog: dialogC.update(state.dialog, msg.msg)[0] }, []]
    case 'confirm':
      return [{ ...state, confirm: alertDialogC.update(state.confirm, msg.msg)[0] }, []]
    case 'sheet':
      return [{ ...state, sheet: drawerC.update(state.sheet, msg.msg)[0] }, []]
    case 'popover':
      return [{ ...state, popover: popoverC.update(state.popover, msg.msg)[0] }, []]
    case 'tooltip':
      return [{ ...state, tooltip: tooltipC.update(state.tooltip, msg.msg)[0] }, []]
    case 'hoverCard':
      return [{ ...state, hoverCard: hoverCardC.update(state.hoverCard, msg.msg)[0] }, []]
    case 'menu':
      return [{ ...state, menu: menuC.update(state.menu, msg.msg)[0] }, []]
    case 'select':
      return [{ ...state, select: selectC.update(state.select, msg.msg)[0] }, []]
  }
}

export function view(state: Signal<State>, send: Send<Msg>): readonly Mountable[] {
  const dlgSend = (m: dialogC.DialogMsg): void => send({ type: 'dialog', msg: m })
  const cfmSend = (m: alertDialogC.AlertDialogMsg): void => send({ type: 'confirm', msg: m })
  const shtSend = (m: drawerC.DrawerMsg): void => send({ type: 'sheet', msg: m })
  const popSend = (m: popoverC.PopoverMsg): void => send({ type: 'popover', msg: m })
  const tipSend = (m: tooltipC.TooltipMsg): void => send({ type: 'tooltip', msg: m })
  const hcSend = (m: hoverCardC.HoverCardMsg): void => send({ type: 'hoverCard', msg: m })
  const menuSend = (m: menuC.MenuMsg): void => send({ type: 'menu', msg: m })
  const selSend = (m: selectC.SelectMsg): void => send({ type: 'select', msg: m })

  const dlg = dialogC.connect(state.at('dialog'), dlgSend, { id: 'demo-dialog' })
  const cfm = alertDialogC.connect(state.at('confirm'), cfmSend, { id: 'demo-confirm' })
  const sht = drawerC.connect(state.at('sheet'), shtSend, { id: 'demo-sheet' })
  const pop = popoverC.connect(state.at('popover'), popSend, { id: 'demo-popover' })
  const tip = tooltipC.connect(state.at('tooltip'), tipSend, { id: 'demo-tooltip' })
  const hc = hoverCardC.connect(state.at('hoverCard'), hcSend, { id: 'demo-hovercard' })
  const menu = menuC.connect(state.at('menu'), menuSend, { id: 'demo-menu' })
  const sel = selectC.connect(state.at('select'), selSend, { id: 'demo-select' })

  return [
    section(
      'Dialog, Sheet, Popover, Tooltip, Hover Card, Menu & Select',
      'The floating wrapper is built by overlay() itself, so its z-index and positioning arrive as positionerClass — and the backdrop is yours to render inside content(). Both are invisible until you style with utilities.',
      [
        row('Modal', [
          Button({ ...dlg.trigger, variant: 'outline' }, [text('Dialog')]),
          Button({ ...cfm.trigger, variant: 'destructive' }, [text('Delete project')]),
          Button({ ...sht.trigger, variant: 'outline' }, [text('Sheet')]),
        ]),
        row('Non-modal', [
          Button({ ...pop.trigger, variant: 'outline' }, [text('Popover')]),
          Button({ ...tip.trigger, variant: 'ghost' }, [text('Hover for tooltip')]),
          Button({ ...hc.trigger, variant: 'ghost' }, [text('@fponticelli')]),
          Button({ ...menu.trigger, variant: 'outline' }, [text('Menu ▾')]),
        ]),
        div({ class: 'flex w-[180px] flex-col gap-2' }, [
          Label([text('Framework')]),
          // `SelectValue` carries `data-part=select-value`, which is what the
          // trigger's `*:data-[part=select-value]:…` rules target. The chevron is
          // the trigger's own — not passed in.
          SelectTrigger({ ...sel.trigger, class: 'w-full' }, [
            SelectValue({ 'data-part': 'select-value' }, [text(sel.valueText)]),
          ]),
        ]),
      ],
    ),

    // Overlays are siblings of the section, not nested in it: each portals to
    // <body> on open, and PLACEMENT decides which scope owns the teardown.
    dialogC.overlay({
      state: state.at('dialog'),
      send: dlgSend,
      parts: dlg,
      positionerClass: 'fixed inset-0 z-dialog grid place-items-center p-4',
      content: () => [
        DialogBackdrop({ ...dlg.backdrop }),
        DialogContent({ ...dlg.content }, [
          DialogTitle({ ...dlg.title }, [text('Edit profile')]),
          DialogDescription({ ...dlg.description }, [
            text('Make changes to your profile here. Click save when you are done.'),
          ]),
          // No children: the component renders its own ✕, as shadcn's does.
          DialogClose({ ...dlg.closeTrigger, 'aria-label': 'Close' }),
          div({ class: 'mt-4 flex flex-col gap-2' }, [
            Label({ for: 'name' }, [text('Name')]),
            Input({ id: 'name', value: 'Franco', onInput: () => undefined }),
          ]),
          DialogFooter([
            Button({ ...dlg.closeTrigger, variant: 'outline' }, [text('Cancel')]),
            Button({ ...dlg.closeTrigger }, [text('Save changes')]),
          ]),
        ]),
      ],
    }),

    alertDialogC.overlay({
      state: state.at('confirm'),
      send: cfmSend,
      parts: cfm,
      positionerClass: 'fixed inset-0 z-dialog grid place-items-center p-4',
      content: () => [
        DialogBackdrop({ ...cfm.backdrop }),
        DialogContent({ ...cfm.content, class: 'max-w-md' }, [
          DialogTitle({ ...cfm.title }, [text('Delete project?')]),
          DialogDescription({ ...cfm.description }, [
            text('This cannot be undone. An outside click will NOT dismiss this one.'),
          ]),
          // No corner ✕ here on purpose: a destructive confirmation gets an
          // explicit cancel/confirm pair, not an ambiguous dismiss affordance.
          AlertDialogActions([
            Button({ ...cfm.closeTrigger, variant: 'outline' }, [text('Cancel')]),
            Button({ ...cfm.closeTrigger, variant: 'destructive' }, [text('Delete')]),
          ]),
        ]),
      ],
    }),

    drawerC.overlay({
      state: state.at('sheet'),
      send: shtSend,
      parts: sht,
      positionerClass: 'fixed inset-0 z-dialog flex',
      content: () => [
        SheetBackdrop({ ...sht.backdrop }),
        SheetContent({ ...sht.content, side: 'right' }, [
          SheetHeader([
            SheetTitle({ ...sht.title }, [text('Panel')]),
            SheetDescription({ ...sht.description }, [
              text('`side` is a variant on the content — the machine only owns open/close.'),
            ]),
          ]),
          Button({ ...sht.closeTrigger, variant: 'outline', class: 'w-fit' }, [text('Close')]),
        ]),
      ],
    }),

    popoverC.overlay({
      state: state.at('popover'),
      send: popSend,
      parts: pop,
      positionerClass: 'z-popover',
      arrowSelector: "[data-part='arrow']",
      content: () => [
        PopoverContent({ ...pop.content }, [
          div({ class: 'mb-3 flex flex-col gap-1' }, [
            div({ ...pop.title, class: 'text-sm font-medium' }, [text('Dimensions')]),
            div({ ...pop.description, class: 'text-xs text-muted-foreground' }, [
              text('Set the layout dimensions.'),
            ]),
          ]),
          div({ class: 'flex flex-col gap-2' }, [
            Label({ for: 'width', class: 'text-xs' }, [text('Width')]),
            Input({ id: 'width', value: '100%', onInput: () => undefined, class: 'h-8' }),
          ]),
          PopoverArrow({ ...pop.arrow }),
        ]),
      ],
    }),

    tooltipC.overlay({
      state: state.at('tooltip'),
      send: tipSend,
      parts: tip,
      positionerClass: 'z-tooltip',
      content: () => [
        TooltipContent({ ...tip.content }, [text('Tooltips open on hover AND focus.')]),
        TooltipArrow({ ...tip.arrow }),
      ],
    }),

    hoverCardC.overlay({
      state: state.at('hoverCard'),
      send: hcSend,
      parts: hc,
      positionerClass: 'z-popover',
      content: () => [
        HoverCardContent({ ...hc.content }, [
          div({ class: 'flex gap-3' }, [
            Avatar([AvatarFallback([text('FP')])]),
            div({ class: 'flex flex-col gap-1' }, [
              div({ class: 'text-sm font-medium' }, [text('Franco Ponticelli')]),
              div({ class: 'text-xs text-muted-foreground' }, [text('Builds LLui.')]),
            ]),
          ]),
        ]),
      ],
    }),

    menuC.overlay({
      state: state.at('menu'),
      send: menuSend,
      parts: menu,
      positionerClass: 'z-popover',
      content: () => [
        DropdownMenuContent({ ...menu.content }, [
          DropdownMenuItem({ ...menu.item('profile').item }, [text('Profile')]),
          DropdownMenuItem({ ...menu.item('settings').item }, [
            text('Settings'),
            DropdownMenuShortcut([text('⌘,')]),
          ]),
          DropdownMenuSeparator({ ...menu.separator() }),
          DropdownMenuItem({ ...menu.item('logout').item }, [text('Log out')]),
        ]),
      ],
    }),

    selectC.overlay({
      state: state.at('select'),
      send: selSend,
      parts: sel,
      positionerClass: 'z-popover',
      content: () => [
        SelectContent(
          { ...sel.content },
          FRAMEWORKS.map((f) => SelectItem({ ...sel.item(f).item }, [text(f)])),
        ),
      ],
    }),
  ]
}
