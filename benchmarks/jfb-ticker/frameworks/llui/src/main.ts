// LLui SIGNALS implementation of the jfb-ticker benchmark. See ../../SPEC.md.
// A 32-cell dashboard (32 distinct reactive paths — exercises chunked masks past
// the old 31-bit limit) plus a 200-row keyed table whose rows read BOTH their
// item AND the component's displayMode (multi-root each → the `wide-toggle`
// per-row fan-out the SPEC measures).
//
// init/update/Msg are plain TEA (unchanged from the legacy impl). The view uses
// the signal authoring surface; the compiler lowers it.

import { component, mountApp, div, span, table, tbody, tr, td, h1, text, each } from '@llui/dom'
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
  view: ({ state, send }) => [
    div({ id: 'ticker' }, [
      h1({}, [text('LLui ticker')]),

      // ── Dashboard: 32 cells, each pinned to one state path (chunked masks) ──
      div({ class: 'ticker-grid' }, [
        // Headline (4)
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text('Index')]),
          span({ class: 'v' }, [text(state.at('dashboard.indexValue').map((v) => v.toFixed(2)))]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text('Δ')]),
          span({ class: 'v' }, [text(state.at('dashboard.indexChange').map((v) => v.toFixed(2)))]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text('Δ%')]),
          span({ class: 'v' }, [
            text(state.at('dashboard.indexChangePct').map((v) => v.toFixed(2))),
          ]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text('Tick')]),
          span({ class: 'v' }, [text(state.at('dashboard.lastTick').map(String))]),
        ]),
        // Breadth (4)
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text('Adv')]),
          span({ class: 'v' }, [text(state.at('dashboard.advancers').map(String))]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text('Dec')]),
          span({ class: 'v' }, [text(state.at('dashboard.decliners').map(String))]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text('Unch')]),
          span({ class: 'v' }, [text(state.at('dashboard.unchanged').map(String))]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text('NH')]),
          span({ class: 'v' }, [text(state.at('dashboard.newHighs').map(String))]),
        ]),
        // Sectors (11)
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text('Tech')]),
          span({ class: 'v' }, [text(state.at('dashboard.sectorTech').map((v) => v.toFixed(2)))]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text('Fin')]),
          span({ class: 'v' }, [text(state.at('dashboard.sectorFin').map((v) => v.toFixed(2)))]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text('Health')]),
          span({ class: 'v' }, [text(state.at('dashboard.sectorHealth').map((v) => v.toFixed(2)))]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text('Energy')]),
          span({ class: 'v' }, [text(state.at('dashboard.sectorEnergy').map((v) => v.toFixed(2)))]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text('Cons')]),
          span({ class: 'v' }, [
            text(state.at('dashboard.sectorConsumer').map((v) => v.toFixed(2))),
          ]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text('Ind')]),
          span({ class: 'v' }, [
            text(state.at('dashboard.sectorIndustrial').map((v) => v.toFixed(2))),
          ]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text('Util')]),
          span({ class: 'v' }, [
            text(state.at('dashboard.sectorUtilities').map((v) => v.toFixed(2))),
          ]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text('Mat')]),
          span({ class: 'v' }, [
            text(state.at('dashboard.sectorMaterials').map((v) => v.toFixed(2))),
          ]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text('RE')]),
          span({ class: 'v' }, [
            text(state.at('dashboard.sectorRealestate').map((v) => v.toFixed(2))),
          ]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text('Comm')]),
          span({ class: 'v' }, [text(state.at('dashboard.sectorComm').map((v) => v.toFixed(2)))]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text('Stap')]),
          span({ class: 'v' }, [
            text(state.at('dashboard.sectorStaples').map((v) => v.toFixed(2))),
          ]),
        ]),
        // Currencies (4)
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text('EUR')]),
          span({ class: 'v' }, [text(state.at('dashboard.usdEur').map((v) => v.toFixed(4)))]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text('JPY')]),
          span({ class: 'v' }, [text(state.at('dashboard.usdJpy').map((v) => v.toFixed(2)))]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text('GBP')]),
          span({ class: 'v' }, [text(state.at('dashboard.usdGbp').map((v) => v.toFixed(4)))]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text('CNY')]),
          span({ class: 'v' }, [text(state.at('dashboard.usdCny').map((v) => v.toFixed(4)))]),
        ]),
        // Commodities (4)
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text('Oil')]),
          span({ class: 'v' }, [text(state.at('dashboard.oil').map((v) => v.toFixed(2)))]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text('Gold')]),
          span({ class: 'v' }, [text(state.at('dashboard.gold').map((v) => v.toFixed(2)))]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text('Slv')]),
          span({ class: 'v' }, [text(state.at('dashboard.silver').map((v) => v.toFixed(2)))]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text('Cu')]),
          span({ class: 'v' }, [text(state.at('dashboard.copper').map((v) => v.toFixed(2)))]),
        ]),
        // Mode (1)
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text('Mode')]),
          span({ class: 'v' }, [text(state.at('dashboard.displayMode'))]),
        ]),
        // Tick counter (1) — jfb's universal sync signal
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text('#')]),
          span({ class: 'v', id: 'ticker-counter' }, [
            text(state.at('dashboard.tickCount').map(String)),
          ]),
        ]),
        // Status (3)
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text('Mkt')]),
          span({ class: 'v' }, [text(state.at('dashboard.marketState'))]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text('Lat')]),
          span({ class: 'v' }, [text(state.at('dashboard.latencyMs').map(String))]),
        ]),
        div({ class: 'ticker-cell' }, [
          span({ class: 'k' }, [text('Feeds')]),
          span({ class: 'v' }, [text(state.at('dashboard.connectedFeeds').map(String))]),
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

      // ── Symbol list: multi-root each — rows read item fields AND the shared
      // displayMode (the wide-toggle fan-out the SPEC measures) ──
      table({ id: 'symbols', class: 'ticker' }, [
        tbody({}, [
          each<SymbolRow>(state.at('symbols'), {
            key: (sy) => sy.id,
            render: (item) => [
              tr({ class: state.at('dashboard.displayMode').map((m) => `mode-${m}`) }, [
                td({}, [text(item.at('ticker'))]),
                td({ class: 'col-price' }, [text(item.at('price').map((p) => p.toFixed(2)))]),
                td({ class: 'col-change' }, [text(item.at('change').map((c) => c.toFixed(2)))]),
                td({ class: 'col-change' }, [text(item.at('changePct').map((c) => c.toFixed(2)))]),
                td({ class: 'col-volume' }, [text(item.at('volume').map(String))]),
                td({}, [text(item.at('lastTickAt').map(String))]),
              ]),
            ],
          }),
        ]),
      ]),
    ]),
  ],
})

mountApp(document.getElementById('main')!, App)
