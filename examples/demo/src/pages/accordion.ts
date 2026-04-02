import { div, h2, p, text } from '@llui/core'
import { useMachine, type ZagMachineConstructor, type ZagConnectFn } from '@llui/zag'

interface AccordionApi {
  getRootProps(): Record<string, unknown>
  getItemProps(opts: { value: string }): Record<string, unknown>
  getItemTriggerProps(opts: { value: string }): Record<string, unknown>
  getItemContentProps(opts: { value: string }): Record<string, unknown>
}

const items = [
  { value: 'what', label: 'What is LLui?', body: 'A compile-time-optimized web framework for LLM-first authoring.' },
  { value: 'why', label: 'Why not React?', body: 'One canonical pattern per concept. No hook rules. Discriminated unions.' },
  { value: 'how', label: 'How does the compiler work?', body: '3 passes: prop classification, bitmask injection, import cleanup.' },
]

export function accordionPage(VM: ZagMachineConstructor, mod: { machine: unknown; connect: ZagConnectFn<AccordionApi> }): Node[] {
  const z = useMachine(VM, mod.machine, mod.connect, { id: 'acc', value: ['what'] })
  return [
    h2({ class: 'page-title' }, [text('Accordion')]),
    p({ class: 'page-desc' }, [text('Collapsible sections. Manages focus, aria-expanded, and data-state.')]),
    div({ class: 'demo-box' }, [
      z.render('div', a => a.getRootProps(),
        items.map(item =>
          z.render('div', a => a.getItemProps({ value: item.value }), [
            z.render('button', a => a.getItemTriggerProps({ value: item.value }), [text(item.label)]),
            z.render('div', a => a.getItemContentProps({ value: item.value }), [
              p({}, [text(item.body)]),
            ]),
          ]),
        ),
      ),
    ]),
  ]
}
