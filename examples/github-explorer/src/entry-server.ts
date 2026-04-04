/**
 * SSR entry point — renders the initial page to HTML string.
 */
import { renderToString, initSsrDom } from '@llui/dom'
import { appDef, initialState } from './app'

// Set up DOM environment once (jsdom)
await initSsrDom()

export function render(url: string): { html: string; state: string } {
  const state = initialState(url)
  const html = renderToString(appDef, state)
  return {
    html,
    state: JSON.stringify(state),
  }
}
