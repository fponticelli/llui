import { div, text, type Send, type Signal, type Mountable } from '@llui/dom'
import * as switchC from '@llui/components/switch'
import * as tabs from '@llui/components/tabs'
import * as accordion from '@llui/components/accordion'
import { Switch, SwitchThumb } from '../components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '../components/ui/accordion'
import { Label } from '../components/ui/label'
import { row, section } from './shared'

export interface State {
  wifi: switchC.SwitchState
  locked: switchC.SwitchState
  tabs: tabs.TabsState
  faq: accordion.AccordionState
}

export type Msg =
  | { type: 'wifi'; msg: switchC.SwitchMsg }
  | { type: 'locked'; msg: switchC.SwitchMsg }
  | { type: 'tabs'; msg: tabs.TabsMsg }
  | { type: 'faq'; msg: accordion.AccordionMsg }

const TABS = [
  { value: 'account', label: 'Account', body: 'Change your name and email here.' },
  { value: 'password', label: 'Password', body: 'Rotate your password here.' },
  { value: 'billing', label: 'Billing', body: 'Nothing to see — this is a demo.' },
]

const FAQ = [
  { value: 'own', q: 'Do I own this code?', a: 'Yes. llui add copies it into your repo.' },
  { value: 'update', q: 'What about updates?', a: 'Re-run llui add --overwrite, or diff by hand.' },
  {
    value: 'state',
    q: 'Where does the state live?',
    a: '@llui/components. This is only the skin.',
  },
]

export const init = (): [State, never[]] => [
  {
    wifi: switchC.init({ checked: true }),
    locked: switchC.init({ disabled: true }),
    tabs: tabs.init({ items: TABS.map((t) => t.value), value: 'account' }),
    faq: accordion.init({ items: FAQ.map((f) => f.value), value: ['own'] }),
  },
  [],
]

export function update(state: State, msg: Msg): [State, never[]] {
  switch (msg.type) {
    case 'wifi':
      return [{ ...state, wifi: switchC.update(state.wifi, msg.msg)[0] }, []]
    case 'locked':
      return [{ ...state, locked: switchC.update(state.locked, msg.msg)[0] }, []]
    case 'tabs':
      return [{ ...state, tabs: tabs.update(state.tabs, msg.msg)[0] }, []]
    case 'faq':
      return [{ ...state, faq: accordion.update(state.faq, msg.msg)[0] }, []]
  }
}

export function view(state: Signal<State>, send: Send<Msg>): Mountable {
  const wifi = switchC.connect(state.at('wifi'), (m) => send({ type: 'wifi', msg: m }))
  const locked = switchC.connect(state.at('locked'), (m) => send({ type: 'locked', msg: m }))
  const tabParts = tabs.connect(state.at('tabs'), (m) => send({ type: 'tabs', msg: m }), {
    id: 'demo-tabs',
  })
  const faq = accordion.connect(state.at('faq'), (m) => send({ type: 'faq', msg: m }), {
    id: 'demo-faq',
  })

  return section(
    'Switch, Tabs & Accordion',
    'Skins only. Every visual state below is driven by the data-state / data-disabled attributes the part bags already emit — no view here reads state to build a class.',
    [
      row('Switch', [
        div({ class: 'flex items-center gap-2' }, [
          Switch({ ...wifi.root, id: 'wifi' }, [SwitchThumb({ ...wifi.thumb })]),
          Label({ for: 'wifi' }, [text('Wi-Fi')]),
        ]),
        div({ class: 'flex items-center gap-2' }, [
          Switch({ ...locked.root, id: 'locked' }, [SwitchThumb({ ...locked.thumb })]),
          Label({ for: 'locked', class: 'text-muted-foreground' }, [text('Disabled')]),
        ]),
      ]),

      Tabs({ ...tabParts.root }, [
        TabsList(
          { ...tabParts.list },
          TABS.map((t) => TabsTrigger({ ...tabParts.item(t.value).trigger }, [text(t.label)])),
        ),
        ...TABS.map((t) =>
          TabsContent({ ...tabParts.item(t.value).panel, class: 'text-muted-foreground text-sm' }, [
            text(t.body),
          ]),
        ),
      ]),

      Accordion(
        { ...faq.root },
        FAQ.map((f) => {
          // `item(value)` returns a BAG OF BAGS — `{ trigger, content, item }`.
          // Spreading the wrapper itself emits `trigger="[object Object]"` and
          // silently drops role, id and every data attribute.
          const parts = faq.item(f.value)
          return AccordionItem({ ...parts.item }, [
            AccordionTrigger({ ...parts.trigger }, [text(f.q)]),
            AccordionContent({ ...parts.content }, [text(f.a)]),
          ])
        }),
      ),
    ],
  )
}
