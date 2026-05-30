import {
  component,
  mountApp,
  div,
  h1,
  h2,
  h3,
  span,
  button,
  p,
  ul,
  li,
  onMount,
  text,
  each,
} from '@llui/dom'
import type { Send, Signal } from '@llui/dom'
import {
  formatNumber,
  formatRelativeTime,
  formatDate,
  formatList,
  sortable,
  themeSwitch,
  inView,
} from '@llui/components'
import type { SortableState, SortableMsg, Theme, InViewState, InViewMsg } from '@llui/components'
import { MONTHLY_REVENUE, DAILY_USERS, ACTIVITY } from './data'
import { barChart, lineChart } from './charts'

// ── Types ────────────────────────────────────────────────────────

interface Priority {
  id: string
  title: string
  impact: 'high' | 'medium' | 'low'
}

type State = {
  locale: string
  charts: InViewState
  priorities: Priority[]
  sort: SortableState
  theme: Theme
}

type Msg =
  /**
   * @intent("Set the locale for the dashboard")
   * @example({"type":"setLocale","locale":"en-US"})
   */
  | { type: 'setLocale'; locale: string }
  /**
   * @intent("Handle charts intersection observer updates")
   * @example({"type":"charts","msg":{"type":"enter"}})
   */
  | { type: 'charts'; msg: InViewMsg }
  /**
   * @intent("Handle sorting updates for priorities")
   * @example({"type":"sort","msg":{"type":"start","id":"p1"}})
   */
  | { type: 'sort'; msg: SortableMsg }
  /**
   * @intent("Reorder the priorities list by moving item at `from` to position `to`")
   * @example({"type":"reorderPriorities","from":0,"to":2})
   */
  | { type: 'reorderPriorities'; from: number; to: number }
  /**
   * @intent("Change the application theme")
   * @example({"type":"setTheme","theme":"dark"})
   */
  | { type: 'setTheme'; theme: Theme }

const INITIAL_PRIORITIES: Priority[] = [
  { id: 'p1', title: 'Migrate billing service to new API', impact: 'high' },
  { id: 'p2', title: 'Investigate Q3 revenue drop', impact: 'high' },
  { id: 'p3', title: 'Update onboarding flow design', impact: 'medium' },
  { id: 'p4', title: 'Refactor auth middleware', impact: 'medium' },
  { id: 'p5', title: 'Archive old logs', impact: 'low' },
]

// ── Component ────────────────────────────────────────────────────

const Dashboard = component<State, Msg, never>({
  name: 'Dashboard',
  init: () => [
    {
      locale: 'en-US',
      charts: inView.init(),
      priorities: INITIAL_PRIORITIES,
      sort: sortable.init(),
      theme: 'system' as Theme,
    },
    [],
  ],
  update: (state, msg) => {
    switch (msg.type) {
      case 'setLocale':
        return [{ ...state, locale: msg.locale }, []]
      case 'charts': {
        const [charts] = inView.update(state.charts, msg.msg)
        return [{ ...state, charts }, []]
      }
      case 'sort': {
        const [sort] = sortable.update(state.sort, msg.msg)
        if (msg.msg.type === 'drop' && state.sort.dragging) {
          const { startIndex, currentIndex } = state.sort.dragging
          return [
            {
              ...state,
              sort,
              priorities: sortable.reorder(state.priorities, startIndex, currentIndex),
            },
            [],
          ]
        }
        return [{ ...state, sort }, []]
      }
      case 'reorderPriorities':
        return [{ ...state, priorities: sortable.reorder(state.priorities, msg.from, msg.to) }, []]
      case 'setTheme':
        themeSwitch.applyTheme(themeSwitch.resolveTheme(msg.theme))
        return [{ ...state, theme: msg.theme }, []]
    }
  },
  view: ({ state, send }) => {
    // Apply current theme on mount + wire up inView observer for chart animation
    onMount((container) => {
      themeSwitch.applyTheme(themeSwitch.resolveTheme('system'))
      // Wait a frame so bindings settle, then locate the charts section
      requestAnimationFrame(() => {
        const section = container.querySelector('.charts-section') as HTMLElement | null
        if (!section) return
        inView.createObserver(section, (m) => send({ type: 'charts', msg: m }), {
          threshold: 0.1,
          once: true,
        })
      })
    })

    return [
      div({ class: 'dashboard' }, [
        // Header
        div({ class: 'header' }, [
          div([
            h1([text('Dashboard')]),
            p({ class: 'subtitle' }, [
              text(
                state
                  .at('locale')
                  .map((locale) => formatDate(new Date(), { locale, dateStyle: 'full' })),
              ),
            ]),
          ]),
          div({ class: 'header-controls' }, [
            themeToggle(state.at('theme'), send),
            localeSwitch(state.at('locale'), send),
          ]),
        ]),

        // KPI cards
        div({ class: 'kpi-grid' }, [
          kpiCard(
            state.at('locale'),
            'Total Revenue',
            (locale) =>
              formatNumber(717800, {
                locale,
                style: 'currency',
                currency: 'USD',
                maximumFractionDigits: 0,
              }),
            '+12.3%',
            true,
          ),
          kpiCard(
            state.at('locale'),
            'Active Users',
            (locale) => formatNumber(2580, { locale }),
            '+28.4%',
            true,
          ),
          kpiCard(
            state.at('locale'),
            'Deployments',
            (locale) => formatNumber(847, { locale }),
            '+5.1%',
            true,
          ),
          kpiCard(
            state.at('locale'),
            'Avg Response',
            (locale) => formatNumber(142, { locale, style: 'unit', unit: 'millisecond' }),
            '-8.2%',
            false,
          ),
        ]),

        // Charts
        div(
          {
            class: state
              .at('charts')
              .map((charts) => `charts-section${charts.visible ? ' visible' : ''}`),
          },
          [
            div({ class: 'chart-card' }, [
              h2([text('Monthly Revenue')]),
              p({ class: 'chart-subtitle' }, [
                text(
                  state.at('locale').map((locale) => {
                    const total = MONTHLY_REVENUE.reduce((a, b) => a + b.value, 0)
                    return formatNumber(total, {
                      locale,
                      style: 'currency',
                      currency: 'USD',
                      maximumFractionDigits: 0,
                    })
                  }),
                ),
                span({ class: 'badge green' }, [text('+12.3%')]),
              ]),
              barChart(MONTHLY_REVENUE.map((d) => ({ label: d.month, value: d.value }))),
            ]),
            div({ class: 'chart-card' }, [
              h2([text('Daily Active Users')]),
              p({ class: 'chart-subtitle' }, [
                text(
                  state
                    .at('locale')
                    .map((locale) =>
                      formatList(
                        [formatNumber(DAILY_USERS[DAILY_USERS.length - 1]!, { locale }), 'today'],
                        { locale, type: 'unit', style: 'short' },
                      ),
                    ),
                ),
                span({ class: 'badge green' }, [text('+28.4%')]),
              ]),
              lineChart(DAILY_USERS, { color: '#22c55e' }),
            ]),
          ],
        ),

        // Priorities (sortable)
        prioritiesSection(state.at('priorities'), state.at('sort'), send),

        // Activity feed
        div({ class: 'activity-card' }, [
          h2([text('Recent Activity')]),
          each(
            state.map(() => ACTIVITY),
            {
              key: (item) => item.user,
              render: (item) => [activityItem(item, state.at('locale'))],
            },
          ),
        ]),
      ]),
    ]
  },
})

// ── View helpers ─────────────────────────────────────────────────

interface ActivityDatum {
  user: string
  action: string
  ago: number
}

function activityItem(item: Signal<ActivityDatum>, locale: Signal<string>): Node {
  // ACTIVITY is static, so the per-row value is fixed for its lifetime — read
  // it once (plain value) and close over it in the locale-derived slot.
  const entry = item.peek()
  return div({ class: 'activity-item' }, [
    div({ class: 'activity-avatar' }, [
      text(
        entry.user
          .split(' ')
          .map((n) => n[0])
          .join(''),
      ),
    ]),
    div({ class: 'activity-content' }, [
      h3([text(entry.user)]),
      p([text(entry.action)]),
      span({ class: 'activity-time' }, [text(locale.map((l) => relativeAgo(entry.ago, l)))]),
    ]),
  ])
}

function relativeAgo(seconds: number, locale: string): string {
  if (seconds < 60) return formatRelativeTime(-seconds, 'second', { locale, numeric: 'auto' })
  if (seconds < 3600)
    return formatRelativeTime(-Math.round(seconds / 60), 'minute', { locale, numeric: 'auto' })
  if (seconds < 86400)
    return formatRelativeTime(-Math.round(seconds / 3600), 'hour', { locale, numeric: 'auto' })
  return formatRelativeTime(-Math.round(seconds / 86400), 'day', { locale, numeric: 'auto' })
}

function prioritiesSection(
  priorities: Signal<Priority[]>,
  sort: Signal<SortableState>,
  send: Send<Msg>,
): Node {
  const sortSend = (m: SortableMsg): void => send({ type: 'sort', msg: m })
  const parts = sortable.connect(sort, sortSend, { id: 'priorities' })

  return div({ class: 'priorities-card' }, [
    h2([text('Priorities')]),
    p({ class: 'hint' }, [text('Drag the handle to reorder')]),
    ul(
      {
        ...parts.root,
        class: 'priority-list',
      },
      [
        each(priorities, {
          key: (p: Priority) => p.id,
          render: (item, index) => [priorityItem(item, index, parts)],
        }),
      ],
    ),
  ])
}

function priorityItem(
  item: Signal<Priority>,
  index: Signal<number>,
  parts: ReturnType<typeof sortable.connect>,
): Node {
  const id = item.peek().id
  const idx = index.peek()
  return li(
    {
      ...parts.item(id, idx),
      class: 'priority-item',
    },
    [
      div({ ...parts.handle(id, idx), class: 'priority-handle' }, [text('☰')]),
      div({ class: 'priority-body' }, [
        span({ class: 'priority-title' }, [text(item.at('title'))]),
        span(
          {
            class: item.at('impact').map((impact) => `priority-impact priority-${impact}`),
          },
          [text(item.at('impact'))],
        ),
      ]),
    ],
  )
}

function themeBtn(theme: Signal<Theme>, send: Send<Msg>, t: Theme, icon: string): Node {
  return button(
    {
      class: theme.map((cur) => `theme-btn${cur === t ? ' active' : ''}`),
      onClick: () => send({ type: 'setTheme', theme: t }),
      'aria-label': `Theme: ${t}`,
      'aria-pressed': theme.map((cur) => cur === t),
    },
    [text(icon)],
  )
}

function themeToggle(theme: Signal<Theme>, send: Send<Msg>): Node {
  return div({ class: 'theme-switch', role: 'group', 'aria-label': 'Theme' }, [
    themeBtn(theme, send, 'light', '☀'),
    themeBtn(theme, send, 'dark', '☽'),
    themeBtn(theme, send, 'system', '◐'),
  ])
}

function localeBtn(locale: Signal<string>, send: Send<Msg>, code: string, label: string): Node {
  return button(
    {
      class: locale.map((cur) => `locale-btn${cur === code ? ' active' : ''}`),
      onClick: () => send({ type: 'setLocale', locale: code }),
      'aria-pressed': locale.map((cur) => cur === code),
    },
    [text(label)],
  )
}

function localeSwitch(locale: Signal<string>, send: Send<Msg>): Node {
  // Build buttons explicitly (not via locales.map) — a plain Array.map building
  // DOM is indistinguishable to the compiler from a signal .map, which forbids
  // node construction in its body.
  return div({ class: 'locale-switch', role: 'group', 'aria-label': 'Language' }, [
    localeBtn(locale, send, 'en-US', 'EN'),
    localeBtn(locale, send, 'es-ES', 'ES'),
    localeBtn(locale, send, 'ja-JP', 'JA'),
  ])
}

function kpiCard(
  locale: Signal<string>,
  title: string,
  valueFn: (locale: string) => string,
  change: string,
  positive: boolean,
): Node {
  return div({ class: 'kpi-card' }, [
    span({ class: 'kpi-title' }, [text(title)]),
    div({ class: 'kpi-value' }, [span([text(locale.map(valueFn))])]),
    span({ class: `kpi-change ${positive ? 'green' : 'red'}` }, [text(change)]),
  ])
}

// ── Mount ────────────────────────────────────────────────────────

mountApp(document.getElementById('app')!, Dashboard)
