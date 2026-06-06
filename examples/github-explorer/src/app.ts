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
    const initial = initialState()
    const [s, effects] = update(initial, { type: 'navigate', route: initial.route })
    return [s, effects]
  },
  update,
  view: ({ state, send }) => [
    header(state.at('query'), send),

    ...routing.listener(send),

    branch(state.at('route').at('page'), {
      search: () => searchView(state.at('route'), send),
      // routing.link needs literal owner/name for href. Read from
      // location.pathname which is current when the branch re-enters
      // (routing.handleEffect pushes state before navigate resolves).
      repo: () => repoPage(state.at('route'), router.match(location.pathname), send),
      tree: () => repoPage(state.at('route'), router.match(location.pathname), send),
    }),
  ],
  onEffect: (() => {
    // handleEffects yields a ctx-style handler ({ effect, send, signal }); the
    // signal runtime calls onEffect as (effect, api). Bridge the two, supplying
    // a long-lived AbortSignal (cancel/debounce manage their own controllers).
    const handler = handleEffects<Effect, Msg>()
      .use(routing.handleEffect)
      .else(({ effect }) => {
        console.warn('[github-explorer] unhandled effect:', effect)
      })
    const lifecycle = new AbortController()
    return (effect: Effect, api: { send: (msg: Msg) => void }) => {
      handler({ effect, send: api.send, signal: lifecycle.signal })
    }
  })(),
})

export function initialState(url?: string): State {
  const input = url ?? (typeof location !== 'undefined' ? location.pathname + location.search : '/')
  const route = router.match(input)
  return {
    route,
    query: route.page === 'search' ? route.q : '',
  }
}
