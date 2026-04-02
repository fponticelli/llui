import { div, h2, p, button, text, portal } from '@llui/core'
import { useMachine } from '@llui/zag'

type Props = Record<string, unknown>

export function tooltipPage(VM: unknown, mod: { machine: unknown; connect: unknown }): Node[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { api } = useMachine(VM as any, mod.machine, mod.connect as any, { id: 'tip' })
  return [
    h2({ class: 'page-title' }, [text('Tooltip')]),
    p({ class: 'page-desc' }, [text('Hover tooltip powered by @zag-js/tooltip. Handles positioning, open/close delays, and ARIA describedby.')]),
    div({ class: 'demo-box' }, [
      button({ ...api.getTriggerProps() as Props, class: 'btn btn-primary' }, [text('Hover me for tooltip')]),
      ...portal({
        target: document.body,
        render: () => [
          div(api.getPositionerProps() as Props, [
            div({ ...api.getContentProps() as Props, class: 'tooltip-content' }, [
              text('This tooltip is powered by @zag-js/tooltip'),
            ]),
          ]),
        ],
      }),
    ]),
  ]
}
