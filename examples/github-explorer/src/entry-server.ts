/**
 * SSR entry point — fetches data server-side, then serializes state.
 *
 * NOTE: this app now uses the signal runtime (@llui/dom/signals), which has
 * no server-side renderer yet — there is no signal equivalent of the legacy
 * `renderToString`/`hydrateApp`. So the server pre-loads route data and ships
 * the serialized state, but emits an empty app shell; the client mounts fresh
 * (see src/main.ts). When a signal SSR primitive lands, render `appDef` here
 * and restore client-side hydration.
 */
import { resolveEffects } from '@llui/effects'
import { initialState } from './app'
import { update } from './update'
import type { State, Msg, Effect } from './types'

export async function render(url: string): Promise<{ html: string; state: string }> {
  // 1. Parse URL → initial state + effects
  const state = initialState(url)
  const [routeState, effects] = update(state, { type: 'navigate', route: state.route })

  // 2. Execute HTTP effects server-side (fetch data before serializing)
  const loadedState = await resolveEffects<State, Msg, Effect>(routeState, effects, update)

  return {
    html: '',
    state: JSON.stringify(loadedState),
  }
}
