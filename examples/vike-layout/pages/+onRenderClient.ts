import { createOnRenderClient } from '@llui/vike/client'
import type { ClientPageContext } from '@llui/vike/client'
import { AppLayout } from './Layout'
import { DashboardLayout } from './dashboard/Layout'

/**
 * Per-route layout chain resolver.
 *
 *   /                  → [AppLayout]           (home uses only the root layout)
 *   /settings          → [AppLayout]           (flat pages outside /dashboard)
 *   /dashboard/**      → [AppLayout, DashboardLayout]   (nested chain)
 *
 * The chain diff on each nav walks old and new chains in parallel.
 * Shared prefix stays mounted; divergent suffix tears down. So:
 *
 *   - Nav from /dashboard/reports to /dashboard/overview: only the Page
 *     is disposed and re-mounted. Both layouts stay alive, sidebar
 *     scroll and any dialogs stay in place.
 *   - Nav from /dashboard/overview to /settings: DashboardLayout and
 *     its page are both disposed; AppLayout stays alive.
 *   - Nav from / to /dashboard/overview: DashboardLayout mounts fresh
 *     inside the existing AppLayout slot; the home page is disposed.
 */
export const onRenderClient = createOnRenderClient({
  Layout: (pageContext: ClientPageContext) => {
    const path = (pageContext as unknown as { urlPathname?: string }).urlPathname ?? '/'
    if (path.startsWith('/dashboard')) return [AppLayout, DashboardLayout]
    return [AppLayout]
  },
  onMount: () => {
    // Per-render side effect — runs on every mount and nav. Good for
    // analytics, focus management, page-view tracking, etc.
  },
})
