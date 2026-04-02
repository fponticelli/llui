import { div, h2, p, text } from '@llui/core'
import { useMachine, type ZagMachineConstructor, type ZagConnectFn } from '@llui/zag'

interface TabsApi {
  getRootProps(): Record<string, unknown>
  getListProps(): Record<string, unknown>
  getTriggerProps(opts: { value: string }): Record<string, unknown>
  getContentProps(opts: { value: string }): Record<string, unknown>
}

export function tabsPage(VM: ZagMachineConstructor, mod: { machine: unknown; connect: ZagConnectFn<TabsApi> }): Node[] {
  const z = useMachine(VM, mod.machine, mod.connect, { id: 'tabs', value: 'overview' })
  return [
    h2({ class: 'page-title' }, [text('Tabs')]),
    p({ class: 'page-desc' }, [text('Keyboard-navigable tabbed interface. Try arrow keys to switch tabs.')]),
    div({ class: 'demo-box' }, [
      z.render('div', a => a.getRootProps(), [
        z.render('div', a => a.getListProps(), [
          z.render('button', a => a.getTriggerProps({ value: 'overview' }), [text('Overview')]),
          z.render('button', a => a.getTriggerProps({ value: 'features' }), [text('Features')]),
          z.render('button', a => a.getTriggerProps({ value: 'perf' }), [text('Performance')]),
        ]),
        z.render('div', a => a.getContentProps({ value: 'overview' }), [
          p({}, [text('LLui uses bitmask dirty tracking to surgically update only the DOM nodes that changed.')]),
        ]),
        z.render('div', a => a.getContentProps({ value: 'features' }), [
          p({}, [text('• No virtual DOM  • Bitmask tracking  • Effects as data  • Compile-time optimization')]),
        ]),
        z.render('div', a => a.getContentProps({ value: 'perf' }), [
          p({}, [text('Competitive with Solid.js. Fastest on update and swap. TodoMVC: 4.2 kB gzip.')]),
        ]),
      ]),
    ]),
  ]
}
