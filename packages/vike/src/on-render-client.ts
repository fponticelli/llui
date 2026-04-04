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

export async function onRenderClient(pageContext: ClientPageContext): Promise<void> {
  const { Page } = pageContext
  const container = document.getElementById('app')!

  if (pageContext.isHydration) {
    const serverState = window.__LLUI_STATE__
    hydrateApp(container, Page, serverState)
  } else {
    mountApp(container, Page, pageContext.data)
  }
}
