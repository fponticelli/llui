import { div, h2, p, span, text } from '@llui/core'
import { useMachine, type ZagMachineConstructor, type ZagConnectFn } from '@llui/zag'

interface CheckboxApi {
  getRootProps(): Record<string, unknown>
  getHiddenInputProps(): Record<string, unknown>
  getControlProps(): Record<string, unknown>
  getLabelProps(): Record<string, unknown>
}

export function checkboxPage(VM: ZagMachineConstructor, mod: { machine: unknown; connect: ZagConnectFn<CheckboxApi> }): Node[] {
  const z = useMachine(VM, mod.machine, mod.connect, { id: 'cb' })
  return [
    h2({ class: 'page-title' }, [text('Checkbox')]),
    p({ class: 'page-desc' }, [text('Checkbox powered by @zag-js/checkbox. Manages checked/unchecked/indeterminate states with correct ARIA.')]),
    div({ class: 'demo-box' }, [
      z.render('label', a => a.getRootProps(), [
        z.render('input', a => a.getHiddenInputProps()),
        z.render('div', a => a.getControlProps(), [
          span({}, [text('✓')]),
        ]),
        z.render('span', a => a.getLabelProps(), [text('Accept terms and conditions')]),
      ]),
    ]),
  ]
}
