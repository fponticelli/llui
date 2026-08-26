/**
 * Root component for the LLui registry demo.
 *
 * One signal component, one update loop; each section owns a slice of the root
 * state and the reducer routes `{ type: <section>, msg }` into it — the same
 * composition `examples/components-demo` uses. No section emits effects, so
 * there is no `onEffect` here.
 *
 * `overlays.view` returns an ARRAY: its three overlays portal to <body> on open
 * and are placed as siblings of the section card, because placement decides
 * which scope owns their teardown.
 */
import { component, div, type Mountable } from '@llui/dom'
import * as buttons from './sections/buttons'
import * as forms from './sections/forms'
import * as controls from './sections/controls'
import * as overlays from './sections/overlays'
import * as feedback from './sections/feedback'
import * as data from './sections/data'
import { groupHeading } from './sections/shared'

interface State {
  buttons: buttons.State
  forms: forms.State
  controls: controls.State
  overlays: overlays.State
  feedback: feedback.State
  data: data.State
}

type Msg =
  | { type: 'buttons'; msg: buttons.Msg }
  | { type: 'forms'; msg: forms.Msg }
  | { type: 'controls'; msg: controls.Msg }
  | { type: 'overlays'; msg: overlays.Msg }
  | { type: 'feedback'; msg: feedback.Msg }
  | { type: 'data'; msg: data.Msg }

export const App = component<State, Msg, never>({
  name: 'RegistryDemo',
  init: () => [
    {
      buttons: buttons.init()[0],
      forms: forms.init()[0],
      controls: controls.init()[0],
      overlays: overlays.init()[0],
      feedback: feedback.init()[0],
      data: data.init()[0],
    },
    [],
  ],
  update: (state, msg) => {
    switch (msg.type) {
      case 'buttons':
        return [{ ...state, buttons: buttons.update(state.buttons)[0] }, []]
      case 'forms':
        return [{ ...state, forms: forms.update(state.forms, msg.msg)[0] }, []]
      case 'controls':
        return [{ ...state, controls: controls.update(state.controls, msg.msg)[0] }, []]
      case 'overlays':
        return [{ ...state, overlays: overlays.update(state.overlays, msg.msg)[0] }, []]
      case 'feedback':
        return [{ ...state, feedback: feedback.update(state.feedback)[0] }, []]
      case 'data':
        return [{ ...state, data: data.update(state.data)[0] }, []]
    }
  },
  view: ({ state, send }): readonly Mountable[] => [
    div([
      groupHeading('Presentational'),
      buttons.view(),
      forms.view(state.at('forms'), (msg) => send({ type: 'forms', msg })),
      feedback.view(),
      data.view(),

      groupHeading('Skins over @llui/components'),
      controls.view(state.at('controls'), (msg) => send({ type: 'controls', msg })),
      ...overlays.view(state.at('overlays'), (msg) => send({ type: 'overlays', msg })),
    ]),
  ],
})
