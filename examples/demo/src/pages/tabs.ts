import { div, h2, p, button, text } from '@llui/core'
import { useMachine } from '@llui/zag'

type Props = Record<string, unknown>

export function tabsPage(VM: unknown, mod: { machine: unknown; connect: unknown }): Node[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { api } = useMachine(VM as any, mod.machine, mod.connect as any, { id: 'tabs', value: 'overview' })
  return [
    h2({ class: 'page-title' }, [text('Tabs')]),
    p({ class: 'page-desc' }, [text('Keyboard-navigable tabbed interface powered by @zag-js/tabs. Try arrow keys to switch tabs.')]),
    div({ class: 'demo-box' }, [
      div(api.getRootProps() as Props, [
        div(api.getListProps() as Props, [
          button(api.getTriggerProps({ value: 'overview' }) as Props, [text('Overview')]),
          button(api.getTriggerProps({ value: 'features' }) as Props, [text('Features')]),
          button(api.getTriggerProps({ value: 'perf' }) as Props, [text('Performance')]),
        ]),
        div(api.getContentProps({ value: 'overview' }) as Props, [
          p({}, [text('LLui is a compile-time-optimized web framework built on The Elm Architecture. It uses bitmask dirty tracking to surgically update only the DOM nodes that changed.')]),
        ]),
        div(api.getContentProps({ value: 'features' }) as Props, [
          p({}, [text('• No virtual DOM — view() runs once at mount')]),
          p({}, [text('• Bitmask dirty tracking — O(1) skip per binding')]),
          p({}, [text('• Effects as data — pure update(), testable without DOM')]),
          p({}, [text('• Compile-time optimization via Vite plugin')]),
        ]),
        div(api.getContentProps({ value: 'perf' }) as Props, [
          p({}, [text('Competitive with Solid.js across all benchmarks. Fastest on update and swap operations. TodoMVC: 4.2 kB gzip including the full runtime.')]),
        ]),
      ]),
    ]),
  ]
}
