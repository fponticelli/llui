import {
  component,
  mountApp,
  div,
  a,
  span,
  h2,
  nav,
  text,
  branch,
  onMount,
} from '@llui/core'
import { useMachine } from '@llui/zag'
import { VanillaMachine } from '@zag-js/vanilla'
import * as dialog from '@zag-js/dialog'
import * as tabs from '@zag-js/tabs'
import * as accordion from '@zag-js/accordion'
import * as tooltip from '@zag-js/tooltip'
import * as switchMachine from '@zag-js/switch'
import * as checkbox from '@zag-js/checkbox'
import * as slider from '@zag-js/slider'
import * as progress from '@zag-js/progress'

import { tabsPage } from './pages/tabs'
import { accordionPage } from './pages/accordion'
import { dialogPage } from './pages/dialog'
import { tooltipPage } from './pages/tooltip'
import { switchPage } from './pages/switch'
import { checkboxPage } from './pages/checkbox'
import { sliderPage } from './pages/slider'
import { progressPage } from './pages/progress'

type Route = 'tabs' | 'accordion' | 'dialog' | 'tooltip' | 'switch' | 'checkbox' | 'slider' | 'progress'

const routes: { id: Route; icon: string; label: string }[] = [
  { id: 'tabs', icon: '📑', label: 'Tabs' },
  { id: 'accordion', icon: '🪗', label: 'Accordion' },
  { id: 'dialog', icon: '💬', label: 'Dialog' },
  { id: 'tooltip', icon: '💡', label: 'Tooltip' },
  { id: 'switch', icon: '🔘', label: 'Switch' },
  { id: 'checkbox', icon: '☑️', label: 'Checkbox' },
  { id: 'slider', icon: '🎚️', label: 'Slider' },
  { id: 'progress', icon: '📊', label: 'Progress' },
]

type State = { route: Route }
type Msg = { type: 'navigate'; route: Route }

function routeFromHash(): Route {
  const hash = location.hash.slice(1) as Route
  if (routes.some((r) => r.id === hash)) return hash
  return 'tabs'
}

const App = component<State, Msg, never>({
  name: 'App',
  init: () => [{ route: routeFromHash() }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'navigate':
        history.replaceState(null, '', `#${msg.route}`)
        return [{ ...state, route: msg.route }, []]
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
          div({ class: 'sidebar-brand' }, [
            div({ class: 'logo' }, [text('L')]),
            span({ class: 'name' }, [text('LLui + Zag')]),
          ]),
          nav({ class: 'sidebar-nav' },
            routes.map((r) =>
              a({
                class: (s: State) => s.route === r.id ? 'active' : '',
                onClick: () => send({ type: 'navigate', route: r.id }),
                role: 'button',
                tabIndex: '0',
              }, [span({ class: 'icon' }, [text(r.icon)]), text(r.label)]),
            ),
          ),
        ]),
        div({ class: 'main' }, [
          ...branch<State>({
            on: (s) => s.route,
            cases: {
              tabs: () => tabsPage(VanillaMachine, tabs),
              accordion: () => accordionPage(VanillaMachine, accordion),
              dialog: () => dialogPage(VanillaMachine, dialog),
              tooltip: () => tooltipPage(VanillaMachine, tooltip),
              switch: () => switchPage(VanillaMachine, switchMachine),
              checkbox: () => checkboxPage(VanillaMachine, checkbox),
              slider: () => sliderPage(VanillaMachine, slider),
              progress: () => progressPage(VanillaMachine, progress),
            },
          }),
        ]),
      ]),
    ]
  },
})

mountApp(document.getElementById('app')!, App)
