import { div, h2, p, input, label, text } from '@llui/core'
import { useMachine } from '@llui/zag'

type Props = Record<string, unknown>

export function sliderPage(VM: unknown, mod: { machine: unknown; connect: unknown }): Node[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { api } = useMachine(VM as any, mod.machine, mod.connect as any, { id: 'sl', min: 0, max: 100, value: [50] })
  return [
    h2({ class: 'page-title' }, [text('Slider')]),
    p({ class: 'page-desc' }, [text('Range slider powered by @zag-js/slider. Keyboard accessible (arrows, Home, End), draggable thumb.')]),
    div({ class: 'demo-box' }, [
      div(api.getRootProps() as Props, [
        label(api.getLabelProps() as Props, [text('Volume')]),
        div(api.getControlProps() as Props, [
          div(api.getTrackProps() as Props, [
            div(api.getRangeProps() as Props),
          ]),
          div(api.getThumbProps({ index: 0 }) as Props, [
            input(api.getHiddenInputProps({ index: 0 }) as Props),
          ]),
        ]),
      ]),
    ]),
  ]
}
