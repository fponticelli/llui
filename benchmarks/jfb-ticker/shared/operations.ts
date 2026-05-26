// Pure-data tick generators. Each framework consumes these and applies
// them in its idiomatic update style. Generation is framework-agnostic
// so the comparison stays fair — the only thing that varies is how the
// state transition is committed to the DOM.

import type { Dashboard, DisplayMode, Symbol, SymbolPatch, Tick } from './types.js'

type NumericKeys<T> = { [K in keyof T]: T[K] extends number ? K : never }[keyof T]
export type NumericDashboardKey = NumericKeys<Dashboard>

// Numeric dashboard paths a tick is allowed to write. Excludes:
//   - string fields (`displayMode`, `marketState`)
//   - `tickCount` / `lastTick` — managed by the harness as the sync
//     signal; tick handlers set them explicitly to seq+1 and a random
//     overwrite would break the harness's counter assertion.
export const TICKABLE_PATHS: ReadonlyArray<NumericDashboardKey> = [
  'indexValue',
  'indexChange',
  'indexChangePct',
  'advancers',
  'decliners',
  'unchanged',
  'newHighs',
  'sectorTech',
  'sectorFin',
  'sectorHealth',
  'sectorEnergy',
  'sectorConsumer',
  'sectorIndustrial',
  'sectorUtilities',
  'sectorMaterials',
  'sectorRealestate',
  'sectorComm',
  'sectorStaples',
  'usdEur',
  'usdJpy',
  'usdGbp',
  'usdCny',
  'oil',
  'gold',
  'silver',
  'copper',
  'latencyMs',
  'connectedFeeds',
]

const DISPLAY_MODES: readonly DisplayMode[] = ['price', 'change', 'volume']

export function nextDisplayMode(current: DisplayMode): DisplayMode {
  return DISPLAY_MODES[(DISPLAY_MODES.indexOf(current) + 1) % DISPLAY_MODES.length]!
}

// Pick K distinct indices in [0, n) using rng. Used for both dashboard
// path selection and symbol index selection.
function pickDistinct(rng: () => number, n: number, k: number): number[] {
  if (k >= n) return Array.from({ length: n }, (_, i) => i)
  const out = new Set<number>()
  while (out.size < k) out.add(Math.floor(rng() * n))
  return [...out]
}

// One "wide" tick: 2 dashboard scalars + 5 symbols.
export function generateTick(
  rng: () => number,
  symbolCount: number,
  seq: number,
  currentSymbols: ReadonlyArray<Symbol>,
): Tick {
  const dashIdx = pickDistinct(rng, TICKABLE_PATHS.length, 2)
  const dashboardUpdates: Partial<Dashboard> = { tickCount: seq + 1, lastTick: seq + 1 }
  const numericPatch = dashboardUpdates as Record<NumericDashboardKey, number>
  for (const i of dashIdx) {
    const key = TICKABLE_PATHS[i]!
    numericPatch[key] = Math.round(rng() * 100000) / 100
  }

  const symbolIdx = pickDistinct(rng, symbolCount, 5)
  const symbolUpdates: SymbolPatch[] = symbolIdx.map((index) => {
    const prev = currentSymbols[index]!
    const newPrice = Math.max(0.01, prev.price + (rng() - 0.5) * 4)
    const change = newPrice - prev.price
    return {
      index,
      price: newPrice,
      change,
      changePct: (change / prev.price) * 100,
      volume: prev.volume + Math.floor(rng() * 10000),
      lastTickAt: seq + 1,
    }
  })

  return { dashboardUpdates, symbolUpdates }
}

// Narrow tick: 1 dashboard scalar, no symbols. This is the mask-gating
// benchmark — frameworks that re-evaluate every row on any change pay
// O(rows) per tick; LLui's bitmask should make this O(1).
export function generateNarrowTick(rng: () => number, seq: number): Tick {
  const idx = Math.floor(rng() * TICKABLE_PATHS.length)
  const key = TICKABLE_PATHS[idx]!
  const dashboardUpdates: Partial<Dashboard> = { tickCount: seq + 1 }
  ;(dashboardUpdates as Record<NumericDashboardKey, number>)[key] = Math.round(rng() * 100000) / 100
  return { dashboardUpdates, symbolUpdates: [] }
}

// Churn: drop first N, append N fresh. Tests each() keyed reconciliation
// when both ends of the list change at once.
export function generateChurn(
  rng: () => number,
  count: number,
  nextId: number,
): { newSymbols: Symbol[]; nextId: number } {
  const A = 'A'.charCodeAt(0)
  const newSymbols: Symbol[] = []
  for (let i = 0; i < count; i++) {
    const ticker = [0, 0, 0, 0].map(() => String.fromCharCode(A + Math.floor(rng() * 26))).join('')
    newSymbols.push({
      id: nextId++,
      ticker,
      price: 10 + rng() * 990,
      change: 0,
      changePct: 0,
      volume: Math.floor(rng() * 1_000_000),
      lastTickAt: 0,
    })
  }
  return { newSymbols, nextId }
}
