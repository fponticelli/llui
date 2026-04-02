import { div, h2, p, button, text, portal } from '@llui/core'
import { useMachine, type ZagMachineConstructor, type ZagConnectFn } from '@llui/zag'

interface DialogApi {
  getTriggerProps(): Record<string, unknown>
  getBackdropProps(): Record<string, unknown>
  getPositionerProps(): Record<string, unknown>
  getContentProps(): Record<string, unknown>
  getTitleProps(): Record<string, unknown>
  getDescriptionProps(): Record<string, unknown>
  getCloseTriggerProps(): Record<string, unknown>
}

export function dialogPage(VM: ZagMachineConstructor, mod: { machine: unknown; connect: ZagConnectFn<DialogApi> }): Node[] {
  const z = useMachine(VM, mod.machine, mod.connect, { id: 'dlg' })
  return [
    h2({ class: 'page-title' }, [text('Dialog')]),
    p({ class: 'page-desc' }, [text('Modal dialog powered by @zag-js/dialog. Focus trap, backdrop dismiss, Escape key, and full ARIA support.')]),
    div({ class: 'demo-box' }, [
      z.render('button', a => ({ ...a.getTriggerProps(), class: 'btn btn-primary' }), [text('Open Dialog')]),
      ...portal({
        target: document.body,
        render: () => [
          z.render('div', a => a.getBackdropProps()),
          z.render('div', a => a.getPositionerProps(), [
            z.render('div', a => a.getContentProps(), [
              z.render('div', a => a.getTitleProps(), [text('Dialog Title')]),
              z.render('div', a => a.getDescriptionProps(), [
                p({}, [text('This dialog demonstrates @zag-js/dialog with automatic focus trapping, backdrop click dismiss, Escape key handling, and correct ARIA attributes.')]),
              ]),
              div({ class: 'dialog-footer' }, [
                z.render('button', a => ({ ...a.getCloseTriggerProps(), class: 'btn btn-ghost' }), [text('Cancel')]),
                z.render('button', a => ({ ...a.getCloseTriggerProps(), class: 'btn btn-primary' }), [text('Confirm')]),
              ]),
            ]),
          ]),
        ],
      }),
    ]),
  ]
}
