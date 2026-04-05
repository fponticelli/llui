/**
 * Shared app definition — used by both client and server entry points.
 */
import { component } from '@llui/dom'
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
  view: (send, h) => {
    const { branch } = h
    return [
      header(send),

      ...routing.listener(send),

      // TODO(view-signature-migration): repoPage reads state.route at mount
      // time for routing.link's literal owner/name params. Needs refactoring
      // to use accessors. For now, snapshot from init state at module scope.
      ...branch({
        on: (s) => s.route.page,
        cases: {
          search: (send) => searchView(send),
          repo: (send) => repoPage(h, initialState(), send),
          tree: (send) => repoPage(h, initialState(), send),
        },
      }),
    ]
  },
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
