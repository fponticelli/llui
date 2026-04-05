/**
 * Task 06 — Accordion (Tier 2)
 * Idiomatic score: 6/6
 */
import { component, div, button, text, show } from '@llui/dom'

type Panel = { id: number; title: string; body: string }

type State = {
  panels: Panel[]
  openId: number | null
}

type Msg = { type: 'toggle'; id: number }
type Effect = never

const PANELS: Panel[] = [
  { id: 1, title: 'Panel 1', body: 'Content for panel one.' },
  { id: 2, title: 'Panel 2', body: 'Content for panel two.' },
  { id: 3, title: 'Panel 3', body: 'Content for panel three.' },
]

export const Accordion = component<State, Msg, Effect>({
  name: 'Accordion',
  init: () => [{ panels: PANELS, openId: null }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'toggle':
        return [{ ...state, openId: state.openId === msg.id ? null : msg.id }, []]
    }
  },
  view: (send, { show }) => [
    div({ class: 'accordion' }, [
      ...PANELS.flatMap((panel) => [
        div({ class: 'panel' }, [
          button(
            {
              class: 'panel-title',
              onClick: () => send({ type: 'toggle', id: panel.id }),
            },
            [text(panel.title)],
          ),
          ...show({
            when: (s) => s.openId === panel.id,
            render: () => [div({ class: 'panel-body' }, [text(panel.body)])],
          }),
        ]),
      ]),
    ]),
  ],
})
