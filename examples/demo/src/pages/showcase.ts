import {
  component,
  div,
  h3,
  p,
  span,
  button,
  text,
  show,
  each,
  portal,
  mountApp,
  type Send,
} from '@llui/core'

// ── Types ────────────────────────────────────────────

type State = {
  activeTab: string
  openAccordion: string[]
  dialogOpen: boolean
  confirmCount: number
  toasts: Array<{ id: number; message: string; type: 'success' | 'error' | 'info' }>
  step: number
}

type Msg =
  | { type: 'selectTab'; tab: string }
  | { type: 'toggleAccordion'; item: string }
  | { type: 'openDialog' }
  | { type: 'closeDialog' }
  | { type: 'confirmed' }
  | { type: 'addToast'; message: string; kind: 'success' | 'error' | 'info' }
  | { type: 'removeToast'; id: number }
  | { type: 'nextStep' }
  | { type: 'prevStep' }
  | { type: 'resetSteps' }

let toastId = 0

const Showcase = component<State, Msg, never>({
  name: 'Showcase',
  init: () => [
    {
      activeTab: 'overview',
      openAccordion: ['what'],
      dialogOpen: false,
      confirmCount: 0,
      toasts: [],
      step: 0,
    },
    [],
  ],
  update: (state, msg) => {
    switch (msg.type) {
      case 'selectTab':
        return [{ ...state, activeTab: msg.tab }, []]
      case 'toggleAccordion': {
        const open = state.openAccordion.includes(msg.item)
          ? state.openAccordion.filter((i) => i !== msg.item)
          : [msg.item]
        return [{ ...state, openAccordion: open }, []]
      }
      case 'openDialog':
        return [{ ...state, dialogOpen: true }, []]
      case 'closeDialog':
        return [{ ...state, dialogOpen: false }, []]
      case 'confirmed':
        return [{ ...state, confirmCount: state.confirmCount + 1, dialogOpen: false }, []]
      case 'addToast':
        return [{ ...state, toasts: [...state.toasts, { id: toastId++, message: msg.message, type: msg.kind }] }, []]
      case 'removeToast':
        return [{ ...state, toasts: state.toasts.filter((t) => t.id !== msg.id) }, []]
      case 'nextStep':
        return [{ ...state, step: Math.min(state.step + 1, 3) }, []]
      case 'prevStep':
        return [{ ...state, step: Math.max(state.step - 1, 0) }, []]
      case 'resetSteps':
        return [{ ...state, step: 0 }, []]
    }
  },
  view: (_state, send) => [
    // ── Tabs ────────────────────────────────────────
    section('Tabs', [
      ...tabsComponent(
        ['overview', 'features', 'performance'],
        {
          overview: () => [p({}, [text(
            'LLui is a compile-time-optimized web framework built on The Elm Architecture. ' +
            'It uses bitmask dirty tracking to surgically update only the DOM nodes that changed.',
          )])],
          features: () => [
            p({}, [text('• No virtual DOM — view() runs once at mount')]),
            p({}, [text('• Bitmask dirty tracking — O(1) skip per binding')]),
            p({}, [text('• Effects as data — pure update(), testable without DOM')]),
            p({}, [text('• Compile-time optimization via Vite plugin')]),
          ],
          performance: () => [p({}, [text(
            'Competitive with Solid.js across all benchmarks. Fastest on update and swap. ' +
            'TodoMVC is 4.2 kB gzip including the full runtime.',
          )])],
        },
        send,
      ),
    ]),

    // ── Accordion ───────────────────────────────────
    section('Accordion', [
      ...accordionComponent(
        [
          { id: 'what', label: 'What is LLui?', content: 'A compile-time-optimized web framework designed for LLM-first authoring, combining TEA with surgical DOM updates via bitmask dirty tracking.' },
          { id: 'why', label: 'Why not React/Vue/Svelte?', content: 'LLui optimizes for LLM code generation — one canonical pattern per concept, discriminated unions for exhaustive checking, and no hook rules to violate.' },
          { id: 'how', label: 'How does the compiler work?', content: 'The Vite plugin performs 3 passes: prop classification, dependency analysis with bitmask injection, and import cleanup. Element helpers are rewritten to elSplit() calls.' },
        ],
        send,
      ),
    ]),

    // ── Dialog ──────────────────────────────────────
    section('Dialog', [
      button({ class: 'btn btn-primary', onClick: () => send({ type: 'openDialog' }) }, [text('Open Dialog')]),
      ...show<State>({
        when: (s) => s.confirmCount > 0,
        render: () => [
          span({ style: 'margin-left: 12px; color: var(--green); font-size: 14px' }, [
            text((s: State) => `Confirmed ${s.confirmCount} time${s.confirmCount === 1 ? '' : 's'}`),
          ]),
        ],
      }),
      ...show<State>({
        when: (s) => s.dialogOpen,
        render: () =>
          portal({
            target: document.body,
            render: () => [
              div({ class: 'dialog-backdrop', onClick: () => send({ type: 'closeDialog' }) }),
              div({ class: 'dialog-positioner' }, [
                div({ class: 'dialog-content', role: 'dialog', 'aria-modal': 'true' }, [
                  div({ class: 'dialog-header' }, [text('Confirm Action')]),
                  div({ class: 'dialog-body' }, [
                    p({}, [text('Are you sure you want to proceed? This demonstrates the Dialog pattern with portal rendering and backdrop.')]),
                  ]),
                  div({ class: 'dialog-footer' }, [
                    button({ class: 'btn btn-ghost', onClick: () => send({ type: 'closeDialog' }) }, [text('Cancel')]),
                    button({ class: 'btn btn-primary', onClick: () => send({ type: 'confirmed' }) }, [text('Confirm')]),
                  ]),
                ]),
              ]),
            ],
          }),
      }),
    ]),

    // ── Toast Notifications ─────────────────────────
    section('Toast Notifications', [
      div({ style: 'display: flex; gap: 8px; flex-wrap: wrap' }, [
        button({ class: 'btn btn-primary', onClick: () => send({ type: 'addToast', message: 'Contact saved successfully!', kind: 'success' }) }, [text('Success Toast')]),
        button({ class: 'btn btn-danger', onClick: () => send({ type: 'addToast', message: 'Failed to delete item.', kind: 'error' }) }, [text('Error Toast')]),
        button({ class: 'btn btn-ghost', onClick: () => send({ type: 'addToast', message: 'New version available.', kind: 'info' }) }, [text('Info Toast')]),
      ]),
      ...portal({
        target: document.body,
        render: () => [
          div({ class: 'toast-container' },
            each<State, State['toasts'][number]>({
              items: (s) => s.toasts,
              key: (t) => t.id,
              render: (item) => [
                div({ class: item((t) => `toast toast-${t.type}`) }, [
                  span({ class: 'toast-text' }, [text(item((t) => t.message))]),
                  button({
                    class: 'toast-close',
                    onClick: () => send({ type: 'removeToast', id: item((t) => t.id)() }),
                  }, [text('×')]),
                ]),
              ],
            }),
          ),
        ],
      }),
    ]),

    // ── Progress Stepper ────────────────────────────
    section('Progress Stepper', [
      div({ class: 'stepper' }, [
        ...['Account', 'Details', 'Review', 'Complete'].map((label, i) =>
          div({
            class: (s: State) =>
              `step ${s.step > i ? 'done' : ''} ${s.step === i ? 'active' : ''}`,
          }, [
            div({ class: 'step-dot' }, [text(String(i + 1))]),
            span({ class: 'step-label' }, [text(label)]),
          ]),
        ),
      ]),
      div({ style: 'display: flex; gap: 8px; margin-top: 16px' }, [
        button({ class: 'btn btn-ghost', onClick: () => send({ type: 'prevStep' }) }, [text('← Back')]),
        button({ class: 'btn btn-primary', onClick: () => send({ type: 'nextStep' }) }, [text('Next →')]),
        button({ class: 'btn btn-ghost', onClick: () => send({ type: 'resetSteps' }) }, [text('Reset')]),
      ]),
    ]),
  ],
})

// ── Helper: section wrapper ──────────────────────────

function section(title: string, children: Node[]): HTMLElement {
  return div({ class: 'section' }, [
    h3({ class: 'section-title' }, [text(title)]),
    ...children,
  ])
}

// ── Tabs (inline, no external deps) ────────────────────────────

function tabsComponent(
  tabIds: string[],
  panels: Record<string, () => Node[]>,
  send: Send<Msg>,
): Node[] {
  return [
    div({ class: 'tabs', role: 'tablist' },
      tabIds.map((id) =>
        button({
          class: (s: State) => `tab-trigger ${s.activeTab === id ? 'active' : ''}`,
          role: 'tab',
          'aria-selected': (s: State) => s.activeTab === id ? 'true' : 'false',
          onClick: () => send({ type: 'selectTab', tab: id }),
        }, [text(id.charAt(0).toUpperCase() + id.slice(1))]),
      ),
    ),
    ...tabIds.flatMap((id) =>
      show<State>({
        when: (s) => s.activeTab === id,
        render: () => [div({ class: 'tab-content', role: 'tabpanel' }, panels[id]!())],
      }),
    ),
  ]
}

// ── Accordion (inline, no external deps) ───────────────────────

function accordionComponent(
  items: Array<{ id: string; label: string; content: string }>,
  send: Send<Msg>,
): Node[] {
  return [
    div({ class: 'accordion' },
      items.map((item) =>
        div({ class: 'accordion-item' }, [
          button({
            class: (s: State) =>
              `accordion-trigger ${s.openAccordion.includes(item.id) ? 'open' : ''}`,
            'aria-expanded': (s: State) => s.openAccordion.includes(item.id) ? 'true' : 'false',
            onClick: () => send({ type: 'toggleAccordion', item: item.id }),
          }, [text(item.label)]),
          ...show<State>({
            when: (s) => s.openAccordion.includes(item.id),
            render: () => [
              div({ class: 'accordion-content', role: 'region' }, [text(item.content)]),
            ],
          }),
        ]),
      ),
    ),
  ]
}

// ── Mount ────────────────────────────────────────────

export function showcaseView(): Node[] {
  const container = document.createElement('div')
  mountApp(container, Showcase)
  return [container]
}
