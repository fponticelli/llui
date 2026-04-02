import { div, h2, p, button, text, portal } from '@llui/core'
import { useMachine } from '@llui/zag'

type Props = Record<string, unknown>

export function dialogPage(VM: unknown, mod: { machine: unknown; connect: unknown }): Node[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { api } = useMachine(VM as any, mod.machine, mod.connect as any, { id: 'dlg' })
  return [
    h2({ class: 'page-title' }, [text('Dialog')]),
    p({ class: 'page-desc' }, [text('Modal dialog powered by @zag-js/dialog. Focus trap, backdrop dismiss, Escape key, and full ARIA support.')]),
    div({ class: 'demo-box' }, [
      button({ ...api.getTriggerProps() as Props, class: 'btn btn-primary' }, [text('Open Dialog')]),
      ...portal({
        target: document.body,
        render: () => [
          div(api.getBackdropProps() as Props),
          div(api.getPositionerProps() as Props, [
            div(api.getContentProps() as Props, [
              div(api.getTitleProps() as Props, [text('Dialog Title')]),
              div(api.getDescriptionProps() as Props, [
                p({}, [text('This dialog demonstrates @zag-js/dialog with automatic focus trapping, backdrop click dismiss, Escape key handling, and correct ARIA attributes.')]),
              ]),
              div({ class: 'dialog-footer' }, [
                button({ ...api.getCloseTriggerProps() as Props, class: 'btn btn-ghost' }, [text('Cancel')]),
                button({ ...api.getCloseTriggerProps() as Props, class: 'btn btn-primary' }, [text('Confirm')]),
              ]),
            ]),
          ]),
        ],
      }),
    ]),
  ]
}
