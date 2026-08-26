import { div, text, type Send, type Signal, type Mountable } from '@llui/dom'
import * as dialog from '@llui/components/dialog'
import * as popover from '@llui/components/popover'
import * as tooltip from '@llui/components/tooltip'
import { Button } from '../components/ui/button'
import {
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../components/ui/dialog'
import { PopoverArrow, PopoverContent } from '../components/ui/popover'
import { TooltipArrow, TooltipContent } from '../components/ui/tooltip'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { row, section } from './shared'

export interface State {
  dialog: dialog.DialogState
  popover: popover.PopoverState
  tooltip: tooltip.TooltipState
}

export type Msg =
  | { type: 'dialog'; msg: dialog.DialogMsg }
  | { type: 'popover'; msg: popover.PopoverMsg }
  | { type: 'tooltip'; msg: tooltip.TooltipMsg }

export const init = (): [State, never[]] => [
  { dialog: dialog.init(), popover: popover.init(), tooltip: tooltip.init() },
  [],
]

export function update(state: State, msg: Msg): [State, never[]] {
  switch (msg.type) {
    case 'dialog':
      return [{ ...state, dialog: dialog.update(state.dialog, msg.msg)[0] }, []]
    case 'popover':
      return [{ ...state, popover: popover.update(state.popover, msg.msg)[0] }, []]
    case 'tooltip':
      return [{ ...state, tooltip: tooltip.update(state.tooltip, msg.msg)[0] }, []]
  }
}

export function view(state: Signal<State>, send: Send<Msg>): readonly Mountable[] {
  const dlgSend = (m: dialog.DialogMsg): void => send({ type: 'dialog', msg: m })
  const popSend = (m: popover.PopoverMsg): void => send({ type: 'popover', msg: m })
  const tipSend = (m: tooltip.TooltipMsg): void => send({ type: 'tooltip', msg: m })

  const dlg = dialog.connect(state.at('dialog'), dlgSend, { id: 'demo-dialog' })
  const pop = popover.connect(state.at('popover'), popSend, { id: 'demo-popover' })
  const tip = tooltip.connect(state.at('tooltip'), tipSend, { id: 'demo-tooltip' })

  return [
    section(
      'Dialog, Popover & Tooltip',
      'The floating wrapper is built by overlay() itself, so its z-index arrives as positionerClass — there is deliberately no Positioner component to wrap.',
      [
        row('Triggers', [
          Button({ ...dlg.trigger, variant: 'destructive' }, [text('Delete project')]),
          Button({ ...pop.trigger, variant: 'outline' }, [text('Popover')]),
          Button({ ...tip.trigger, variant: 'ghost' }, [text('Hover me')]),
        ]),
      ],
    ),

    // Overlays are returned as siblings of the section, not nested inside it:
    // each portals to <body> on open, so where the Mountable is PLACED decides
    // which scope owns its teardown, not where it renders.
    dialog.overlay({
      state: state.at('dialog'),
      send: dlgSend,
      parts: dlg,
      // `fixed inset-0` is the consumer's job: overlay() builds the positioner
      // div but the part bag only carries data-*. Without it the dialog renders
      // in the page flow, at the bottom, with nothing dimmed.
      positionerClass: 'fixed inset-0 z-dialog grid place-items-center p-4',
      content: () => [
        DialogBackdrop({ ...dlg.backdrop }),
        DialogContent({ ...dlg.content }, [
          DialogTitle({ ...dlg.title }, [text('Delete project?')]),
          DialogDescription({ ...dlg.description }, [
            text('This cannot be undone. The project and its history are removed permanently.'),
          ]),
          DialogClose({ ...dlg.closeTrigger, 'aria-label': 'Close' }, [text('✕')]),
          DialogFooter([
            Button({ ...dlg.closeTrigger, variant: 'outline' }, [text('Cancel')]),
            Button({ ...dlg.closeTrigger, variant: 'destructive' }, [text('Delete')]),
          ]),
        ]),
      ],
    }),

    popover.overlay({
      state: state.at('popover'),
      send: popSend,
      parts: pop,
      positionerClass: 'z-popover',
      arrowSelector: "[data-part='arrow']",
      content: () => [
        PopoverContent({ ...pop.content }, [
          div({ class: 'mb-3 flex flex-col gap-1' }, [
            div({ ...pop.title, class: 'text-sm font-medium' }, [text('Dimensions')]),
            div({ ...pop.description, class: 'text-muted-foreground text-xs' }, [
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

    tooltip.overlay({
      state: state.at('tooltip'),
      send: tipSend,
      parts: tip,
      positionerClass: 'z-tooltip',
      content: () => [
        TooltipContent({ ...tip.content }, [text('Tooltips open on hover AND focus.')]),
        TooltipArrow({ ...tip.arrow }),
      ],
    }),
  ]
}
