/**
 * SSR entry point — renders the initial page to HTML string.
 */
import { initSsrDom } from '@llui/dom/ssr'
import { renderToString } from '@llui/dom'
import { appDef, initialState } from './app'

await initSsrDom()

export function render(url: string): { html: string; state: string } {
  const state = initialState(url)
  const html = renderToString(appDef, state)
  return {
    html,
    state: JSON.stringify(state),
  }
}
