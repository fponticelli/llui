/**
 * Shared app definition — used by both client and server entry points.
 */
import { component, branch } from '@llui/dom'
import { handleEffects } from '@llui/effects'
import type { State, Msg, Effect } from './types'
import { update } from './update'
import { router, routing } from './router'
import { header } from './views/header'
import { searchView } from './views/search'
import { repoPage } from './views/repo'

export const appDef = component<State, Msg, Effect>({
  name: 'GitHubExplorer',
  init: () => {
    const state = initialState()
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
        search: (s, send) => searchView(s, send),
        repo: (s, send) => repoPage(s, send),
        tree: (s, send) => repoPage(s, send),
      },
    }),
  ],
  onEffect: handleEffects<Effect, Msg>()
    .use(routing.handleEffect)
    .else(() => {}),
})

export function initialState(url?: string): State {
  const input = url ?? (typeof location !== 'undefined' ? location.pathname + location.search : '/')
  const route = router.match(input)
  return {
    route,
    query: route.page === 'search' ? route.q : '',
  }
}
