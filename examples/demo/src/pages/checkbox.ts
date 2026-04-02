import { div, h2, p, span, input, label, text } from '@llui/core'
import { useMachine } from '@llui/zag'

type Props = Record<string, unknown>

export function checkboxPage(VM: unknown, mod: { machine: unknown; connect: unknown }): Node[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { api } = useMachine(VM as any, mod.machine, mod.connect as any, { id: 'cb' })
  return [
    h2({ class: 'page-title' }, [text('Checkbox')]),
    p({ class: 'page-desc' }, [text('Checkbox powered by @zag-js/checkbox. Manages checked/unchecked/indeterminate states with correct ARIA.')]),
    div({ class: 'demo-box' }, [
      label(api.getRootProps() as Props, [
        input(api.getHiddenInputProps() as Props),
        div(api.getControlProps() as Props, [
          span({}, [text('✓')]),
        ]),
        span(api.getLabelProps() as Props, [text('Accept terms and conditions')]),
      ]),
    ]),
  ]
}
