import { hydrateApp, mountApp } from '@llui/dom'
import type { ComponentDef } from '@llui/dom'

declare global {
  interface Window {
    __LLUI_STATE__?: unknown
  }
}

export interface ClientPageContext {
  Page: ComponentDef<unknown, unknown, unknown, unknown>
  data?: unknown
  isHydration?: boolean
}

export interface RenderClientOptions {
  /** CSS selector for the mount container. Default: '#app' */
  container?: string
  /** Called after mount or hydration completes */
  onMount?: () => void
}

/**
 * Default onRenderClient hook.
 * Hydrates if isHydration is true, otherwise mounts fresh.
 */
export async function onRenderClient(pageContext: ClientPageContext): Promise<void> {
  renderClient(pageContext, {})
}

/**
 * Factory to create a customized onRenderClient hook.
 *
 * ```typescript
 * // pages/+onRenderClient.ts
 * import { createOnRenderClient } from '@llui/vike'
 *
 * export const onRenderClient = createOnRenderClient({
 *   container: '#root',
 *   onMount: () => console.log('Page ready'),
 * })
 * ```
 */
export function createOnRenderClient(
  options: RenderClientOptions,
): (pageContext: ClientPageContext) => Promise<void> {
  return (pageContext) => renderClient(pageContext, options)
}

async function renderClient(
  pageContext: ClientPageContext,
  options: RenderClientOptions,
): Promise<void> {
  const { Page } = pageContext
  const selector = options.container ?? '#app'
  const container = document.querySelector(selector)

  if (!container) {
    throw new Error(`@llui/vike: container "${selector}" not found in DOM`)
  }

  if (pageContext.isHydration) {
    const serverState = window.__LLUI_STATE__
    hydrateApp(container as HTMLElement, Page, serverState)
  } else {
    mountApp(container as HTMLElement, Page, pageContext.data)
  }

  options.onMount?.()
}
