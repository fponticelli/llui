import { component, mountApp, div, h1, h2, h3, span, button, p, onMount } from '@llui/dom'
import type { Send, View } from '@llui/dom'
import { formatNumber, formatRelativeTime, formatDate, formatList } from '@llui/components'
import { MONTHLY_REVENUE, DAILY_USERS, ACTIVITY } from './data'
import { barChart, lineChart } from './charts'

// ── Types ────────────────────────────────────────────────────────

type State = {
  locale: string
  chartsVisible: boolean
}

type Msg = { type: 'setLocale'; locale: string } | { type: 'chartsVisible' }

// ── Component ────────────────────────────────────────────────────

const Dashboard = component<State, Msg, never>({
  name: 'Dashboard',
  init: () => [{ locale: 'en-US', chartsVisible: false }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'setLocale':
        return [{ ...state, locale: msg.locale }, []]
      case 'chartsVisible':
        return [state.chartsVisible ? state : { ...state, chartsVisible: true }, []]
    }
  },
  view: (h) => {
    const { send, text, each } = h

    // Set up IntersectionObserver for chart animation
    onMount((container) => {
      requestAnimationFrame(() => {
        const section = container.querySelector('.charts-section')
        if (!section) return
        const obs = new IntersectionObserver(
          (entries) => {
            for (const e of entries) {
              if (e.isIntersecting) {
                send({ type: 'chartsVisible' })
                obs.disconnect()
              }
            }
          },
          { threshold: 0.1 },
        )
        obs.observe(section)
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
          localeSwitch(text, send),
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
            class: (s: State) => `charts-section${s.chartsVisible ? ' visible' : ''}`,
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
