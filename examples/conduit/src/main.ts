import { component, mountApp, div, text, flush, onMount } from '@llui/dom'
import { handleEffects } from '@llui/effects'
import type { State, Msg, Effect } from './types'
import { initState, update, parseHash } from './update'
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
  view: (s, send) => [
    navbar(s, send),
    ...pageContent(s, send),
    appFooter(),
    // Hash routing — listen for URL changes
    (() => {
      onMount(() => {
        const handler = () => {
          send({ type: 'navigate', route: parseHash(location.hash) })
          flush()
        }
        window.addEventListener('hashchange', handler)
        return () => window.removeEventListener('hashchange', handler)
      })
      return document.createComment('hashchange')
    })(),
  ],
  onEffect: handleEffects<Effect>().else((effect, send) => {
    switch (effect.type) {
      case 'navigateTo':
        location.hash = effect.hash
        break
      case 'saveUser':
        localStorage.setItem('conduit-user', JSON.stringify(effect.user))
        break
      case 'clearUser':
        localStorage.removeItem('conduit-user')
        break
    }
  }),
})

function pageContent(s: State, send: (msg: Msg) => void): Node[] {
  switch (s.route.page) {
    case 'home': return homePage(s, send)
    case 'login': return loginPage(s, send)
    case 'register': return registerPage(s, send)
    case 'settings': return settingsPage(s, send)
    case 'editor': return editorPage(s, send)
    case 'article': return articlePage(s, send)
    case 'profile': return profilePage(s, send)
  }
}

mountApp(document.getElementById('app')!, App)
