import { component, mountApp, branch, flush } from '@llui/dom'
import { handleEffects } from '@llui/effects'
import type { State, Msg, Effect } from './types'
import { initState, update } from './update'
import { routing } from './router'
import { navbar } from './views/nav'
import { appFooter } from './views/footer'
import { homePage } from './views/home'
import { loginPage, registerPage } from './views/auth'
import { settingsPage } from './views/settings'
import { editorPage } from './views/editor'
import { articlePage } from './views/article'
import { profilePage } from './views/profile'

const App = component<State, Msg, Effect>({
  name: 'Conduit',
  init: () => {
    const state = initState()
    const [s, effects] = update(state, { type: 'navigate', route: state.route })
    return [s, effects]
  },
  update,
  view: (_s, send) => [
    navbar(_s, send),

    // URL change listener
    ...routing.listener(send),

    // Page routing via branch — cases receive (state, send)
    ...branch<State, Msg>({
      on: (s) => s.route.page,
      cases: {
        home: (s, send) => homePage(s, send),
        login: (s, send) => loginPage(s, send),
        register: (s, send) => registerPage(s, send),
        settings: (s, send) => settingsPage(s, send),
        editor: (s, send) => editorPage(s, send),
        article: (s, send) => articlePage(s, send),
        profile: (s, send) => profilePage(s, send),
      },
    }),

    appFooter(),
  ],
  onEffect: handleEffects<Effect>()
    .use(routing.handleEffect)
    .else((effect, send) => {
      switch (effect.type) {
        case 'saveUser':
          if ('user' in effect) localStorage.setItem('conduit-user', JSON.stringify(effect.user))
          break
        case 'clearUser':
          localStorage.removeItem('conduit-user')
          break
      }
    }),
})

mountApp(document.getElementById('app')!, App)
