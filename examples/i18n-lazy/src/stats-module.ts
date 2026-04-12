/**
 * "Heavy" stats component — loaded on demand via lazy().
 *
 * Imagine this file is 100 KB with charting libraries, complex logic,
 * etc. Keeping it out of the initial bundle improves first-paint time
 * significantly for users who never click the button.
 */
import { component, div, h2, p, ul, li, span } from '@llui/dom'
import { formatNumber } from '@llui/components'

interface Props {
  locale: string
}

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

// Child's own state/msg types. `View<S, M>` is invariant in M (because
// `send: Send<M>` is contravariant), so we can't widen here to match the
// parent's Msg type. Callers of lazy() cast the loader result to bridge
// the erasure boundary.
const StatsModule = component<Props, never, never, Props>({
  name: 'StatsModule',
  init: (data) => [{ locale: data?.locale ?? 'en-US' }, []],
  update: (s) => [s, []],
  view: ({ text, each }) => [
    div({ class: 'card' }, [
      h2([text('Stats')]),
      p([text('This module was loaded asynchronously via lazy() + dynamic import().')]),
      ul({ class: 'stat-list', style: 'list-style: none; padding: 0; margin: 1rem 0 0' }, [
        ...each({
          items: () => STATS,
          key: (s) => s.label,
          render: ({ item }) => [
            li(
              {
                class: 'stat-item',
                style:
                  'display: flex; justify-content: space-between; padding: 0.5rem 0; border-top: 1px solid #334155',
              },
              [
                span([text(item((i) => i.label))]),
                span({ style: 'color: #f1f5f9; font-weight: 600' }, [
                  text((s: Props) => formatStat(s.locale, item((i) => i)())),
                ]),
              ],
            ),
          ],
        }),
      ]),
    ]),
  ],
})

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
