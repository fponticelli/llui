import { div, text, type Mountable, type Send, type Signal } from '@llui/dom'
import * as tabsC from '@llui/components/tabs'
import * as accordionC from '@llui/components/accordion'
import * as collapsibleC from '@llui/components/collapsible'
import * as toolbarC from '@llui/components/toolbar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '../components/ui/accordion'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible'
import { Toolbar, ToolbarGroup, ToolbarSeparator } from '../components/ui/toolbar'
import { Button } from '../components/ui/button'
import { Kbd } from '../components/ui/kbd'
import { section } from './shared'

export interface State {
  tabs: tabsC.TabsState
  faq: accordionC.AccordionState
  details: collapsibleC.CollapsibleState
  toolbar: toolbarC.ToolbarState
}

export type Msg =
  | { type: 'tabs'; msg: tabsC.TabsMsg }
  | { type: 'faq'; msg: accordionC.AccordionMsg }
  | { type: 'details'; msg: collapsibleC.CollapsibleMsg }
  | { type: 'toolbar'; msg: toolbarC.ToolbarMsg }

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

const TOOLS = ['bold', 'italic', 'underline']

export const init = (): [State, never[]] => [
  {
    tabs: tabsC.init({ items: TABS.map((t) => t.value), value: 'account' }),
    faq: accordionC.init({ items: FAQ.map((f) => f.value), value: ['own'] }),
    details: collapsibleC.init({ open: false }),
    toolbar: toolbarC.init({ items: TOOLS }),
  },
  [],
]

export function update(state: State, msg: Msg): [State, never[]] {
  switch (msg.type) {
    case 'tabs':
      return [{ ...state, tabs: tabsC.update(state.tabs, msg.msg)[0] }, []]
    case 'faq':
      return [{ ...state, faq: accordionC.update(state.faq, msg.msg)[0] }, []]
    case 'details':
      return [{ ...state, details: collapsibleC.update(state.details, msg.msg)[0] }, []]
    case 'toolbar':
      return [{ ...state, toolbar: toolbarC.update(state.toolbar, msg.msg)[0] }, []]
  }
}

export function view(state: Signal<State>, send: Send<Msg>): readonly Mountable[] {
  const tabs = tabsC.connect(state.at('tabs'), (m) => send({ type: 'tabs', msg: m }), {
    id: 'demo-tabs',
  })
  const faq = accordionC.connect(state.at('faq'), (m) => send({ type: 'faq', msg: m }), {
    id: 'demo-faq',
  })
  const details = collapsibleC.connect(
    state.at('details'),
    (m) => send({ type: 'details', msg: m }),
    { id: 'demo-collapsible' },
  )
  const toolbar = toolbarC.connect(state.at('toolbar'), (m) => send({ type: 'toolbar', msg: m }), {
    id: 'demo-toolbar',
  })

  return [
    section('Tabs, Accordion & Collapsible', 'Disclosure patterns.', [
      Tabs({ ...tabs.root }, [
        TabsList(
          { ...tabs.list },
          TABS.map((t) => TabsTrigger({ ...tabs.item(t.value).trigger }, [text(t.label)])),
        ),
        ...TABS.map((t) =>
          TabsContent({ ...tabs.item(t.value).panel, class: 'text-sm text-muted-foreground' }, [
            text(t.body),
          ]),
        ),
      ]),

      Accordion(
        { ...faq.root },
        FAQ.map((f) => {
          // `item(value)` returns a BAG OF BAGS — `{ trigger, content, item }`.
          // Spreading the wrapper emits `trigger="[object Object]"` and drops
          // every real attribute.
          const parts = faq.item(f.value)
          return AccordionItem({ ...parts.item }, [
            AccordionTrigger({ ...parts.trigger }, [text(f.q)]),
            AccordionContent({ ...parts.content }, [text(f.a)]),
          ])
        }),
      ),

      Collapsible({ ...details.root }, [
        CollapsibleTrigger({ ...details.trigger, class: 'w-fit' }, [
          Button({ variant: 'outline', size: 'sm' }, [text('Toggle details')]),
        ]),
        CollapsibleContent({ ...details.content, class: 'text-muted-foreground' }, [
          text('The content stays in the DOM and is hidden by data-[state=closed].'),
        ]),
      ]),
    ]),

    section('Toolbar', 'Roving focus across groups — arrow keys move, Tab leaves.', [
      Toolbar({ ...toolbar.root }, [
        ToolbarGroup(
          { ...toolbar.group('format').root },
          TOOLS.map((tool) =>
            Button({ ...toolbar.item(tool).root, variant: 'ghost', size: 'sm' }, [text(tool)]),
          ),
        ),
        ToolbarSeparator({ ...toolbar.separator }),
        div({ class: 'flex items-center gap-1 text-xs text-muted-foreground' }, [
          text('Try'),
          Kbd([text('→')]),
        ]),
      ]),
    ]),
  ]
}
