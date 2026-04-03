import { component, mountApp, branch } from '@llui/dom'
import { handleEffects } from '@llui/effects'
import type { State, Msg, Effect } from './types'
import { initState, update } from './update'
import { routing } from './router'
import { header } from './views/header'
import { searchPage } from './views/search'
import { repoPage } from './views/repo'

const App = component<State, Msg, Effect>({
  name: 'GitHubExplorer',
  init: () => {
    const state = initState()
    const [s, effects] = update(state, { type: 'navigate', route: state.route })
    return [s, effects]
  },
  update,
  view: (_s, send) => [
    header(_s, send),

    ...routing.listener(send),

    ...branch<State, Msg>({
      on: (s) => s.route.page,
      cases: {
        search: (s, send) => searchPage(s, send),
        repo: (s, send) => repoPage(s, send),
        tree: (s, send) => repoPage(s, send),
      },
    }),
  ],
  onEffect: handleEffects<Effect, Msg>()
    .use(routing.handleEffect)
    .else((_effect, _send) => {
      // No app-specific effects to handle
    }),
})

mountApp(document.getElementById('app')!, App)
