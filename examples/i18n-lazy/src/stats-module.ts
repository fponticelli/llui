/**
 * "Heavy" stats component — loaded on demand via lazy().
 *
 * Imagine this file is 100 KB with charting libraries, complex logic,
 * etc. Keeping it out of the initial bundle improves first-paint time
 * significantly for users who never click the button.
 */
import { component, div, h2, p, ul, li, span, text, each } from '@llui/dom/signals'
import type { Signal } from '@llui/dom/signals'
import { formatNumber } from '@llui/components'

interface StatItem {
  label: string
  value: number
  isPercent: boolean
  change: number
}

const STATS: StatItem[] = [
  { label: 'Total views', value: 14523, isPercent: false, change: 0.124 },
  { label: 'Active sessions', value: 847, isPercent: false, change: 0.053 },
  { label: 'Conversion rate', value: 0.042, isPercent: true, change: -0.018 },
  { label: 'Avg session (s)', value: 183, isPercent: false, change: 0.072 },
]

// State seed handed in via lazy()'s `initialState`. STATS are a module
// constant (the "heavy payload"), not part of serializable state.
export type StatsState = { locale: string }

const StatsModule = component<StatsState, never, never>({
  name: 'StatsModule',
  init: () => [{ locale: 'en-US' }, []],
  update: (s) => [s, []],
  view: ({ state }) => [
    div({ class: 'card' }, [
      h2([text('Stats')]),
      p([text('This module was loaded asynchronously via lazy() + dynamic import().')]),
      ul({ class: 'stat-list', style: 'list-style: none; padding: 0; margin: 1rem 0 0' }, [
        each(
          state.map(() => STATS),
          {
            key: (s) => s.label,
            render: (item) => [statRow(item, state.at('locale'))],
          },
        ),
      ]),
    ]),
  ],
})

// STATS is static, so each row's value is fixed for its lifetime — read it
// once here (plain value) and close over it in the locale-derived slot, so the
// .map body operates on plain values (its only reactive source is locale).
function statRow(item: Signal<StatItem>, locale: Signal<string>): Node {
  const stat = item.peek()
  return li(
    {
      class: 'stat-item',
      style:
        'display: flex; justify-content: space-between; padding: 0.5rem 0; border-top: 1px solid #334155',
    },
    [
      span([text(stat.label)]),
      span({ style: 'color: #f1f5f9; font-weight: 600' }, [
        text(locale.map((l) => formatStat(l, stat))),
      ]),
    ],
  )
}

function formatStat(locale: string, stat: StatItem): string {
  const value = formatNumber(stat.value, {
    locale,
    style: stat.isPercent ? 'percent' : 'decimal',
    maximumFractionDigits: 1,
  })
  const change = formatNumber(stat.change, {
    locale,
    style: 'percent',
    signDisplay: 'exceptZero',
    maximumFractionDigits: 1,
  })
  return `${value}  (${change})`
}

export default StatsModule
