// Initial state generation. Same seed → same starting board across
// frameworks, which keeps the comparison fair.

import { mulberry32, SEED } from './prng.js'
import type { Dashboard, Symbol, TickerState } from './types.js'

export const SYMBOL_COUNT = 200

// 4-letter A–Z tickers, deterministic. We don't need real symbols — we
// need stable, distinguishable identifiers in the DOM.
function generateTickers(rng: () => number, count: number): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const A = 'A'.charCodeAt(0)
  while (out.length < count) {
    const chars = [0, 0, 0, 0].map(() => String.fromCharCode(A + Math.floor(rng() * 26)))
    const s = chars.join('')
    if (seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

export function initialSymbols(): Symbol[] {
  const rng = mulberry32(SEED)
  const tickers = generateTickers(rng, SYMBOL_COUNT)
  return tickers.map((ticker, i) => ({
    id: i + 1,
    ticker,
    price: 10 + rng() * 990,
    change: (rng() - 0.5) * 5,
    changePct: (rng() - 0.5) * 2,
    volume: Math.floor(rng() * 1_000_000),
    lastTickAt: 0,
  }))
}

export function initialDashboard(): Dashboard {
  return {
    indexValue: 4500,
    indexChange: 0,
    indexChangePct: 0,
    lastTick: 0,
    advancers: 0,
    decliners: 0,
    unchanged: SYMBOL_COUNT,
    newHighs: 0,
    sectorTech: 0,
    sectorFin: 0,
    sectorHealth: 0,
    sectorEnergy: 0,
    sectorConsumer: 0,
    sectorIndustrial: 0,
    sectorUtilities: 0,
    sectorMaterials: 0,
    sectorRealestate: 0,
    sectorComm: 0,
    sectorStaples: 0,
    usdEur: 1.08,
    usdJpy: 149.5,
    usdGbp: 1.27,
    usdCny: 7.24,
    oil: 78.3,
    gold: 2050.0,
    silver: 24.5,
    copper: 3.9,
    displayMode: 'price',
    tickCount: 0,
    marketState: 'open',
    latencyMs: 12,
    connectedFeeds: 8,
  }
}

export function initialState(): TickerState {
  return { dashboard: initialDashboard(), symbols: initialSymbols() }
}
