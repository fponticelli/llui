import { div, h2, p, text } from '@llui/core'
import { useMachine, type ZagMachineConstructor, type ZagConnectFn } from '@llui/zag'

interface SliderApi {
  getRootProps(): Record<string, unknown>
  getLabelProps(): Record<string, unknown>
  getControlProps(): Record<string, unknown>
  getTrackProps(): Record<string, unknown>
  getRangeProps(): Record<string, unknown>
  getThumbProps(opts: { index: number }): Record<string, unknown>
  getHiddenInputProps(opts: { index: number }): Record<string, unknown>
}

export function sliderPage(VM: ZagMachineConstructor, mod: { machine: unknown; connect: ZagConnectFn<SliderApi> }): Node[] {
  const z = useMachine(VM, mod.machine, mod.connect, { id: 'sl', min: 0, max: 100, value: [50] })
  return [
    h2({ class: 'page-title' }, [text('Slider')]),
    p({ class: 'page-desc' }, [text('Range slider powered by @zag-js/slider. Keyboard accessible (arrows, Home, End), draggable thumb.')]),
    div({ class: 'demo-box' }, [
      z.render('div', a => a.getRootProps(), [
        z.render('label', a => a.getLabelProps(), [text('Volume')]),
        z.render('div', a => a.getControlProps(), [
          z.render('div', a => a.getTrackProps(), [
            z.render('div', a => a.getRangeProps()),
          ]),
          z.render('div', a => a.getThumbProps({ index: 0 }), [
            z.render('input', a => a.getHiddenInputProps({ index: 0 })),
          ]),
        ]),
      ]),
    ]),
  ]
}
