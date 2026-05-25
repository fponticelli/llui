// React implementation of the jfb-ticker benchmark. Uses useReducer at
// the top level for state, flushSync to force synchronous commits per
// iteration (so the loop semantics match LLui's per-tick flush), and
// React.memo on Row so unchanged rows skip re-rendering on partial
// updates. Without memo, React re-renders every row on any state
// change, which is the unoptimised baseline; with memo, this is what
// a competent React developer would ship.

import { memo, useReducer, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { initialState, initialDashboard } from '../../../shared/data.js'
import {
  generateTick,
  generateNarrowTick,
  generateChurn,
  nextDisplayMode,
} from '../../../shared/operations.js'
import { mulberry32, SEED } from '../../../shared/prng.js'
import type {
  Dashboard,
  DisplayMode,
  Symbol as SymbolRow,
  TickerState,
} from '../../../shared/types.js'

type OpKind = 'mount' | 'tick' | 'narrow' | 'toggle' | 'churn' | 'clear'

type RngBox = {
  rng: () => number
  nextSymbolId: number
}

function reducer(state: TickerState, action: { kind: OpKind; box: RngBox }): TickerState {
  const { kind, box } = action
  switch (kind) {
    case 'mount':
      box.rng = mulberry32(SEED)
      box.nextSymbolId = 201
      return initialState()
    case 'tick': {
      const tick = generateTick(
        box.rng,
        state.symbols.length,
        state.dashboard.tickCount,
        state.symbols,
      )
      const dashboard = { ...state.dashboard, ...tick.dashboardUpdates }
      const symbols = state.symbols.slice()
      for (const patch of tick.symbolUpdates) {
        const prev = symbols[patch.index]
        if (!prev) continue
        symbols[patch.index] = {
          ...prev,
          price: patch.price,
          change: patch.change,
          changePct: patch.changePct,
          volume: patch.volume,
          lastTickAt: patch.lastTickAt,
        }
      }
      return { dashboard, symbols }
    }
    case 'narrow': {
      const tick = generateNarrowTick(box.rng, state.dashboard.tickCount)
      return { ...state, dashboard: { ...state.dashboard, ...tick.dashboardUpdates } }
    }
    case 'toggle':
      return {
        ...state,
        dashboard: {
          ...state.dashboard,
          displayMode: nextDisplayMode(state.dashboard.displayMode),
          tickCount: state.dashboard.tickCount + 1,
        },
      }
    case 'churn': {
      const { newSymbols, nextId } = generateChurn(box.rng, 50, box.nextSymbolId)
      box.nextSymbolId = nextId
      return {
        dashboard: { ...state.dashboard, tickCount: state.dashboard.tickCount + 1 },
        symbols: [...state.symbols.slice(50), ...newSymbols],
      }
    }
    case 'clear':
      return {
        dashboard: { ...initialDashboard(), tickCount: state.dashboard.tickCount + 1 },
        symbols: [],
      }
  }
}

type RowProps = { sym: SymbolRow; mode: DisplayMode }

const Row = memo(
  function Row({ sym, mode }: RowProps) {
    return (
      <tr className={`mode-${mode}`}>
        <td>{sym.ticker}</td>
        <td className="col-price">{sym.price.toFixed(2)}</td>
        <td className="col-change">{sym.change.toFixed(2)}</td>
        <td className="col-change">{sym.changePct.toFixed(2)}</td>
        <td className="col-volume">{sym.volume}</td>
        <td>{sym.lastTickAt}</td>
      </tr>
    )
  },
  (prev, next) => prev.sym === next.sym && prev.mode === next.mode,
)

function Cell({ k, v, id }: { k: string; v: string | number; id?: string }) {
  return (
    <div className="ticker-cell">
      <span className="k">{k}</span>
      <span className="v" id={id}>
        {v}
      </span>
    </div>
  )
}

function App() {
  const [state, dispatch] = useReducer(reducer, undefined, initialState)
  const boxRef = useRef<RngBox>({ rng: mulberry32(SEED), nextSymbolId: 201 })

  function op(kind: OpKind, iters: number): void {
    for (let i = 0; i < iters; i++) {
      flushSync(() => dispatch({ kind, box: boxRef.current }))
    }
  }

  const d: Dashboard = state.dashboard
  return (
    <div id="ticker">
      <h1>React ticker</h1>

      <div className="ticker-grid">
        <Cell k="Index" v={d.indexValue.toFixed(2)} />
        <Cell k="Δ" v={d.indexChange.toFixed(2)} />
        <Cell k="Δ%" v={d.indexChangePct.toFixed(2)} />
        <Cell k="Tick" v={d.lastTick} />
        <Cell k="Adv" v={d.advancers} />
        <Cell k="Dec" v={d.decliners} />
        <Cell k="Unch" v={d.unchanged} />
        <Cell k="NH" v={d.newHighs} />
        <Cell k="Tech" v={d.sectorTech.toFixed(2)} />
        <Cell k="Fin" v={d.sectorFin.toFixed(2)} />
        <Cell k="Health" v={d.sectorHealth.toFixed(2)} />
        <Cell k="Energy" v={d.sectorEnergy.toFixed(2)} />
        <Cell k="Cons" v={d.sectorConsumer.toFixed(2)} />
        <Cell k="Ind" v={d.sectorIndustrial.toFixed(2)} />
        <Cell k="Util" v={d.sectorUtilities.toFixed(2)} />
        <Cell k="Mat" v={d.sectorMaterials.toFixed(2)} />
        <Cell k="RE" v={d.sectorRealestate.toFixed(2)} />
        <Cell k="Comm" v={d.sectorComm.toFixed(2)} />
        <Cell k="Stap" v={d.sectorStaples.toFixed(2)} />
        <Cell k="EUR" v={d.usdEur.toFixed(4)} />
        <Cell k="JPY" v={d.usdJpy.toFixed(2)} />
        <Cell k="GBP" v={d.usdGbp.toFixed(4)} />
        <Cell k="CNY" v={d.usdCny.toFixed(4)} />
        <Cell k="Oil" v={d.oil.toFixed(2)} />
        <Cell k="Gold" v={d.gold.toFixed(2)} />
        <Cell k="Slv" v={d.silver.toFixed(2)} />
        <Cell k="Cu" v={d.copper.toFixed(2)} />
        <Cell k="Mode" v={d.displayMode} />
        <Cell k="#" v={d.tickCount} id="ticker-counter" />
        <Cell k="Mkt" v={d.marketState} />
        <Cell k="Lat" v={d.latencyMs} />
        <Cell k="Feeds" v={d.connectedFeeds} />
      </div>

      <div className="controls">
        <button id="mount" type="button" className="btn" onClick={() => op('mount', 1)}>
          Mount 200
        </button>
        <button id="tick-1" type="button" className="btn" onClick={() => op('tick', 1)}>
          1 tick
        </button>
        <button id="tick-100" type="button" className="btn" onClick={() => op('tick', 100)}>
          100 ticks
        </button>
        <button id="burst-1k" type="button" className="btn" onClick={() => op('tick', 1000)}>
          Burst 1k
        </button>
        <button id="narrow-100" type="button" className="btn" onClick={() => op('narrow', 100)}>
          100 narrow
        </button>
        <button id="wide-toggle" type="button" className="btn" onClick={() => op('toggle', 1)}>
          Toggle mode
        </button>
        <button id="churn-50" type="button" className="btn" onClick={() => op('churn', 1)}>
          Churn 50
        </button>
        <button id="clear" type="button" className="btn" onClick={() => op('clear', 1)}>
          Clear
        </button>
      </div>

      <table id="symbols" className="ticker">
        <tbody>
          {state.symbols.map((sym) => (
            <Row key={sym.id} sym={sym} mode={d.displayMode} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

createRoot(document.getElementById('main')!).render(<App />)
