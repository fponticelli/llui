import {
  component,
  div,
  h2,
  p,
  span,
  button,
  text,
  show,
  mountApp,
} from '@llui/core'
import {
  tabsView,
  tabsUpdate,
  type TabsSlice,
  type TabsMsg,
  accordionView,
  accordionUpdate,
  type AccordionSlice,
  type AccordionMsg,
  dialogView,
  dialogUpdate,
  type DialogSlice,
  type DialogMsg,
} from '@llui/ark'

type State = {
  tabs: TabsSlice
  accordion: AccordionSlice
  dialog: DialogSlice
  confirmCount: number
}

type Msg =
  | { type: 'tabs'; msg: TabsMsg }
  | { type: 'accordion'; msg: AccordionMsg }
  | { type: 'dialog'; msg: DialogMsg }
  | { type: 'confirmed' }

const Showcase = component<State, Msg, never>({
  name: 'Showcase',
  init: () => [
    {
      tabs: { activeTab: 'overview' },
      accordion: { openItems: ['what'] },
      dialog: { open: false },
      confirmCount: 0,
    },
    [],
  ],
  update: (state, msg) => {
    switch (msg.type) {
      case 'tabs':
        return [{ ...state, tabs: tabsUpdate(state.tabs, msg.msg) }, []]
      case 'accordion':
        return [{ ...state, accordion: accordionUpdate(state.accordion, msg.msg) }, []]
      case 'dialog':
        return [{ ...state, dialog: dialogUpdate(state.dialog, msg.msg) }, []]
      case 'confirmed':
        return [{ ...state, confirmCount: state.confirmCount + 1 }, []]
    }
  },
  view: (_state, send) => [
    // Tabs demo
    div({ class: 'section' }, [
      div({ class: 'section-title' }, [text('Tabs')]),
      ...tabsView<State>(
        {
          activeTab: (s) => s.tabs.activeTab,
          tabs: [
            {
              id: 'overview',
              label: 'Overview',
              content: () => [
                p({}, [
                  text(
                    'LLui is a compile-time-optimized web framework built on The Elm Architecture. ' +
                      'It uses bitmask dirty tracking to surgically update only the DOM nodes that changed.',
                  ),
                ]),
              ],
            },
            {
              id: 'features',
              label: 'Features',
              content: () => [
                div({}, [
                  p({}, [text('• No virtual DOM — view() runs once at mount')]),
                  p({}, [text('• Bitmask dirty tracking — O(1) skip per binding')]),
                  p({}, [text('• Effects as data — pure update(), testable without DOM')]),
                  p({}, [text('• Compile-time optimization via Vite plugin')]),
                  p({}, [text('• Two composition levels — view functions and child()')]),
                ]),
              ],
            },
            {
              id: 'performance',
              label: 'Performance',
              content: () => [
                p({}, [
                  text(
                    'Competitive with Solid.js across all benchmarks. Fastest on update and swap operations. ' +
                      'TodoMVC is 3.85 kB gzip including the full runtime.',
                  ),
                ]),
              ],
            },
          ],
        },
        (msg) => send({ type: 'tabs', msg }),
      ),
    ]),

    // Accordion demo
    div({ class: 'section', style: 'margin-top: 30px' }, [
      div({ class: 'section-title' }, [text('Accordion')]),
      ...accordionView<State>(
        {
          openItems: (s) => s.accordion.openItems,
          items: [
            {
              id: 'what',
              label: 'What is LLui?',
              content: () => [
                text(
                  'LLui is a compile-time-optimized web framework designed for LLM-first authoring. ' +
                    'It combines The Elm Architecture with surgical DOM updates via bitmask dirty tracking.',
                ),
              ],
            },
            {
              id: 'why',
              label: 'Why not React/Vue/Svelte?',
              content: () => [
                text(
                  'LLui optimizes for LLM code generation — one canonical pattern per concept, ' +
                    'discriminated unions for exhaustive checking, and no hook rules to violate.',
                ),
              ],
            },
            {
              id: 'how',
              label: 'How does the compiler work?',
              content: () => [
                text(
                  'The Vite plugin performs 3 passes: prop classification (static/event/reactive), ' +
                    'dependency analysis with bitmask injection, and import cleanup. Element helpers are ' +
                    'rewritten to elSplit() calls with precise dirty masks.',
                ),
              ],
            },
          ],
        },
        (msg) => send({ type: 'accordion', msg }),
      ),
    ]),

    // Dialog demo
    div({ class: 'section', style: 'margin-top: 30px' }, [
      div({ class: 'section-title' }, [text('Dialog')]),
      ...dialogView<State>(
        {
          open: (s) => s.dialog.open,
          trigger: () => [
            button({ class: 'btn btn-primary' }, [text('Open Dialog')]),
          ],
          title: 'Confirm Action',
          content: () => [
            p({}, [text('Are you sure you want to proceed? This action demonstrates the Dialog component.')]),
          ],
          onConfirm: () => send({ type: 'confirmed' }),
        },
        (msg) => send({ type: 'dialog', msg }),
      ),
      ...show<State>({
        when: (s) => s.confirmCount > 0,
        render: () => [
          span({ style: 'margin-left: 12px; color: #22c55e; font-size: 14px' }, [
            text((s: State) => `Confirmed ${s.confirmCount} time${s.confirmCount === 1 ? '' : 's'}`),
          ]),
        ],
      }),
    ]),
  ],
})

// The showcase is a self-contained component — mount into a container div
export function showcaseView(): Node[] {
  const container = document.createElement('div')
  mountApp(container, Showcase)
  return [container]
}
