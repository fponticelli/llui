import { component, div, h1, p, table, thead, tbody, tr, th, td } from '@llui/dom'

interface Report {
  month: string
  revenue: number
  growth: string
}

type ReportsState = { rows: readonly Report[] }

/**
 * Dashboard / Reports — rendered inside the nested layout chain.
 * Distinct Page def from DashboardOverviewPage so a nav between them
 * is a real swap (the chain diff sees a mismatch at the innermost
 * layer and disposes + re-mounts only the page).
 */
export const Page = component<ReportsState, never, never>({
  name: 'DashboardReportsPage',
  init: () => [
    {
      rows: [
        { month: 'January', revenue: 12_400, growth: '+4.2%' },
        { month: 'February', revenue: 13_800, growth: '+11.3%' },
        { month: 'March', revenue: 15_100, growth: '+9.4%' },
        { month: 'April', revenue: 14_700, growth: '−2.6%' },
      ],
    },
    [],
  ],
  update: (state) => [state, []],
  view: ({ text, each }) => [
    div({ class: 'page page-dashboard-reports' }, [
      h1([text('Reports')]),
      p([text('Quarterly snapshot. DashboardLayout wraps me on the left.')]),
      table({ class: 'reports-table' }, [
        thead([tr([th([text('Month')]), th([text('Revenue')]), th([text('Growth')])])]),
        tbody([
          ...each({
            items: (s) => s.rows,
            key: (r) => r.month,
            render: ({ item }) => [
              tr([
                td([text(item.month)]),
                td([text((_s) => `$${item.revenue().toLocaleString()}`)]),
                td([text(item.growth)]),
              ]),
            ],
          }),
        ]),
      ]),
    ]),
  ],
})
