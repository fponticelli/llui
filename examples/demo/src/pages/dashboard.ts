import { div, span, text, ul, li } from '@llui/core'
import type { Send } from '@llui/core'

export type DashboardSlice = {
  totalContacts: number
  activeDeals: number
  revenue: number
}

export type DashboardMsg = never

export function dashboardUpdate(slice: DashboardSlice, _msg: DashboardMsg): DashboardSlice {
  return slice
}

export type DashboardProps<S> = {
  dashboard: (s: S) => DashboardSlice
}

const activities = [
  { text: 'New contact added: Sarah Chen', time: '2 min ago', color: 'green' },
  { text: 'Deal closed: Acme Corp ($12,000)', time: '1 hour ago', color: 'blue' },
  { text: 'Follow-up reminder: John Smith', time: '3 hours ago', color: 'orange' },
  { text: 'Email campaign sent: Q2 Newsletter', time: '5 hours ago', color: 'blue' },
  { text: 'New lead from website form', time: 'Yesterday', color: 'green' },
]

export function dashboardView<S>(
  props: DashboardProps<S>,
  _send: Send<DashboardMsg>,
): Node[] {
  return [
    div({ class: 'stats' }, [
      statCard('👥', 'Total Contacts', (s: S) => String(props.dashboard(s).totalContacts), 'blue'),
      statCard('📈', 'Active Deals', (s: S) => String(props.dashboard(s).activeDeals), 'green'),
      statCard('💰', 'Revenue', (s: S) => `$${props.dashboard(s).revenue.toLocaleString()}`, 'purple'),
    ]),
    div({ class: 'table-container' }, [
      div({ class: 'table-header' }, [
        span({}, [text('Recent Activity')]),
      ]),
      ul({ class: 'activity-list' }, [
        ...activities.map((act) =>
          li({ class: 'activity-item' }, [
            div({ class: `activity-dot ${act.color}` }),
            span({ class: 'activity-text' }, [text(act.text)]),
            span({ class: 'activity-time' }, [text(act.time)]),
          ]),
        ),
      ]),
    ]),
  ]
}

function statCard<S>(icon: string, label: string, value: (s: S) => string, color: string): HTMLElement {
  return div({ class: 'stat-card' }, [
    div({ class: `icon-wrap ${color}` }, [text(icon)]),
    div({ class: 'label' }, [text(label)]),
    div({ class: 'value' }, [text(value)]),
  ])
}
