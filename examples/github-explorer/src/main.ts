/**
 * Client entry point.
 * Hydrates server-rendered HTML when present, otherwise mounts fresh.
 */
import { mountApp, hydrateApp } from '@llui/dom'
import type { State } from './types'
import { appDef, initialState } from './app'

const container = document.getElementById('app')!

// Check if server rendered HTML exists (SSR hydration path)
const serverStateEl = document.getElementById('__llui_state')
if (serverStateEl && container.children.length > 0) {
  const serverState = JSON.parse(serverStateEl.textContent!) as State
  hydrateApp(container, appDef, serverState)
} else {
  mountApp(container, appDef)
}
