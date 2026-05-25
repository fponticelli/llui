// Framework-agnostic types shared by every ticker implementation.
// These are the contract — DOM structure, state shape, and operation
// semantics must match across frameworks for the comparison to be fair.

export type DisplayMode = 'price' | 'change' | 'volume'

export type MarketState = 'open' | 'closed' | 'pre' | 'post'

export type Symbol = {
  id: number
  ticker: string
  price: number
  change: number
  changePct: number
  volume: number
  lastTickAt: number
}

// 32 scalar paths — crosses the 31-path lo-mask boundary on purpose
// so LLui emits maskHi. This is the case under test.
export type Dashboard = {
  // Headline (4)
  indexValue: number
  indexChange: number
  indexChangePct: number
  lastTick: number
  // Breadth (4)
  advancers: number
  decliners: number
  unchanged: number
  newHighs: number
  // Sectors (11)
  sectorTech: number
  sectorFin: number
  sectorHealth: number
  sectorEnergy: number
  sectorConsumer: number
  sectorIndustrial: number
  sectorUtilities: number
  sectorMaterials: number
  sectorRealestate: number
  sectorComm: number
  sectorStaples: number
  // Currencies (4)
  usdEur: number
  usdJpy: number
  usdGbp: number
  usdCny: number
  // Commodities (4)
  oil: number
  gold: number
  silver: number
  copper: number
  // Display mode (1) — cross-cutting, drives row visible columns
  displayMode: DisplayMode
  // Tick counter (1)
  tickCount: number
  // Status (3)
  marketState: MarketState
  latencyMs: number
  connectedFeeds: number
}

export type TickerState = {
  dashboard: Dashboard
  symbols: Symbol[]
}

// A tick is a pure data description of what changes. Each framework
// converts this into its own update style (immutable replace, mutation,
// signal write, ...). Generation lives in operations.ts.
export type SymbolPatch = {
  index: number
  price: number
  change: number
  changePct: number
  volume: number
  lastTickAt: number
}

export type Tick = {
  dashboardUpdates: Partial<Dashboard>
  symbolUpdates: SymbolPatch[]
}
