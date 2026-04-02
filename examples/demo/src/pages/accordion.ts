import { div, h2, p, button, text } from '@llui/core'
import { useMachine } from '@llui/zag'

type Props = Record<string, unknown>

const items = [
  { value: 'what', label: 'What is LLui?', body: 'A compile-time-optimized web framework designed for LLM-first authoring, combining TEA with surgical DOM updates via bitmask dirty tracking.' },
  { value: 'why', label: 'Why not React/Vue/Svelte?', body: 'LLui optimizes for LLM code generation — one canonical pattern per concept, discriminated unions for exhaustive checking, and no hook rules to violate.' },
  { value: 'how', label: 'How does the compiler work?', body: 'The Vite plugin performs 3 passes: prop classification (static/event/reactive), dependency analysis with bitmask injection, and import cleanup with element helper elision.' },
]

export function accordionPage(VM: unknown, mod: { machine: unknown; connect: unknown }): Node[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { api } = useMachine(VM as any, mod.machine, mod.connect as any, { id: 'acc', value: ['what'] })
  return [
    h2({ class: 'page-title' }, [text('Accordion')]),
    p({ class: 'page-desc' }, [text('Collapsible sections powered by @zag-js/accordion. Manages focus, aria-expanded, and data-state attributes.')]),
    div({ class: 'demo-box' }, [
      div(api.getRootProps() as Props,
        items.map((item) =>
          div(api.getItemProps({ value: item.value }) as Props, [
            button(api.getItemTriggerProps({ value: item.value }) as Props, [text(item.label)]),
            div(api.getItemContentProps({ value: item.value }) as Props, [
              p({}, [text(item.body)]),
            ]),
          ]),
        ),
      ),
    ]),
  ]
}
