import { div, button, text, show, type Send } from '@llui/core'

export type TabsSlice = {
  activeTab: string
}

export type TabsMsg = { type: 'tabs:select'; tab: string }

export interface TabDef {
  id: string
  label: string
  content: () => Node[]
}

export type TabsProps<S> = {
  activeTab: (s: S) => string
  tabs: TabDef[]
}

export function tabsUpdate(slice: TabsSlice, msg: TabsMsg): TabsSlice {
  switch (msg.type) {
    case 'tabs:select':
      return { activeTab: msg.tab }
  }
}

export function tabsView<S>(
  props: TabsProps<S>,
  send: Send<TabsMsg>,
): Node[] {
  return [
    div(
      {
        class: 'tabs',
        role: 'tablist',
        'data-scope': 'tabs',
        'data-part': 'list',
      },
      props.tabs.map((tab) =>
        button(
          {
            class: (s: S) =>
              props.activeTab(s) === tab.id ? 'tab-trigger active' : 'tab-trigger',
            role: 'tab',
            'aria-selected': (s: S) => (props.activeTab(s) === tab.id ? 'true' : 'false'),
            'data-scope': 'tabs',
            'data-part': 'trigger',
            'data-value': tab.id,
            onClick: () => send({ type: 'tabs:select', tab: tab.id }),
          },
          [text(tab.label)],
        ),
      ),
    ),
    ...props.tabs.flatMap((tab) =>
      show<S>({
        when: (s) => props.activeTab(s) === tab.id,
        render: () => [
          div(
            {
              class: 'tab-content',
              role: 'tabpanel',
              'data-scope': 'tabs',
              'data-part': 'content',
              'data-value': tab.id,
            },
            tab.content(),
          ),
        ],
      }),
    ),
  ]
}
