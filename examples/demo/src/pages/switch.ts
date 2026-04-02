import { div, h2, p, text } from '@llui/core'
import { useMachine, type ZagMachineConstructor, type ZagConnectFn } from '@llui/zag'

interface SwitchApi {
  getRootProps(): Record<string, unknown>
  getHiddenInputProps(): Record<string, unknown>
  getControlProps(): Record<string, unknown>
  getThumbProps(): Record<string, unknown>
  getLabelProps(): Record<string, unknown>
}

export function switchPage(VM: ZagMachineConstructor, mod: { machine: unknown; connect: ZagConnectFn<SwitchApi> }): Node[] {
  const z = useMachine(VM, mod.machine, mod.connect, { id: 'sw', label: 'Dark mode' })
  return [
    h2({ class: 'page-title' }, [text('Switch')]),
    p({ class: 'page-desc' }, [text('Toggle switch powered by @zag-js/switch. Accessible with keyboard (Space) and proper ARIA role.')]),
    div({ class: 'demo-box' }, [
      z.render('label', a => a.getRootProps(), [
        z.render('input', a => a.getHiddenInputProps()),
        z.render('span', a => a.getControlProps(), [
          z.render('span', a => a.getThumbProps()),
        ]),
        z.render('span', a => a.getLabelProps(), [text('Dark mode')]),
      ]),
    ]),
  ]
}
