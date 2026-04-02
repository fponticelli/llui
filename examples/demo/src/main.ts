import {
  component,
  mountApp,
  div,
  a,
  h2,
  text,
  branch,
  onMount,
} from '@llui/core'
import { dashboardView, type DashboardSlice, type DashboardMsg, dashboardUpdate } from './pages/dashboard'
import { contactsView, contactsUpdate, type ContactsSlice, type ContactsMsg, initialContacts } from './pages/contacts'
import { showcaseView } from './pages/showcase'

type Route = 'dashboard' | 'contacts' | 'showcase'

type State = {
  route: Route
  dashboard: DashboardSlice
  contacts: ContactsSlice
}

type Msg =
  | { type: 'navigate'; route: Route }
  | { type: 'dashboard'; msg: DashboardMsg }
  | { type: 'contacts'; msg: ContactsMsg }

function routeFromHash(): Route {
  const hash = location.hash.slice(1)
  if (hash === 'contacts' || hash === 'showcase') return hash
  return 'dashboard'
}

const App = component<State, Msg, never>({
  name: 'App',
  init: () => [
    {
      route: routeFromHash(),
      dashboard: { totalContacts: 12, activeDeals: 5, revenue: 48200 },
      contacts: { items: initialContacts, search: '', editingId: null, dialogOpen: false, form: { name: '', email: '', company: '', tag: 'active' } },
    },
    [],
  ],
  update: (state, msg) => {
    switch (msg.type) {
      case 'navigate':
        history.replaceState(null, '', `#${msg.route}`)
        return [{ ...state, route: msg.route }, []]
      case 'dashboard':
        return [{ ...state, dashboard: dashboardUpdate(state.dashboard, msg.msg) }, []]
      case 'contacts':
        return [{ ...state, contacts: contactsUpdate(state.contacts, msg.msg) }, []]
    }
  },
  view: (_state, send) => {
    onMount(() => {
      const handler = () => send({ type: 'navigate', route: routeFromHash() })
      window.addEventListener('hashchange', handler)
      return () => window.removeEventListener('hashchange', handler)
    })

    return [
      div({ class: 'app' }, [
        div({ class: 'sidebar' }, [
          div({ class: 'sidebar' }, [
            a({
              class: (s: State) => s.route === 'dashboard' ? 'active' : '',
              onClick: () => send({ type: 'navigate', route: 'dashboard' }),
              role: 'button',
              tabIndex: '0',
            }, [text('📊 Dashboard')]),
            a({
              class: (s: State) => s.route === 'contacts' ? 'active' : '',
              onClick: () => send({ type: 'navigate', route: 'contacts' }),
              role: 'button',
              tabIndex: '0',
            }, [text('👥 Contacts')]),
            a({
              class: (s: State) => s.route === 'showcase' ? 'active' : '',
              onClick: () => send({ type: 'navigate', route: 'showcase' }),
              role: 'button',
              tabIndex: '0',
            }, [text('🧩 Components')]),
          ]),
        ]),
        div({ class: 'main' }, [
          ...branch<State>({
            on: (s) => s.route,
            cases: {
              dashboard: () => {
                return [
                  h2({}, [text('Dashboard')]),
                  ...dashboardView(
                    { dashboard: (s: State) => s.dashboard },
                    (msg) => send({ type: 'dashboard', msg }),
                  ),
                ]
              },
              contacts: () => {
                return [
                  h2({}, [text('Contacts')]),
                  ...contactsView(
                    {
                      contacts: (s: State) => s.contacts,
                    },
                    (msg) => send({ type: 'contacts', msg }),
                  ),
                ]
              },
              showcase: () => {
                return [
                  h2({}, [text('Component Showcase')]),
                  ...showcaseView(),
                ]
              },
            },
          }),
        ]),
      ]),
    ]
  },
})

mountApp(document.getElementById('app')!, App)
