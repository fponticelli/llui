/**
 * SSR entry point — fetches data server-side, then renders to HTML.
 */
import { renderToString } from '@llui/dom/ssr'
import { jsdomEnv } from '@llui/dom/ssr/jsdom'
import { resolveEffects } from '@llui/effects'
import { appDef, initialState } from './app'
import { update } from './update'
import type { State, Msg, Effect } from './types'

const env = await jsdomEnv()

export async function render(url: string): Promise<{ html: string; state: string }> {
  // 1. Parse URL → initial state + effects
  const state = initialState(url)
  const [routeState, effects] = update(state, { type: 'navigate', route: state.route })

  // 2. Execute HTTP effects server-side (fetch data before rendering)
  const loadedState = await resolveEffects<State, Msg, Effect>(routeState, effects, update)

  // 3. Render with fully-loaded state
  const html = renderToString(appDef, loadedState, env)

  return {
    html,
    state: JSON.stringify(loadedState),
  }
}
