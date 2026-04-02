import {
  component,
  div,
  h3,
  p,
  span,
  button,
  text,
  show,
  portal,
  mountApp,
} from '@llui/core'
import { useMachine } from '@llui/zag'
import { VanillaMachine } from '@zag-js/vanilla'
import * as dialog from '@zag-js/dialog'
import * as tabs from '@zag-js/tabs'
import * as accordion from '@zag-js/accordion'

// ── Types ────────────────────────────────────────────

type State = {
  confirmCount: number
  toasts: Array<{ id: number; message: string; type: 'success' | 'error' | 'info' }>
  step: number
}

type Msg =
  | { type: 'confirmed' }
  | { type: 'addToast'; message: string; kind: 'success' | 'error' | 'info' }
  | { type: 'removeToast'; id: number }
  | { type: 'nextStep' }
  | { type: 'prevStep' }
  | { type: 'resetSteps' }

let toastId = 0

const Showcase = component<State, Msg, never>({
  name: 'Showcase',
  init: () => [{ confirmCount: 0, toasts: [], step: 0 }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'confirmed':
        return [{ ...state, confirmCount: state.confirmCount + 1 }, []]
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
  view: (_state, send) => {
    // ── Zag Tabs ──────────────────────────────────
    const tabsMachine = useMachine(
      VanillaMachine, tabs.machine, tabs.connect,
      { id: 'showcase-tabs', value: 'overview' },
    )

    // ── Zag Accordion ─────────────────────────────
    const accordionMachine = useMachine(
      VanillaMachine, accordion.machine, accordion.connect,
      { id: 'showcase-acc', multiple: false, value: ['what'] },
    )

    // ── Zag Dialog ────────────────────────────────
    const dialogMachine = useMachine(
      VanillaMachine, dialog.machine, dialog.connect,
      { id: 'showcase-dlg' },
    )

    return [
      // ── Tabs Section ───────────────────────────
      section('Tabs (Zag.js)', [
        div(tabsMachine.api.getRootProps() as Record<string, unknown>, [
          div(tabsMachine.api.getListProps() as Record<string, unknown>, [
            button(tabsMachine.api.getTriggerProps({ value: 'overview' }) as Record<string, unknown>, [text('Overview')]),
            button(tabsMachine.api.getTriggerProps({ value: 'features' }) as Record<string, unknown>, [text('Features')]),
            button(tabsMachine.api.getTriggerProps({ value: 'performance' }) as Record<string, unknown>, [text('Performance')]),
          ]),
          div(tabsMachine.api.getContentProps({ value: 'overview' }) as Record<string, unknown>, [
            p({}, [text('LLui is a compile-time-optimized web framework built on The Elm Architecture. It uses bitmask dirty tracking to surgically update only the DOM nodes that changed.')]),
          ]),
          div(tabsMachine.api.getContentProps({ value: 'features' }) as Record<string, unknown>, [
            p({}, [text('• No virtual DOM — view() runs once at mount')]),
            p({}, [text('• Bitmask dirty tracking — O(1) skip per binding')]),
            p({}, [text('• Effects as data — pure update(), testable without DOM')]),
            p({}, [text('• Compile-time optimization via Vite plugin')]),
          ]),
          div(tabsMachine.api.getContentProps({ value: 'performance' }) as Record<string, unknown>, [
            p({}, [text('Competitive with Solid.js across all benchmarks. Fastest on update and swap. TodoMVC is 4.2 kB gzip.')]),
          ]),
        ]),
      ]),

      // ── Accordion Section ──────────────────────
      section('Accordion (Zag.js)', [
        div(accordionMachine.api.getRootProps() as Record<string, unknown>,
          [
            { value: 'what', label: 'What is LLui?', content: 'A compile-time-optimized web framework designed for LLM-first authoring.' },
            { value: 'why', label: 'Why not React/Vue/Svelte?', content: 'LLui optimizes for LLM code generation — one canonical pattern per concept.' },
            { value: 'how', label: 'How does the compiler work?', content: 'The Vite plugin performs 3 passes: prop classification, dependency analysis, and import cleanup.' },
          ].map((item) =>
            div(accordionMachine.api.getItemProps({ value: item.value }) as Record<string, unknown>, [
              button(accordionMachine.api.getItemTriggerProps({ value: item.value }) as Record<string, unknown>, [text(item.label)]),
              div(accordionMachine.api.getItemContentProps({ value: item.value }) as Record<string, unknown>, [
                p({}, [text(item.content)]),
              ]),
            ]),
          ),
        ),
      ]),

      // ── Dialog Section ─────────────────────────
      section('Dialog (Zag.js)', [
        button(dialogMachine.api.getTriggerProps() as Record<string, unknown>, [text('Open Dialog')]),
        ...show<State>({
          when: (s) => s.confirmCount > 0,
          render: () => [
            span({ style: 'margin-left: 12px; color: var(--green); font-size: 14px' }, [
              text((s: State) => `Confirmed ${s.confirmCount} time${s.confirmCount === 1 ? '' : 's'}`),
            ]),
          ],
        }),
        ...portal({
          target: document.body,
          render: () => [
            div(dialogMachine.api.getBackdropProps() as Record<string, unknown>),
            div(dialogMachine.api.getPositionerProps() as Record<string, unknown>, [
              div(dialogMachine.api.getContentProps() as Record<string, unknown>, [
                div(dialogMachine.api.getTitleProps() as Record<string, unknown>, [text('Confirm Action')]),
                div(dialogMachine.api.getDescriptionProps() as Record<string, unknown>, [
                  p({}, [text('Are you sure you want to proceed? This demonstrates Zag.js Dialog with focus trap, backdrop, and ARIA.')]),
                ]),
                div({ class: 'dialog-footer' }, [
                  button({
                    class: 'btn btn-ghost',
                    ...(dialogMachine.api.getCloseTriggerProps() as Record<string, unknown>),
                  }, [text('Cancel')]),
                  button({
                    class: 'btn btn-primary',
                    onClick: () => {
                      send({ type: 'confirmed' })
                      ;(dialogMachine.api as Record<string, unknown> & { setOpen: (v: boolean) => void }).setOpen(false)
                    },
                  }, [text('Confirm')]),
                ]),
              ]),
            ]),
          ],
        }),
      ]),

      // ── Toast Notifications (native LLui) ──────
      section('Toast Notifications', [
        div({ style: 'display: flex; gap: 8px; flex-wrap: wrap' }, [
          button({ class: 'btn btn-primary', onClick: () => send({ type: 'addToast', message: 'Contact saved!', kind: 'success' }) }, [text('Success')]),
          button({ class: 'btn btn-danger', onClick: () => send({ type: 'addToast', message: 'Failed to delete.', kind: 'error' }) }, [text('Error')]),
          button({ class: 'btn btn-ghost', onClick: () => send({ type: 'addToast', message: 'New version available.', kind: 'info' }) }, [text('Info')]),
        ]),
        ...portal({
          target: document.body,
          render: () => [
            div({ class: 'toast-container' }, [
              ...show<State>({
                when: (s) => s.toasts.length > 0,
                render: () => [
                  div({}, [text('toasts active')]), // placeholder — each() needs items accessor
                ],
              }),
            ]),
          ],
        }),
      ]),

      // ── Progress Stepper (native LLui) ─────────
      section('Progress Stepper', [
        div({ class: 'stepper' }, [
          ...['Account', 'Details', 'Review', 'Complete'].map((label, i) =>
            div({
              class: (s: State) => `step ${s.step > i ? 'done' : ''} ${s.step === i ? 'active' : ''}`,
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
    ]
  },
})

function section(title: string, children: Node[]): HTMLElement {
  return div({ class: 'section' }, [
    h3({ class: 'section-title' }, [text(title)]),
    ...children,
  ])
}

export function showcaseView(): Node[] {
  const container = document.createElement('div')
  mountApp(container, Showcase)
  return [container]
}
