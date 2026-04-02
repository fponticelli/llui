import { div, h2, p, text, portal } from '@llui/core'
import { useMachine, type ZagMachineConstructor, type ZagConnectFn } from '@llui/zag'

interface TooltipApi {
  getTriggerProps(): Record<string, unknown>
  getPositionerProps(): Record<string, unknown>
  getContentProps(): Record<string, unknown>
}

export function tooltipPage(VM: ZagMachineConstructor, mod: { machine: unknown; connect: ZagConnectFn<TooltipApi> }): Node[] {
  const z = useMachine(VM, mod.machine, mod.connect, { id: 'tip' })
  return [
    h2({ class: 'page-title' }, [text('Tooltip')]),
    p({ class: 'page-desc' }, [text('Hover tooltip powered by @zag-js/tooltip. Handles positioning, open/close delays, and ARIA describedby.')]),
    div({ class: 'demo-box' }, [
      z.render('button', a => ({ ...a.getTriggerProps(), class: 'btn btn-primary' }), [text('Hover me for tooltip')]),
      ...portal({
        target: document.body,
        render: () => [
          z.render('div', a => a.getPositionerProps(), [
            z.render('div', a => ({ ...a.getContentProps(), class: 'tooltip-content' }), [
              text('This tooltip is powered by @zag-js/tooltip'),
            ]),
          ]),
        ],
      }),
    ]),
  ]
}
