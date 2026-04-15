import { component, div, aside, section, nav, a } from '@llui/dom'
import { pageSlot } from '@llui/vike/client'

type DashboardState = { lastVisited: string | null }
type DashboardMsg = { type: 'visit'; route: string }

/**
 * Nested dashboard layout. Mounted when the route's chain is
 * `[AppLayout, DashboardLayout]` (see +onRenderClient.ts's Layout
 * resolver). Adds a sidebar to the dashboard routes but preserves the
 * root header above.
 *
 * This layout is _inside_ AppLayout's slot on the dashboard routes and
 * above the page's slot on its own — so the DOM nesting is:
 *
 *   AppLayout  → <main class="app-main">
 *     DashboardLayout  → <div class="dashboard">  (our root)
 *       ... <aside class="dashboard-sidebar"> ...
 *       DashboardPage  → <section class="dashboard-content">  (our slot)
 *
 * Navigating between /dashboard/overview and /dashboard/reports
 * disposes only the innermost Page — both layouts stay alive.
 */
export const DashboardLayout = component<DashboardState, DashboardMsg, never>({
  name: 'DashboardLayout',
  init: () => [{ lastVisited: null }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'visit':
        return [{ lastVisited: msg.route }, []]
    }
  },
  view: ({ text }) => [
    div({ class: 'dashboard' }, [
      aside({ class: 'dashboard-sidebar' }, [
        div({ class: 'dashboard-title' }, [text('Dashboard')]),
        nav({ class: 'dashboard-nav' }, [
          a({ href: '/dashboard/overview', class: 'dashboard-nav-link' }, [text('Overview')]),
          a({ href: '/dashboard/reports', class: 'dashboard-nav-link' }, [text('Reports')]),
        ]),
        div({ class: 'dashboard-footer' }, [
          div({ class: 'dashboard-footer-label' }, [text('Last visited:')]),
          div({ class: 'dashboard-footer-value' }, [text((s) => s.lastVisited ?? '(none yet)')]),
        ]),
      ]),
      section({ class: 'dashboard-content' }, [pageSlot()]),
    ]),
  ],
})
