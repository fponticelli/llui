import { describe, it, expect, beforeEach } from 'vitest'
import { component, div, header, main, text, provide, useContext, createContext } from '@llui/dom'
import type { ComponentDef } from '@llui/dom'
import { createOnRenderClient, pageSlot, _resetChainForTest } from '../src/on-render-client'
import { createOnRenderHtml } from '../src/on-render-html'

// Persistent-layout regression coverage. Asserts that:
//
//   1. The layout's DOM node identity is preserved across a client nav
//      — the whole point of the feature.
//   2. The page's DOM node identity changes on nav (page was re-mounted)
//      while surrounding layout DOM is untouched.
//   3. Contexts provided by the layout flow through the slot into the
//      page — `useContext` inside the page reads a layout-provided
//      dispatcher closure. This is how patterns like a layout-owned
//      toast system work.
//   4. Server + client renders produce a matching chain-aware hydration
//      envelope shape.
//   5. Nested layouts (3-layer chain) preserve outer layers while
//      navigating the inner page.

// ──── Fixtures ────

type LayoutState = { session: string }
type LayoutMsg = { type: 'login' } | { type: 'logout' }

// Context exposed by the layout for the page to call into.
// The value is a dispatcher object whose methods close over the layout's
// send, so the page can trigger layout state changes without touching
// the layout's internals.
interface AuthDispatchers {
  login: () => void
  logout: () => void
  getSession: () => string
}

const AuthContext = createContext<AuthDispatchers>(undefined, 'AuthContext')

function makeAppLayout(): ComponentDef<LayoutState, LayoutMsg, never> {
  return {
    name: 'AppLayout',
    init: () => [{ session: 'anonymous' }, []],
    update: (state, msg) => {
      switch (msg.type) {
        case 'login':
          return [{ session: 'alice' }, []]
        case 'logout':
          return [{ session: 'anonymous' }, []]
      }
    },
    view: ({ send }) => [
      div({ class: 'app-shell' }, [
        header({ class: 'app-header' }, [text('Header')]),
        ...provide(
          AuthContext,
          (_s: LayoutState): AuthDispatchers => ({
            login: () => send({ type: 'login' }),
            logout: () => send({ type: 'logout' }),
            getSession: () => 'DELIVERED-BY-CONTEXT',
          }),
          () => [main({ class: 'app-main' }, [pageSlot()])],
        ),
      ]),
    ],
  }
}

// Inner layout for the 3-layer nested test. Wraps a page with its own
// shell, declares a slot of its own.
function makeDashboardLayout(): ComponentDef<{ active: string }, never, never> {
  return {
    name: 'DashboardLayout',
    init: () => [{ active: 'reports' }, []],
    update: (s) => [s, []],
    view: () => [
      div({ class: 'dashboard' }, [
        div({ class: 'dashboard-sidebar' }, [text('Sidebar')]),
        div({ class: 'dashboard-content' }, [pageSlot()]),
      ]),
    ],
  }
}

// Page A — reads the AuthContext and emits its resolved value into the
// DOM so tests can assert the context value reached the page.
function makeReportsPage(): ComponentDef<{ view: string }, never, never> {
  return {
    name: 'ReportsPage',
    init: () => [{ view: 'summary' }, []],
    update: (s) => [s, []],
    view: () => {
      const auth = useContext(AuthContext)
      return [
        div({ class: 'reports-page' }, [
          div({ class: 'ctx-probe' }, [text(() => auth({} as LayoutState).getSession())]),
          div({ class: 'page-name' }, [text('Reports')]),
        ]),
      ]
    },
  }
}

// Page B — distinct from ReportsPage so nav between them is a real swap.
function makeSettingsPage(): ComponentDef<{ tab: string }, never, never> {
  return {
    name: 'SettingsPage',
    init: () => [{ tab: 'general' }, []],
    update: (s) => [s, []],
    view: () => [
      div({ class: 'settings-page' }, [div({ class: 'page-name' }, [text('Settings')])]),
    ],
  }
}

// ──── Tests ────

describe('persistent layouts — client mount + nav', () => {
  beforeEach(() => {
    _resetChainForTest()
    document.body.innerHTML = ''
    const container = document.createElement('div')
    container.id = 'app'
    document.body.appendChild(container)
  })

  it('preserves the layout DOM node identity across client navigation', async () => {
    const AppLayout = makeAppLayout()
    const ReportsPage = makeReportsPage()
    const SettingsPage = makeSettingsPage()

    const render = createOnRenderClient({ Layout: AppLayout })

    await render({ Page: ReportsPage, isHydration: false })

    const layoutHeaderBefore = document.querySelector('.app-header')
    const reportsPageEl = document.querySelector('.reports-page')
    expect(layoutHeaderBefore).not.toBeNull()
    expect(reportsPageEl).not.toBeNull()

    await render({ Page: SettingsPage, isHydration: false })

    const layoutHeaderAfter = document.querySelector('.app-header')
    const settingsPageEl = document.querySelector('.settings-page')
    const reportsPageGone = document.querySelector('.reports-page')

    // Layout DOM node is the SAME object — no re-mount.
    expect(layoutHeaderAfter).toBe(layoutHeaderBefore)
    // Old page is gone, new page is present.
    expect(reportsPageGone).toBeNull()
    expect(settingsPageEl).not.toBeNull()
  })

  it('flows context from the layout into the page via useContext', async () => {
    const AppLayout = makeAppLayout()
    const ReportsPage = makeReportsPage()
    const render = createOnRenderClient({ Layout: AppLayout })

    await render({ Page: ReportsPage, isHydration: false })

    // The page reads AuthContext and emits its resolved value into .ctx-probe.
    // If context didn't cross the slot boundary, useContext would throw
    // (no provider found) before the page mounted.
    const probe = document.querySelector('.ctx-probe')
    expect(probe).not.toBeNull()
    expect(probe!.textContent).toBe('DELIVERED-BY-CONTEXT')
  })

  it('disposes the page on nav but keeps the layout alive', async () => {
    const AppLayout = makeAppLayout()
    const ReportsPage = makeReportsPage()
    const SettingsPage = makeSettingsPage()

    let layoutViewCalls = 0
    // Wrap the layout's view to count invocations — the layout should
    // mount exactly once across two navs.
    const origLayoutView = AppLayout.view
    AppLayout.view = (h) => {
      layoutViewCalls++
      return origLayoutView(h)
    }

    const render = createOnRenderClient({ Layout: AppLayout })
    await render({ Page: ReportsPage, isHydration: false })
    expect(layoutViewCalls).toBe(1)

    await render({ Page: SettingsPage, isHydration: false })
    expect(layoutViewCalls, 'layout should not re-render on page nav').toBe(1)
  })
})

describe('persistent layouts — nested layout chain', () => {
  beforeEach(() => {
    _resetChainForTest()
    document.body.innerHTML = ''
    const container = document.createElement('div')
    container.id = 'app'
    document.body.appendChild(container)
  })

  it('mounts 3-layer chain (AppLayout → DashboardLayout → Page)', async () => {
    const AppLayout = makeAppLayout()
    const DashboardLayout = makeDashboardLayout()
    const ReportsPage = makeReportsPage()

    const render = createOnRenderClient({
      Layout: [AppLayout, DashboardLayout],
    })

    await render({ Page: ReportsPage, isHydration: false })

    // All three layers are in the DOM.
    expect(document.querySelector('.app-shell')).not.toBeNull()
    expect(document.querySelector('.app-header')).not.toBeNull()
    expect(document.querySelector('.dashboard')).not.toBeNull()
    expect(document.querySelector('.dashboard-sidebar')).not.toBeNull()
    expect(document.querySelector('.reports-page')).not.toBeNull()

    // DOM nesting: app-main > dashboard > dashboard-content > reports-page
    const appMain = document.querySelector('.app-main')!
    const dashboard = appMain.querySelector('.dashboard')!
    const dashboardContent = dashboard.querySelector('.dashboard-content')!
    const reports = dashboardContent.querySelector('.reports-page')!
    expect(reports).not.toBeNull()
  })

  it('preserves outer AND inner layout across page-only nav', async () => {
    const AppLayout = makeAppLayout()
    const DashboardLayout = makeDashboardLayout()
    const ReportsPage = makeReportsPage()
    const SettingsPage = makeSettingsPage()

    const render = createOnRenderClient({
      Layout: [AppLayout, DashboardLayout],
    })

    await render({ Page: ReportsPage, isHydration: false })
    const appHeader = document.querySelector('.app-header')
    const dashboardSidebar = document.querySelector('.dashboard-sidebar')

    await render({ Page: SettingsPage, isHydration: false })

    // Both outer layers are the same DOM nodes.
    expect(document.querySelector('.app-header')).toBe(appHeader)
    expect(document.querySelector('.dashboard-sidebar')).toBe(dashboardSidebar)
    // Old page gone, new page present.
    expect(document.querySelector('.reports-page')).toBeNull()
    expect(document.querySelector('.settings-page')).not.toBeNull()
  })

  it('disposes inner layout when the chain diverges at an outer layer', async () => {
    const AppLayout = makeAppLayout()
    const DashboardLayout = makeDashboardLayout()
    const ReportsPage = makeReportsPage()
    const SettingsPage = makeSettingsPage()

    // Custom resolver — routes with a dashboard path get the nested
    // chain, others get just the app layout.
    const render = createOnRenderClient({
      Layout: (ctx) => {
        const path = (ctx as unknown as { path?: string }).path
        return path === '/dashboard' ? [AppLayout, DashboardLayout] : [AppLayout]
      },
    })

    // Start on a dashboard page (full 3-layer chain)
    await render({
      Page: ReportsPage,
      isHydration: false,
      ...{ path: '/dashboard' },
    } as Parameters<typeof render>[0])
    expect(document.querySelector('.dashboard')).not.toBeNull()
    const appHeader = document.querySelector('.app-header')

    // Nav to a non-dashboard page — chain collapses to [AppLayout]
    await render({
      Page: SettingsPage,
      isHydration: false,
      ...{ path: '/settings' },
    } as Parameters<typeof render>[0])

    // Outer AppLayout stays alive.
    expect(document.querySelector('.app-header')).toBe(appHeader)
    // Inner DashboardLayout is gone.
    expect(document.querySelector('.dashboard')).toBeNull()
    expect(document.querySelector('.dashboard-sidebar')).toBeNull()
    // Settings page mounted directly into the AppLayout slot.
    expect(document.querySelector('.settings-page')).not.toBeNull()
  })
})

describe('persistent layouts — SSR chain render', () => {
  it('emits a chain-aware hydration envelope with per-layer state', async () => {
    const AppLayout = makeAppLayout()
    const ReportsPage = makeReportsPage()

    const render = createOnRenderHtml({ Layout: AppLayout })
    const result = await render({ Page: ReportsPage })

    expect(result.pageContext.lluiState).toEqual({
      layouts: [{ name: 'AppLayout', state: { session: 'anonymous' } }],
      page: { name: 'ReportsPage', state: { view: 'summary' } },
    })
  })

  it('renders nested layout chain into composed HTML', async () => {
    const AppLayout = makeAppLayout()
    const DashboardLayout = makeDashboardLayout()
    const ReportsPage = makeReportsPage()

    const render = createOnRenderHtml({
      Layout: [AppLayout, DashboardLayout],
    })
    const result = await render({ Page: ReportsPage })

    const html =
      typeof result.documentHtml === 'string' ? result.documentHtml : result.documentHtml._escaped

    // All three layers appear in source order.
    expect(html).toContain('app-shell')
    expect(html).toContain('dashboard')
    expect(html).toContain('reports-page')

    // Envelope carries all three states, layouts array has two entries
    // (inner is a layout, page is tracked separately).
    expect(result.pageContext.lluiState).toEqual({
      layouts: [
        { name: 'AppLayout', state: { session: 'anonymous' } },
        { name: 'DashboardLayout', state: { active: 'reports' } },
      ],
      page: { name: 'ReportsPage', state: { view: 'summary' } },
    })
  })

  it('throws when a non-innermost layer forgets to call pageSlot()', async () => {
    const BadLayout: ComponentDef<{}, never, never> = {
      name: 'BadLayout',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: () => [div({ class: 'bad' }, [text('no slot here')])],
    }
    const ReportsPage = makeReportsPage()

    const render = createOnRenderHtml({ Layout: BadLayout })
    await expect(render({ Page: ReportsPage })).rejects.toThrow(/did not call pageSlot/)
  })

  it('throws when the innermost page calls pageSlot()', async () => {
    const BadPage: ComponentDef<{}, never, never> = {
      name: 'BadPage',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: () => [div({ class: 'bad-page' }, [pageSlot()])],
    }
    const AppLayout = makeAppLayout()

    const render = createOnRenderHtml({ Layout: AppLayout })
    await expect(render({ Page: BadPage })).rejects.toThrow(/innermost component/)
  })
})
