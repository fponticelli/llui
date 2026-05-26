// Vanilla JS implementation of the jfb-ticker benchmark. This is the
// floor: hand-tuned imperative DOM. Anything slower than this in another
// framework is overhead the framework adds.
//
// Strategy: hold mutable state, pre-create all 32 dashboard cells and
// 200 symbol rows, keep direct references to the textContent-bearing
// nodes, and on each operation poke only the nodes that changed.

import { initialState, initialDashboard, SYMBOL_COUNT } from '../../../shared/data.js'
import {
  generateTick,
  generateNarrowTick,
  generateChurn,
  nextDisplayMode,
  TICKABLE_PATHS,
} from '../../../shared/operations.js'
import { mulberry32, SEED } from '../../../shared/prng.js'
import type { Dashboard, Symbol as SymbolRow, TickerState } from '../../../shared/types.js'

let rng = mulberry32(SEED)
let nextSymbolId = 201
let state: TickerState = initialState()

// ── Element refs ─────────────────────────────────────────────────

type DashboardRefs = Record<keyof Dashboard, Text>
const dashRefs = {} as DashboardRefs

type RowRefs = {
  root: HTMLTableRowElement
  ticker: Text
  price: Text
  change: Text
  changePct: Text
  volume: Text
  lastTickAt: Text
}
const rowRefs = new Map<number, RowRefs>()
let tbody!: HTMLTableSectionElement

// ── Build initial DOM ────────────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v
    else node.setAttribute(k, v)
  }
  for (const c of children) {
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)
  }
  return node
}

function buildDashboardCell(
  label: string,
  key: keyof Dashboard,
  initialValue: string,
): HTMLElement {
  const valNode = document.createTextNode(initialValue)
  dashRefs[key] = valNode
  const attrs: Record<string, string> = { class: 'v' }
  // The `tickCount` cell doubles as the universal sync signal for jfb's harness.
  if (key === 'tickCount') attrs.id = 'ticker-counter'
  const v = el('span', attrs)
  v.appendChild(valNode)
  return el('div', { class: 'ticker-cell' }, [el('span', { class: 'k' }, [label]), v])
}

function fmt(key: keyof Dashboard, value: Dashboard[typeof key]): string {
  if (typeof value === 'number') {
    if (key === 'usdEur' || key === 'usdGbp' || key === 'usdCny') return value.toFixed(4)
    if (Number.isInteger(value)) return String(value)
    return value.toFixed(2)
  }
  return String(value)
}

function buildRow(sym: SymbolRow, displayMode: string): HTMLTableRowElement {
  const ticker = document.createTextNode(sym.ticker)
  const price = document.createTextNode(sym.price.toFixed(2))
  const change = document.createTextNode(sym.change.toFixed(2))
  const changePct = document.createTextNode(sym.changePct.toFixed(2))
  const volume = document.createTextNode(String(sym.volume))
  const lastTickAt = document.createTextNode(String(sym.lastTickAt))

  const row = el('tr', { class: `mode-${displayMode}` }, [
    el('td', {}, [ticker]),
    el('td', { class: 'col-price' }, [price]),
    el('td', { class: 'col-change' }, [change]),
    el('td', { class: 'col-change' }, [changePct]),
    el('td', { class: 'col-volume' }, [volume]),
    el('td', {}, [lastTickAt]),
  ])
  rowRefs.set(sym.id, { root: row, ticker, price, change, changePct, volume, lastTickAt })
  return row
}

function buildApp(): HTMLElement {
  const grid = el('div', { class: 'ticker-grid' })
  grid.appendChild(
    buildDashboardCell('Index', 'indexValue', fmt('indexValue', state.dashboard.indexValue)),
  )
  grid.appendChild(
    buildDashboardCell('Δ', 'indexChange', fmt('indexChange', state.dashboard.indexChange)),
  )
  grid.appendChild(
    buildDashboardCell(
      'Δ%',
      'indexChangePct',
      fmt('indexChangePct', state.dashboard.indexChangePct),
    ),
  )
  grid.appendChild(
    buildDashboardCell('Tick', 'lastTick', fmt('lastTick', state.dashboard.lastTick)),
  )
  grid.appendChild(
    buildDashboardCell('Adv', 'advancers', fmt('advancers', state.dashboard.advancers)),
  )
  grid.appendChild(
    buildDashboardCell('Dec', 'decliners', fmt('decliners', state.dashboard.decliners)),
  )
  grid.appendChild(
    buildDashboardCell('Unch', 'unchanged', fmt('unchanged', state.dashboard.unchanged)),
  )
  grid.appendChild(buildDashboardCell('NH', 'newHighs', fmt('newHighs', state.dashboard.newHighs)))
  grid.appendChild(
    buildDashboardCell('Tech', 'sectorTech', fmt('sectorTech', state.dashboard.sectorTech)),
  )
  grid.appendChild(
    buildDashboardCell('Fin', 'sectorFin', fmt('sectorFin', state.dashboard.sectorFin)),
  )
  grid.appendChild(
    buildDashboardCell('Health', 'sectorHealth', fmt('sectorHealth', state.dashboard.sectorHealth)),
  )
  grid.appendChild(
    buildDashboardCell('Energy', 'sectorEnergy', fmt('sectorEnergy', state.dashboard.sectorEnergy)),
  )
  grid.appendChild(
    buildDashboardCell(
      'Cons',
      'sectorConsumer',
      fmt('sectorConsumer', state.dashboard.sectorConsumer),
    ),
  )
  grid.appendChild(
    buildDashboardCell(
      'Ind',
      'sectorIndustrial',
      fmt('sectorIndustrial', state.dashboard.sectorIndustrial),
    ),
  )
  grid.appendChild(
    buildDashboardCell(
      'Util',
      'sectorUtilities',
      fmt('sectorUtilities', state.dashboard.sectorUtilities),
    ),
  )
  grid.appendChild(
    buildDashboardCell(
      'Mat',
      'sectorMaterials',
      fmt('sectorMaterials', state.dashboard.sectorMaterials),
    ),
  )
  grid.appendChild(
    buildDashboardCell(
      'RE',
      'sectorRealestate',
      fmt('sectorRealestate', state.dashboard.sectorRealestate),
    ),
  )
  grid.appendChild(
    buildDashboardCell('Comm', 'sectorComm', fmt('sectorComm', state.dashboard.sectorComm)),
  )
  grid.appendChild(
    buildDashboardCell(
      'Stap',
      'sectorStaples',
      fmt('sectorStaples', state.dashboard.sectorStaples),
    ),
  )
  grid.appendChild(buildDashboardCell('EUR', 'usdEur', fmt('usdEur', state.dashboard.usdEur)))
  grid.appendChild(buildDashboardCell('JPY', 'usdJpy', fmt('usdJpy', state.dashboard.usdJpy)))
  grid.appendChild(buildDashboardCell('GBP', 'usdGbp', fmt('usdGbp', state.dashboard.usdGbp)))
  grid.appendChild(buildDashboardCell('CNY', 'usdCny', fmt('usdCny', state.dashboard.usdCny)))
  grid.appendChild(buildDashboardCell('Oil', 'oil', fmt('oil', state.dashboard.oil)))
  grid.appendChild(buildDashboardCell('Gold', 'gold', fmt('gold', state.dashboard.gold)))
  grid.appendChild(buildDashboardCell('Slv', 'silver', fmt('silver', state.dashboard.silver)))
  grid.appendChild(buildDashboardCell('Cu', 'copper', fmt('copper', state.dashboard.copper)))
  grid.appendChild(buildDashboardCell('Mode', 'displayMode', state.dashboard.displayMode))
  grid.appendChild(
    buildDashboardCell('#', 'tickCount', fmt('tickCount', state.dashboard.tickCount)),
  )
  grid.appendChild(buildDashboardCell('Mkt', 'marketState', state.dashboard.marketState))
  grid.appendChild(
    buildDashboardCell('Lat', 'latencyMs', fmt('latencyMs', state.dashboard.latencyMs)),
  )
  grid.appendChild(
    buildDashboardCell(
      'Feeds',
      'connectedFeeds',
      fmt('connectedFeeds', state.dashboard.connectedFeeds),
    ),
  )

  const controls = el('div', { class: 'controls' }, [
    btn('mount', 'Mount 200', () => op('mount', 1)),
    btn('tick-1', '1 tick', () => op('tick', 1)),
    btn('tick-100', '100 ticks', () => op('tick', 100)),
    btn('burst-1k', 'Burst 1k', () => op('tick', 1000)),
    btn('narrow-100', '100 narrow', () => op('narrow', 100)),
    btn('wide-toggle', 'Toggle mode', () => op('toggle', 1)),
    btn('churn-50', 'Churn 50', () => op('churn', 1)),
    btn('clear', 'Clear', () => op('clear', 1)),
  ])

  tbody = el('tbody')
  for (const sym of state.symbols) tbody.appendChild(buildRow(sym, state.dashboard.displayMode))
  const symTable = el('table', { id: 'symbols', class: 'ticker' }, [tbody])

  return el('div', { id: 'ticker' }, [el('h1', {}, ['Vanilla ticker']), grid, controls, symTable])
}

function btn(id: string, label: string, handler: () => void): HTMLButtonElement {
  const b = el('button', { id, type: 'button', class: 'btn' }, [label])
  b.addEventListener('click', handler)
  return b
}

// ── Operations ───────────────────────────────────────────────────

type OpKind = 'mount' | 'tick' | 'narrow' | 'toggle' | 'churn' | 'clear'

function op(kind: OpKind, iters: number): void {
  for (let i = 0; i < iters; i++) applyOnce(kind)
}

function applyOnce(kind: OpKind): void {
  switch (kind) {
    case 'mount':
      remount()
      return
    case 'tick': {
      const tick = generateTick(rng, state.symbols.length, state.dashboard.tickCount, state.symbols)
      for (const [k, v] of Object.entries(tick.dashboardUpdates)) {
        ;(state.dashboard as Record<string, unknown>)[k] = v
        const ref = dashRefs[k as keyof Dashboard]
        if (ref) ref.data = fmt(k as keyof Dashboard, v as Dashboard[keyof Dashboard])
      }
      for (const patch of tick.symbolUpdates) {
        const sym = state.symbols[patch.index]
        if (!sym) continue
        sym.price = patch.price
        sym.change = patch.change
        sym.changePct = patch.changePct
        sym.volume = patch.volume
        sym.lastTickAt = patch.lastTickAt
        const refs = rowRefs.get(sym.id)
        if (refs) {
          refs.price.data = patch.price.toFixed(2)
          refs.change.data = patch.change.toFixed(2)
          refs.changePct.data = patch.changePct.toFixed(2)
          refs.volume.data = String(patch.volume)
          refs.lastTickAt.data = String(patch.lastTickAt)
        }
      }
      return
    }
    case 'narrow': {
      const tick = generateNarrowTick(rng, state.dashboard.tickCount)
      for (const [k, v] of Object.entries(tick.dashboardUpdates)) {
        ;(state.dashboard as Record<string, unknown>)[k] = v
        const ref = dashRefs[k as keyof Dashboard]
        if (ref) ref.data = fmt(k as keyof Dashboard, v as Dashboard[keyof Dashboard])
      }
      return
    }
    case 'toggle': {
      state.dashboard.displayMode = nextDisplayMode(state.dashboard.displayMode)
      state.dashboard.tickCount += 1
      dashRefs.displayMode.data = state.dashboard.displayMode
      dashRefs.tickCount.data = String(state.dashboard.tickCount)
      const cls = `mode-${state.dashboard.displayMode}`
      for (const refs of rowRefs.values()) refs.root.className = cls
      return
    }
    case 'churn': {
      const { newSymbols, nextId } = generateChurn(rng, 50, nextSymbolId)
      nextSymbolId = nextId
      // Remove first 50
      for (let i = 0; i < 50; i++) {
        const dropped = state.symbols[i]
        if (!dropped) continue
        const refs = rowRefs.get(dropped.id)
        if (refs) {
          refs.root.remove()
          rowRefs.delete(dropped.id)
        }
      }
      state.symbols = [...state.symbols.slice(50), ...newSymbols]
      // Append new
      for (const sym of newSymbols) tbody.appendChild(buildRow(sym, state.dashboard.displayMode))
      state.dashboard.tickCount += 1
      dashRefs.tickCount.data = String(state.dashboard.tickCount)
      return
    }
    case 'clear': {
      const nextTickCount = state.dashboard.tickCount + 1
      state.symbols = []
      state.dashboard = { ...initialDashboard(), tickCount: nextTickCount }
      rowRefs.clear()
      tbody.replaceChildren()
      // Re-render dashboard text
      for (const key of Object.keys(state.dashboard) as (keyof Dashboard)[]) {
        const ref = dashRefs[key]
        if (ref) ref.data = fmt(key, state.dashboard[key])
      }
      return
    }
  }
}

function remount(): void {
  rng = mulberry32(SEED)
  nextSymbolId = 201
  state = initialState()
  rowRefs.clear()
  document.getElementById('main')!.replaceChildren(buildApp())
}

// Touch unused imports to keep them in scope (silences unused-import lint)
void SYMBOL_COUNT
void TICKABLE_PATHS

// ── Boot ─────────────────────────────────────────────────────────

document.getElementById('main')!.appendChild(buildApp())
