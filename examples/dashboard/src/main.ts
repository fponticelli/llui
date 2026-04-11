import { component, mountApp, div, h1, h2, h3, span, button, p, ul, li, onMount } from '@llui/dom'
import type { Send, View } from '@llui/dom'
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
  | { type: 'setLocale'; locale: string }
  | { type: 'charts'; msg: InViewMsg }
  | { type: 'sort'; msg: SortableMsg }
  | { type: 'reorderPriorities'; from: number; to: number }
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
        // On drop, apply the reorder to priorities
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
  view: (h) => {
    const { send, text, each } = h

    // Apply current theme on mount + wire up inView observer for chart animation
    onMount((container) => {
      themeSwitch.applyTheme(themeSwitch.resolveTheme('system'))
      // Wait a frame so innerHTML bindings settle, then locate the charts section
      requestAnimationFrame(() => {
        const section = container.querySelector('.charts-section') as HTMLElement | null
        if (!section) return
        return inView.createObserver(section, (m) => send({ type: 'charts', msg: m }), {
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
              text((s) => formatDate(new Date(), { locale: s.locale, dateStyle: 'full' })),
            ]),
          ]),
          div({ class: 'header-controls' }, [themeToggle(text, send), localeSwitch(text, send)]),
        ]),

        // KPI cards
        div({ class: 'kpi-grid' }, [
          kpiCard(
            text,
            'Total Revenue',
            (s) =>
              formatNumber(717800, {
                locale: s.locale,
                style: 'currency',
                currency: 'USD',
                maximumFractionDigits: 0,
              }),
            '+12.3%',
            true,
          ),
          kpiCard(
            text,
            'Active Users',
            (s) => formatNumber(2580, { locale: s.locale }),
            '+28.4%',
            true,
          ),
          kpiCard(
            text,
            'Deployments',
            (s) => formatNumber(847, { locale: s.locale }),
            '+5.1%',
            true,
          ),
          kpiCard(
            text,
            'Avg Response',
            (s) => formatNumber(142, { locale: s.locale, style: 'unit', unit: 'millisecond' }),
            '-8.2%',
            false,
          ),
        ]),

        // Charts
        div(
          {
            class: (s: State) => `charts-section${s.charts.visible ? ' visible' : ''}`,
          },
          [
            div({ class: 'chart-card' }, [
              h2([text('Monthly Revenue')]),
              p({ class: 'chart-subtitle' }, [
                text((s) => {
                  const total = MONTHLY_REVENUE.reduce((a, b) => a + b.value, 0)
                  return formatNumber(total, {
                    locale: s.locale,
                    style: 'currency',
                    currency: 'USD',
                    maximumFractionDigits: 0,
                  })
                }),
                span({ class: 'badge green' }, [text('+12.3%')]),
              ]),
              barChart(MONTHLY_REVENUE.map((d) => ({ label: d.month, value: d.value }))),
            ]),
            div({ class: 'chart-card' }, [
              h2([text('Daily Active Users')]),
              p({ class: 'chart-subtitle' }, [
                text((s) =>
                  formatList(
                    [
                      formatNumber(DAILY_USERS[DAILY_USERS.length - 1], { locale: s.locale }),
                      'today',
                    ],
                    { locale: s.locale, type: 'unit', style: 'short' },
                  ),
                ),
                span({ class: 'badge green' }, [text('+28.4%')]),
              ]),
              lineChart(DAILY_USERS, { color: '#22c55e' }),
            ]),
          ],
        ),

        // Priorities (sortable)
        prioritiesSection(h, send),

        // Activity feed
        div({ class: 'activity-card' }, [
          h2([text('Recent Activity')]),
          ...each({
            items: () => ACTIVITY,
            key: (item) => item.user,
            render: ({ item }) => [
              div({ class: 'activity-item' }, [
                div({ class: 'activity-avatar' }, [
                  text(
                    item((i) =>
                      i.user
                        .split(' ')
                        .map((n) => n[0])
                        .join(''),
                    ),
                  ),
                ]),
                div({ class: 'activity-content' }, [
                  h3([text(item((i) => i.user))]),
                  p([text(item((i) => i.action))]),
                  span({ class: 'activity-time' }, [
                    text((s) => {
                      const seconds = item((i) => i.ago)()
                      if (seconds < 60)
                        return formatRelativeTime(-seconds, 'second', {
                          locale: s.locale,
                          numeric: 'auto',
                        })
                      if (seconds < 3600)
                        return formatRelativeTime(-Math.round(seconds / 60), 'minute', {
                          locale: s.locale,
                          numeric: 'auto',
                        })
                      if (seconds < 86400)
                        return formatRelativeTime(-Math.round(seconds / 3600), 'hour', {
                          locale: s.locale,
                          numeric: 'auto',
                        })
                      return formatRelativeTime(-Math.round(seconds / 86400), 'day', {
                        locale: s.locale,
                        numeric: 'auto',
                      })
                    }),
                  ]),
                ]),
              ]),
            ],
          }),
        ]),
      ]),
    ]
  },
})

// ── View helpers ─────────────────────────────────────────────────

type TextFn = View<State, Msg>['text']

function prioritiesSection(h: View<State, Msg>, send: Send<Msg>): HTMLElement {
  const { text, each } = h
  const sortSend = (m: SortableMsg): void => send({ type: 'sort', msg: m })
  const parts = sortable.connect<State>((s) => s.sort, sortSend, { id: 'priorities' })

  return div({ class: 'priorities-card' }, [
    h2([text('Priorities')]),
    p({ class: 'hint' }, [text('Drag the handle to reorder')]),
    ul(
      {
        ...parts.root,
        class: 'priority-list',
      },
      [
        ...each({
          items: (s: State) => s.priorities,
          key: (p: Priority) => p.id,
          render: ({ item, index }) => {
            const id = item((p) => p.id)
            return [
              li(
                {
                  ...parts.item(id(), index()),
                  class: (s: State) =>
                    `priority-item${s.sort.dragging?.id === id() ? ' dragging' : ''}`,
                },
                [
                  div({ ...parts.handle(id(), index()), class: 'priority-handle' }, [
                    text('\u2630'),
                  ]),
                  div({ class: 'priority-body' }, [
                    span({ class: 'priority-title' }, [text(item((p) => p.title))]),
                    span(
                      {
                        class: (_s) => `priority-impact priority-${item((p) => p.impact)()}`,
                      },
                      [text(item((p) => p.impact))],
                    ),
                  ]),
                ],
              ),
            ]
          },
        }),
      ],
    ),
  ])
}

function themeBtn(text: TextFn, send: Send<Msg>, t: Theme, icon: string): HTMLElement {
  return button(
    {
      class: (s: State) => `theme-btn${s.theme === t ? ' active' : ''}`,
      onClick: () => send({ type: 'setTheme', theme: t }),
      'aria-label': `Theme: ${t}`,
      'aria-pressed': (s: State) => s.theme === t,
    },
    [text(icon)],
  )
}

function themeToggle(text: TextFn, send: Send<Msg>): HTMLElement {
  return div({ class: 'theme-switch', role: 'group', 'aria-label': 'Theme' }, [
    themeBtn(text, send, 'light', '\u2600'),
    themeBtn(text, send, 'dark', '\u263D'),
    themeBtn(text, send, 'system', '\u25D0'),
  ])
}

function localeSwitch(text: TextFn, send: Send<Msg>): HTMLElement {
  const locales = [
    { code: 'en-US', label: 'EN' },
    { code: 'es-ES', label: 'ES' },
    { code: 'ja-JP', label: 'JA' },
  ]
  return div(
    { class: 'locale-switch', role: 'group', 'aria-label': 'Language' },
    locales.map((l) =>
      button(
        {
          class: (s: State) => `locale-btn${s.locale === l.code ? ' active' : ''}`,
          onClick: () => send({ type: 'setLocale', locale: l.code }),
          'aria-pressed': (s: State) => s.locale === l.code,
        },
        [text(l.label)],
      ),
    ),
  )
}

function kpiCard(
  text: TextFn,
  title: string,
  valueFn: (s: State) => string,
  change: string,
  positive: boolean,
): HTMLElement {
  return div({ class: 'kpi-card' }, [
    span({ class: 'kpi-title' }, [text(title)]),
    div({ class: 'kpi-value' }, [span([text(valueFn)])]),
    span({ class: `kpi-change ${positive ? 'green' : 'red'}` }, [text(change)]),
  ])
}

// ── Mount ────────────────────────────────────────────────────────

mountApp(document.getElementById('app')!, Dashboard)
