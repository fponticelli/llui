import { component, div, h1, p, ul, li, button } from '@llui/dom'

type OverviewState = { widgets: readonly string[] }
type OverviewMsg = { type: 'add' } | { type: 'remove'; idx: number }

/**
 * Dashboard / Overview — mounted inside the nested chain
 * [AppLayout, DashboardLayout, this page]. Both layouts stay alive on
 * nav to /dashboard/reports; only this page disposes.
 *
 * For a demonstration of pages triggering layout-owned operations via
 * context dispatchers, see `pages/index/+Page.ts` (ToastContext +
 * SessionContext) or `pages/settings/+Page.ts` (ToastContext).
 */
export const Page = component<OverviewState, OverviewMsg, never>({
  name: 'DashboardOverviewPage',
  init: () => [{ widgets: ['users', 'revenue', 'latency'] }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'add':
        return [{ widgets: [...state.widgets, `widget-${state.widgets.length + 1}`] }, []]
      case 'remove':
        return [{ widgets: state.widgets.filter((_, i) => i !== msg.idx) }, []]
    }
  },
  view: ({ send, text, each }) => [
    div({ class: 'page page-dashboard-overview' }, [
      h1([text('Overview')]),
      p([
        text(
          'Both layouts are mounted above this page. Click Reports in the sidebar and watch: only this page disposes, the sidebar stays.',
        ),
      ]),
      ul({ class: 'widget-list' }, [
        ...each({
          items: (s) => s.widgets,
          key: (w) => w,
          render: ({ item, index }) => [
            li([
              text(item),
              button(
                {
                  class: 'remove',
                  onClick: () => send({ type: 'remove', idx: index() }),
                },
                [text('remove')],
              ),
            ]),
          ],
        }),
      ]),
      button({ class: 'primary', onClick: () => send({ type: 'add' }) }, [text('Add widget')]),
    ]),
  ],
})
