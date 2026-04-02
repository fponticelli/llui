import {
  component,
  div,
  h3,
  p,
  span,
  button,
  input,
  label,
  text,
  portal,
  mountApp,
} from '@llui/core'
import { useMachine } from '@llui/zag'
import { VanillaMachine } from '@zag-js/vanilla'
import * as dialog from '@zag-js/dialog'
import * as tabs from '@zag-js/tabs'
import * as accordion from '@zag-js/accordion'
import * as tooltip from '@zag-js/tooltip'
import * as switchMachine from '@zag-js/switch'
import * as checkbox from '@zag-js/checkbox'
import * as slider from '@zag-js/slider'
import * as progress from '@zag-js/progress'

type State = { confirmCount: number; progressValue: number }
type Msg =
  | { type: 'confirmed' }
  | { type: 'setProgress'; value: number }

const Showcase = component<State, Msg, never>({
  name: 'Showcase',
  init: () => [{ confirmCount: 0, progressValue: 40 }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'confirmed':
        return [{ ...state, confirmCount: state.confirmCount + 1 }, []]
      case 'setProgress':
        return [{ ...state, progressValue: msg.value }, []]
    }
  },
  view: (_state, send) => {
    const tabsApi = useMachine(VanillaMachine, tabs.machine, tabs.connect, { id: 'tabs', value: 'overview' })
    const accApi = useMachine(VanillaMachine, accordion.machine, accordion.connect, { id: 'acc', value: ['what'] })
    const dlgApi = useMachine(VanillaMachine, dialog.machine, dialog.connect, { id: 'dlg' })
    const tipApi = useMachine(VanillaMachine, tooltip.machine, tooltip.connect, { id: 'tip' })
    const swApi = useMachine(VanillaMachine, switchMachine.machine, switchMachine.connect, { id: 'sw', label: 'Dark mode' })
    const cbApi = useMachine(VanillaMachine, checkbox.machine, checkbox.connect, { id: 'cb' })
    const slApi = useMachine(VanillaMachine, slider.machine, slider.connect, { id: 'sl', min: 0, max: 100, value: [40] })
    const pgApi = useMachine(VanillaMachine, progress.machine, progress.connect, { id: 'pg', value: 65 })

    return [
      // ── Tabs ────────────────────────────────────
      section('Tabs', [
        div(tabsApi.api.getRootProps() as Props, [
          div(tabsApi.api.getListProps() as Props, [
            button(tabsApi.api.getTriggerProps({ value: 'overview' }) as Props, [text('Overview')]),
            button(tabsApi.api.getTriggerProps({ value: 'features' }) as Props, [text('Features')]),
            button(tabsApi.api.getTriggerProps({ value: 'performance' }) as Props, [text('Performance')]),
          ]),
          div(tabsApi.api.getContentProps({ value: 'overview' }) as Props, [
            p({}, [text('LLui is a compile-time-optimized web framework built on The Elm Architecture.')]),
          ]),
          div(tabsApi.api.getContentProps({ value: 'features' }) as Props, [
            p({}, [text('• No virtual DOM  • Bitmask dirty tracking  • Effects as data  • Compile-time optimization')]),
          ]),
          div(tabsApi.api.getContentProps({ value: 'performance' }) as Props, [
            p({}, [text('Competitive with Solid.js. Fastest on update and swap. TodoMVC: 4.2 kB gzip.')]),
          ]),
        ]),
      ]),

      // ── Accordion ───────────────────────────────
      section('Accordion', [
        div(accApi.api.getRootProps() as Props,
          [
            { value: 'what', label: 'What is LLui?', body: 'A compile-time-optimized web framework for LLM-first authoring.' },
            { value: 'why', label: 'Why not React?', body: 'One canonical pattern per concept. No hook rules. Discriminated unions.' },
            { value: 'how', label: 'How does the compiler work?', body: '3 passes: prop classification, bitmask injection, import cleanup.' },
          ].map(item =>
            div(accApi.api.getItemProps({ value: item.value }) as Props, [
              button(accApi.api.getItemTriggerProps({ value: item.value }) as Props, [text(item.label)]),
              div(accApi.api.getItemContentProps({ value: item.value }) as Props, [
                p({}, [text(item.body)]),
              ]),
            ]),
          ),
        ),
      ]),

      // ── Dialog ──────────────────────────────────
      section('Dialog', [
        button({ ...dlgApi.api.getTriggerProps() as Props, class: 'btn btn-primary' }, [text('Open Dialog')]),
        ...portal({
          target: document.body,
          render: () => [
            div(dlgApi.api.getBackdropProps() as Props),
            div(dlgApi.api.getPositionerProps() as Props, [
              div(dlgApi.api.getContentProps() as Props, [
                div(dlgApi.api.getTitleProps() as Props, [text('Confirm Action')]),
                div(dlgApi.api.getDescriptionProps() as Props, [
                  p({}, [text('This dialog uses @zag-js/dialog with focus trap, backdrop dismiss, and full ARIA support.')]),
                ]),
                div({ class: 'dialog-footer' }, [
                  button({ ...dlgApi.api.getCloseTriggerProps() as Props, class: 'btn btn-ghost' }, [text('Cancel')]),
                  button({ class: 'btn btn-primary', onClick: () => { send({ type: 'confirmed' }); (dlgApi.api as Record<string, unknown> & { setOpen: (v: boolean) => void }).setOpen(false) } }, [text('Confirm')]),
                ]),
              ]),
            ]),
          ],
        }),
      ]),

      // ── Tooltip ─────────────────────────────────
      section('Tooltip', [
        button({ ...tipApi.api.getTriggerProps() as Props, class: 'btn btn-ghost' }, [text('Hover me')]),
        ...portal({
          target: document.body,
          render: () => [
            div(tipApi.api.getPositionerProps() as Props, [
              div({ ...tipApi.api.getContentProps() as Props, class: 'tooltip-content' }, [
                text('This is a Zag.js tooltip with positioning and ARIA'),
              ]),
            ]),
          ],
        }),
      ]),

      // ── Switch ──────────────────────────────────
      section('Switch', [
        label(swApi.api.getRootProps() as Props, [
          input(swApi.api.getHiddenInputProps() as Props),
          span(swApi.api.getControlProps() as Props, [
            span(swApi.api.getThumbProps() as Props),
          ]),
          span(swApi.api.getLabelProps() as Props, [text('Dark mode')]),
        ]),
      ]),

      // ── Checkbox ────────────────────────────────
      section('Checkbox', [
        label(cbApi.api.getRootProps() as Props, [
          input(cbApi.api.getHiddenInputProps() as Props),
          div(cbApi.api.getControlProps() as Props, [
            span({}, [text('✓')]),
          ]),
          span(cbApi.api.getLabelProps() as Props, [text('Accept terms and conditions')]),
        ]),
      ]),

      // ── Slider ──────────────────────────────────
      section('Slider', [
        div(slApi.api.getRootProps() as Props, [
          label(slApi.api.getLabelProps() as Props, [text('Volume')]),
          div({ class: 'slider-output' }, [text('40')]),
          div(slApi.api.getControlProps() as Props, [
            div(slApi.api.getTrackProps() as Props, [
              div(slApi.api.getRangeProps() as Props),
            ]),
            div(slApi.api.getThumbProps({ index: 0 }) as Props, [
              input(slApi.api.getHiddenInputProps({ index: 0 }) as Props),
            ]),
          ]),
        ]),
      ]),

      // ── Progress ────────────────────────────────
      section('Progress', [
        div(pgApi.api.getRootProps() as Props, [
          div({ class: 'progress-header' }, [
            label(pgApi.api.getLabelProps() as Props, [text('Uploading...')]),
            span({}, [text('65%')]),
          ]),
          div(pgApi.api.getTrackProps() as Props, [
            div(pgApi.api.getRangeProps() as Props),
          ]),
        ]),
      ]),
    ]
  },
})

type Props = Record<string, unknown>

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
