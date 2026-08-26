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
import * as presentational from './sections/presentational'
import * as forms from './sections/forms'
import * as navigation from './sections/navigation'
import * as overlays from './sections/overlays'
import * as layout from './sections/layout'
import * as data from './sections/data'
import * as advanced from './sections/advanced'
import * as menus from './sections/menus'
import * as media from './sections/media'
import { groupHeading } from './sections/shared'

interface State {
  presentational: presentational.State
  forms: forms.State
  navigation: navigation.State
  overlays: overlays.State
  layout: layout.State
  data: data.State
  advanced: advanced.State
  menus: menus.State
  media: media.State
}

type Msg =
  | { type: 'presentational'; msg: presentational.Msg }
  | { type: 'forms'; msg: forms.Msg }
  | { type: 'navigation'; msg: navigation.Msg }
  | { type: 'overlays'; msg: overlays.Msg }
  | { type: 'layout'; msg: layout.Msg }
  | { type: 'data'; msg: data.Msg }
  | { type: 'advanced'; msg: advanced.Msg }
  | { type: 'menus'; msg: menus.Msg }
  | { type: 'media'; msg: media.Msg }

export const App = component<State, Msg, never>({
  name: 'RegistryDemo',
  init: () => [
    {
      presentational: presentational.init()[0],
      forms: forms.init()[0],
      navigation: navigation.init()[0],
      overlays: overlays.init()[0],
      layout: layout.init()[0],
      data: data.init()[0],
      advanced: advanced.init()[0],
      menus: menus.init()[0],
      media: media.init()[0],
    },
    [],
  ],
  update: (state, msg) => {
    switch (msg.type) {
      case 'presentational':
        return [{ ...state, presentational: presentational.update(state.presentational)[0] }, []]
      case 'forms':
        return [{ ...state, forms: forms.update(state.forms, msg.msg)[0] }, []]
      case 'navigation':
        return [{ ...state, navigation: navigation.update(state.navigation, msg.msg)[0] }, []]
      case 'overlays':
        return [{ ...state, overlays: overlays.update(state.overlays, msg.msg)[0] }, []]
      case 'layout':
        return [{ ...state, layout: layout.update(state.layout, msg.msg)[0] }, []]
      case 'data':
        return [{ ...state, data: data.update(state.data, msg.msg)[0] }, []]
      case 'advanced':
        return [{ ...state, advanced: advanced.update(state.advanced, msg.msg)[0] }, []]
      case 'menus':
        return [{ ...state, menus: menus.update(state.menus, msg.msg)[0] }, []]
      case 'media':
        return [{ ...state, media: media.update(state.media, msg.msg)[0] }, []]
    }
  },
  view: ({ state, send }): readonly Mountable[] => [
    div([
      groupHeading('Presentational'),
      ...presentational.view(),

      groupHeading('Forms'),
      ...forms.view(state.at('forms'), (msg) => send({ type: 'forms', msg })),

      groupHeading('Data display'),
      ...data.view(state.at('data'), (msg) => send({ type: 'data', msg })),

      groupHeading('Navigation & disclosure'),
      ...navigation.view(state.at('navigation'), (msg) => send({ type: 'navigation', msg })),

      groupHeading('Layout'),
      ...layout.view(state.at('layout'), (msg) => send({ type: 'layout', msg })),

      groupHeading('Scrolling, panes & trees'),
      ...advanced.view(state.at('advanced'), (msg) => send({ type: 'advanced', msg })),

      groupHeading('Menus & command'),
      ...menus.view(state.at('menus'), (msg) => send({ type: 'menus', msg })),

      groupHeading('Media, dates & toasts'),
      ...media.view(state.at('media'), (msg) => send({ type: 'media', msg })),

      groupHeading('Overlays'),
      ...overlays.view(state.at('overlays'), (msg) => send({ type: 'overlays', msg })),
    ]),
  ],
})
