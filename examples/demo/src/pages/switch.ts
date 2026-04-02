import { div, h2, p, span, input, label, text } from '@llui/core'
import { useMachine } from '@llui/zag'

type Props = Record<string, unknown>

export function switchPage(VM: unknown, mod: { machine: unknown; connect: unknown }): Node[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { api } = useMachine(VM as any, mod.machine, mod.connect as any, { id: 'sw', label: 'Dark mode' })
  return [
    h2({ class: 'page-title' }, [text('Switch')]),
    p({ class: 'page-desc' }, [text('Toggle switch powered by @zag-js/switch. Accessible with keyboard (Space) and proper ARIA role.')]),
    div({ class: 'demo-box' }, [
      label(api.getRootProps() as Props, [
        input(api.getHiddenInputProps() as Props),
        span(api.getControlProps() as Props, [
          span(api.getThumbProps() as Props),
        ]),
        span(api.getLabelProps() as Props, [text('Dark mode')]),
      ]),
    ]),
  ]
}
