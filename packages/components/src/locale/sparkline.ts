import { resolveLocaleSlice, type Locale } from './context.js'

export const enSparkline: Locale['sparkline'] = {
  empty: 'No readings',
  range: (count, from, to) =>
    count === 1 ? `1 reading, ${from}` : `Trend of ${count} readings, ${from} to ${to}`,
}
export const sparklineLocale = (): Locale['sparkline'] =>
  resolveLocaleSlice('sparkline', enSparkline)
