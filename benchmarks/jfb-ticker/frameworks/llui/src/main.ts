// LLui implementation of the jfb-ticker benchmark. See ../../SPEC.md for
// the operation list and why this component is shaped this way. The
// 32-cell dashboard is written inline (not via a `cell(label, getter)`
// helper) on purpose: the compiler's path tracker reads getter bodies
// at their AST location, so helpers hide state access behind a parameter
// and force a FULL_MASK fallback. Verbose but correct.

import { component, mountApp, div, span, table, tbody, tr, td, h1 } from '@llui/dom'
import { initialState, initialDashboard } from '../../../shared/data.js'
import {
  generateTick,
  generateNarrowTick,
  generateChurn,
  nextDisplayMode,
} from '../../../shared/operations.js'
import { mulberry32, SEED } from '../../../shared/prng.js'
import type { TickerState, Symbol as SymbolRow } from '../../../shared/types.js'
import { actionButton } from './action-button.js'

let rng = mulberry32(SEED)
let nextSymbolId = 201

type State = TickerState

type Msg =
  /** @intent("Mount the initial board: 200 symbols + dashboard at defaults") */
  | { type: 'mount' }
  /** @intent("Apply one tick: 2 random dashboard paths + 5 random symbol rows") */
  | { type: 'tick' }
  /** @intent("Apply one narrow tick: a single dashboard path, no symbol rows") */
  | { type: 'narrow' }
  /** @intent("Flip displayMode (price → change → volume)") */
  | { type: 'toggle' }
  /** @intent("Drop the first 50 symbols and append 50 fresh ones at the end") */
  | { type: 'churn' }
  /** @intent("Clear all symbols and reset the dashboard") */
  | { type: 'clear' }

const App = component<State, Msg, never>({
  name: 'Ticker',
  init: () => [initialState(), []],
  update: (state: State, msg: Msg): [State, never[]] => {
    switch (msg.type) {
      case 'mount': {
        rng = mulberry32(SEED)
        nextSymbolId = 201
        return [initialState(), []]
      }
      case 'tick': {
        const tick = generateTick(
          rng,
          state.symbols.length,
          state.dashboard.tickCount,
          state.symbols,
        )
        const newDash = { ...state.dashboard, ...tick.dashboardUpdates }
        const newSymbols = state.symbols.slice()
        for (const patch of tick.symbolUpdates) {
          const prev = newSymbols[patch.index]
          if (!prev) continue
          newSymbols[patch.index] = {
            ...prev,
            price: patch.price,
            change: patch.change,
            changePct: patch.changePct,
            volume: patch.volume,
            lastTickAt: patch.lastTickAt,
          }
        }
        return [{ dashboard: newDash, symbols: newSymbols }, []]
      }
      case 'narrow': {
        const tick = generateNarrowTick(rng, state.dashboard.tickCount)
        return [{ ...state, dashboard: { ...state.dashboard, ...tick.dashboardUpdates } }, []]
      }
      case 'toggle':
        return [
          {
            ...state,
            dashboard: {
              ...state.dashboard,
              displayMode: nextDisplayMode(state.dashboard.displayMode),
              tickCount: state.dashboard.tickCount + 1,
            },
          },
          [],
        ]
      case 'churn': {
        const { newSymbols, nextId } = generateChurn(rng, 50, nextSymbolId)
        nextSymbolId = nextId
        return [
          {
            dashboard: { ...state.dashboard, tickCount: state.dashboard.tickCount + 1 },
            symbols: [...state.symbols.slice(50), ...newSymbols],
          },
          [],
        ]
      }
      case 'clear':
        return [
          {
            dashboard: { ...initialDashboard(), tickCount: state.dashboard.tickCount + 1 },
            symbols: [],
          },
          [],
        ]
    }
  },
  view: ({ send, text, each }) => [
    div({ id: 'ticker' }, [
      h1([text(() => 'LLui ticker')]),

      // ── Dashboard: 32 cells × 32 reactive bindings, each pinned to one path ──
      div({ class: 'ticker-grid' }, [
        // Headline (4)
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text(() => 'Index')]),
          span({ class: 'v' }, [text((s: State) => s.dashboard.indexValue.toFixed(2))]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text(() => 'Δ')]),
          span({ class: 'v' }, [text((s: State) => s.dashboard.indexChange.toFixed(2))]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text(() => 'Δ%')]),
          span({ class: 'v' }, [text((s: State) => s.dashboard.indexChangePct.toFixed(2))]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text(() => 'Tick')]),
          span({ class: 'v' }, [text((s: State) => String(s.dashboard.lastTick))]),
        ]),
        // Breadth (4)
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text(() => 'Adv')]),
          span({ class: 'v' }, [text((s: State) => String(s.dashboard.advancers))]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text(() => 'Dec')]),
          span({ class: 'v' }, [text((s: State) => String(s.dashboard.decliners))]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text(() => 'Unch')]),
          span({ class: 'v' }, [text((s: State) => String(s.dashboard.unchanged))]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text(() => 'NH')]),
          span({ class: 'v' }, [text((s: State) => String(s.dashboard.newHighs))]),
        ]),
        // Sectors (11)
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text(() => 'Tech')]),
          span({ class: 'v' }, [text((s: State) => s.dashboard.sectorTech.toFixed(2))]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text(() => 'Fin')]),
          span({ class: 'v' }, [text((s: State) => s.dashboard.sectorFin.toFixed(2))]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text(() => 'Health')]),
          span({ class: 'v' }, [text((s: State) => s.dashboard.sectorHealth.toFixed(2))]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text(() => 'Energy')]),
          span({ class: 'v' }, [text((s: State) => s.dashboard.sectorEnergy.toFixed(2))]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text(() => 'Cons')]),
          span({ class: 'v' }, [text((s: State) => s.dashboard.sectorConsumer.toFixed(2))]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text(() => 'Ind')]),
          span({ class: 'v' }, [text((s: State) => s.dashboard.sectorIndustrial.toFixed(2))]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text(() => 'Util')]),
          span({ class: 'v' }, [text((s: State) => s.dashboard.sectorUtilities.toFixed(2))]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text(() => 'Mat')]),
          span({ class: 'v' }, [text((s: State) => s.dashboard.sectorMaterials.toFixed(2))]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text(() => 'RE')]),
          span({ class: 'v' }, [text((s: State) => s.dashboard.sectorRealestate.toFixed(2))]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text(() => 'Comm')]),
          span({ class: 'v' }, [text((s: State) => s.dashboard.sectorComm.toFixed(2))]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text(() => 'Stap')]),
          span({ class: 'v' }, [text((s: State) => s.dashboard.sectorStaples.toFixed(2))]),
        ]),
        // Currencies (4)
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text(() => 'EUR')]),
          span({ class: 'v' }, [text((s: State) => s.dashboard.usdEur.toFixed(4))]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text(() => 'JPY')]),
          span({ class: 'v' }, [text((s: State) => s.dashboard.usdJpy.toFixed(2))]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text(() => 'GBP')]),
          span({ class: 'v' }, [text((s: State) => s.dashboard.usdGbp.toFixed(4))]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text(() => 'CNY')]),
          span({ class: 'v' }, [text((s: State) => s.dashboard.usdCny.toFixed(4))]),
        ]),
        // Commodities (4)
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text(() => 'Oil')]),
          span({ class: 'v' }, [text((s: State) => s.dashboard.oil.toFixed(2))]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text(() => 'Gold')]),
          span({ class: 'v' }, [text((s: State) => s.dashboard.gold.toFixed(2))]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text(() => 'Slv')]),
          span({ class: 'v' }, [text((s: State) => s.dashboard.silver.toFixed(2))]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text(() => 'Cu')]),
          span({ class: 'v' }, [text((s: State) => s.dashboard.copper.toFixed(2))]),
        ]),
        // Mode (1) — drives the row class binding below; visible here too
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text(() => 'Mode')]),
          span({ class: 'v' }, [text((s: State) => s.dashboard.displayMode)]),
        ]),
        // Tick counter (1) — also the universal sync signal for jfb's harness.
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text(() => '#')]),
          span({ class: 'v', id: 'ticker-counter' }, [
            text((s: State) => String(s.dashboard.tickCount)),
          ]),
        ]),
        // Status (3)
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text(() => 'Mkt')]),
          span({ class: 'v' }, [text((s: State) => s.dashboard.marketState)]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text(() => 'Lat')]),
          span({ class: 'v' }, [text((s: State) => String(s.dashboard.latencyMs))]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text(() => 'Feeds')]),
          span({ class: 'v' }, [text((s: State) => String(s.dashboard.connectedFeeds))]),
        ]),
      ]),

      // ── Controls (jfb clickable, ids match SPEC operation list) ──
      div({ class: 'controls' }, [
        actionButton('mount', 'Mount 200', 'mount', 1, send),
        actionButton('tick-1', '1 tick', 'tick', 1, send),
        actionButton('tick-100', '100 ticks', 'tick', 100, send),
        actionButton('burst-1k', 'Burst 1k', 'tick', 1000, send),
        actionButton('narrow-100', '100 narrow', 'narrow', 100, send),
        actionButton('wide-toggle', 'Toggle mode', 'toggle', 1, send),
        actionButton('churn-50', 'Churn 50', 'churn', 1, send),
        actionButton('clear', 'Clear', 'clear', 1, send),
      ]),

      // ── Symbol list ──
      table({ id: 'symbols', class: 'ticker' }, [
        tbody(
          each<SymbolRow>({
            items: (s: State) => s.symbols,
            key: (sy: SymbolRow) => sy.id,
            render: ({ item }) => [
              tr({ class: (s: State) => `mode-${s.dashboard.displayMode}` }, [
                td([text(item.ticker)]),
                td({ class: 'col-price' }, [text(item((sy: SymbolRow) => sy.price.toFixed(2)))]),
                td({ class: 'col-change' }, [text(item((sy: SymbolRow) => sy.change.toFixed(2)))]),
                td({ class: 'col-change' }, [
                  text(item((sy: SymbolRow) => sy.changePct.toFixed(2))),
                ]),
                td({ class: 'col-volume' }, [text(item((sy: SymbolRow) => String(sy.volume)))]),
                td([text(item((sy: SymbolRow) => String(sy.lastTickAt)))]),
              ]),
            ],
          }),
        ),
      ]),
    ]),
  ],
})

mountApp(document.getElementById('main')!, App)
