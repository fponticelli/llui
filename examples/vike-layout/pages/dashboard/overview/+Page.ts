import { component, div, h1, p, ul, li, button, text, each } from '@llui/dom'

type Widget = { id: number; label: string }
// `nextId` is a monotonic counter so each widget gets a stable, never-reused key
// — reusing the label as the key (e.g. `widget-4`) collides after a remove+add
// cycle regenerates the same label, corrupting `each`'s keyed reconcile.
type OverviewState = { widgets: readonly Widget[]; nextId: number }
type OverviewMsg =
  /** @intent("Append a new widget to the overview list") */
  | { type: 'add' }
  /**
   * @intent("Remove the widget with the given id from the overview list")
   * @example({"type":"remove","id":1})
   */
  | { type: 'remove'; id: number }

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
  init: () => [
    {
      widgets: [
        { id: 1, label: 'users' },
        { id: 2, label: 'revenue' },
        { id: 3, label: 'latency' },
      ],
      nextId: 4,
    },
    [],
  ],
  update: (state, msg) => {
    switch (msg.type) {
      case 'add':
        return [
          {
            widgets: [...state.widgets, { id: state.nextId, label: `widget-${state.nextId}` }],
            nextId: state.nextId + 1,
          },
          [],
        ]
      case 'remove':
        return [{ ...state, widgets: state.widgets.filter((w) => w.id !== msg.id) }, []]
    }
  },
  view: ({ state, send }) => [
    div({ class: 'page page-dashboard-overview' }, [
      h1([text('Overview')]),
      p([
        text(
          'Both layouts are mounted above this page. Click Reports in the sidebar and watch: only this page disposes, the sidebar stays.',
        ),
      ]),
      ul({ class: 'widget-list' }, [
        each(state.at('widgets'), {
          key: (w) => w.id,
          render: (item) => [
            li([
              text(item.at('label')),
              button(
                {
                  class: 'remove',
                  onClick: () => send({ type: 'remove', id: item.peek().id }),
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
