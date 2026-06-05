// Solid implementation of the jfb-ticker benchmark. Uses createStore +
// produce() for fine-grained reactivity. Each setStore call propagates
// synchronously, so 100 calls in a row produce 100 commits — matching
// the LLui send+flush loop semantics.

import { render } from 'solid-js/web'
import { createStore, produce } from 'solid-js/store'
import { For, batch } from 'solid-js'
import { initialState, initialDashboard } from '../../../shared/data.js'
import {
  generateTick,
  generateNarrowTick,
  generateChurn,
  nextDisplayMode,
} from '../../../shared/operations.js'
import { mulberry32, SEED } from '../../../shared/prng.js'
import type { TickerState } from '../../../shared/types.js'

let rng = mulberry32(SEED)
let nextSymbolId = 201

const [state, setState] = createStore<TickerState>(initialState())

type OpKind = 'mount' | 'tick' | 'narrow' | 'toggle' | 'churn' | 'clear'

function op(kind: OpKind, iters: number): void {
  for (let i = 0; i < iters; i++) applyOnce(kind)
}

// Idiomatic coalesced burst (the `batch-1k` op): solid-js `batch` defers effect
// re-runs so all N store writes flush as ONE update.
function batchOp(kind: OpKind, iters: number): void {
  batch(() => {
    for (let i = 0; i < iters; i++) applyOnce(kind)
  })
}

function applyOnce(kind: OpKind): void {
  switch (kind) {
    case 'mount': {
      rng = mulberry32(SEED)
      nextSymbolId = 201
      setState(initialState())
      return
    }
    case 'tick': {
      const tick = generateTick(rng, state.symbols.length, state.dashboard.tickCount, state.symbols)
      setState(
        produce((s: TickerState) => {
          Object.assign(s.dashboard, tick.dashboardUpdates)
          for (const patch of tick.symbolUpdates) {
            const sym = s.symbols[patch.index]
            if (!sym) continue
            sym.price = patch.price
            sym.change = patch.change
            sym.changePct = patch.changePct
            sym.volume = patch.volume
            sym.lastTickAt = patch.lastTickAt
          }
        }),
      )
      return
    }
    case 'narrow': {
      const tick = generateNarrowTick(rng, state.dashboard.tickCount)
      setState(
        produce((s: TickerState) => {
          Object.assign(s.dashboard, tick.dashboardUpdates)
        }),
      )
      return
    }
    case 'toggle': {
      setState(
        produce((s: TickerState) => {
          s.dashboard.displayMode = nextDisplayMode(s.dashboard.displayMode)
          s.dashboard.tickCount += 1
        }),
      )
      return
    }
    case 'churn': {
      const { newSymbols, nextId } = generateChurn(rng, 50, nextSymbolId)
      nextSymbolId = nextId
      setState(
        produce((s: TickerState) => {
          s.symbols.splice(0, 50)
          s.symbols.push(...newSymbols)
          s.dashboard.tickCount += 1
        }),
      )
      return
    }
    case 'clear': {
      setState(
        produce((s: TickerState) => {
          const next = s.dashboard.tickCount + 1
          s.symbols = []
          s.dashboard = { ...initialDashboard(), tickCount: next }
        }),
      )
      return
    }
  }
}

function App() {
  return (
    <div id="ticker">
      <h1>Solid ticker</h1>

      <div class="ticker-grid">
        <div class="ticker-cell">
          <span class="k">Index</span>
          <span class="v">{state.dashboard.indexValue.toFixed(2)}</span>
        </div>
        <div class="ticker-cell">
          <span class="k">Δ</span>
          <span class="v">{state.dashboard.indexChange.toFixed(2)}</span>
        </div>
        <div class="ticker-cell">
          <span class="k">Δ%</span>
          <span class="v">{state.dashboard.indexChangePct.toFixed(2)}</span>
        </div>
        <div class="ticker-cell">
          <span class="k">Tick</span>
          <span class="v">{state.dashboard.lastTick}</span>
        </div>
        <div class="ticker-cell">
          <span class="k">Adv</span>
          <span class="v">{state.dashboard.advancers}</span>
        </div>
        <div class="ticker-cell">
          <span class="k">Dec</span>
          <span class="v">{state.dashboard.decliners}</span>
        </div>
        <div class="ticker-cell">
          <span class="k">Unch</span>
          <span class="v">{state.dashboard.unchanged}</span>
        </div>
        <div class="ticker-cell">
          <span class="k">NH</span>
          <span class="v">{state.dashboard.newHighs}</span>
        </div>
        <div class="ticker-cell">
          <span class="k">Tech</span>
          <span class="v">{state.dashboard.sectorTech.toFixed(2)}</span>
        </div>
        <div class="ticker-cell">
          <span class="k">Fin</span>
          <span class="v">{state.dashboard.sectorFin.toFixed(2)}</span>
        </div>
        <div class="ticker-cell">
          <span class="k">Health</span>
          <span class="v">{state.dashboard.sectorHealth.toFixed(2)}</span>
        </div>
        <div class="ticker-cell">
          <span class="k">Energy</span>
          <span class="v">{state.dashboard.sectorEnergy.toFixed(2)}</span>
        </div>
        <div class="ticker-cell">
          <span class="k">Cons</span>
          <span class="v">{state.dashboard.sectorConsumer.toFixed(2)}</span>
        </div>
        <div class="ticker-cell">
          <span class="k">Ind</span>
          <span class="v">{state.dashboard.sectorIndustrial.toFixed(2)}</span>
        </div>
        <div class="ticker-cell">
          <span class="k">Util</span>
          <span class="v">{state.dashboard.sectorUtilities.toFixed(2)}</span>
        </div>
        <div class="ticker-cell">
          <span class="k">Mat</span>
          <span class="v">{state.dashboard.sectorMaterials.toFixed(2)}</span>
        </div>
        <div class="ticker-cell">
          <span class="k">RE</span>
          <span class="v">{state.dashboard.sectorRealestate.toFixed(2)}</span>
        </div>
        <div class="ticker-cell">
          <span class="k">Comm</span>
          <span class="v">{state.dashboard.sectorComm.toFixed(2)}</span>
        </div>
        <div class="ticker-cell">
          <span class="k">Stap</span>
          <span class="v">{state.dashboard.sectorStaples.toFixed(2)}</span>
        </div>
        <div class="ticker-cell">
          <span class="k">EUR</span>
          <span class="v">{state.dashboard.usdEur.toFixed(4)}</span>
        </div>
        <div class="ticker-cell">
          <span class="k">JPY</span>
          <span class="v">{state.dashboard.usdJpy.toFixed(2)}</span>
        </div>
        <div class="ticker-cell">
          <span class="k">GBP</span>
          <span class="v">{state.dashboard.usdGbp.toFixed(4)}</span>
        </div>
        <div class="ticker-cell">
          <span class="k">CNY</span>
          <span class="v">{state.dashboard.usdCny.toFixed(4)}</span>
        </div>
        <div class="ticker-cell">
          <span class="k">Oil</span>
          <span class="v">{state.dashboard.oil.toFixed(2)}</span>
        </div>
        <div class="ticker-cell">
          <span class="k">Gold</span>
          <span class="v">{state.dashboard.gold.toFixed(2)}</span>
        </div>
        <div class="ticker-cell">
          <span class="k">Slv</span>
          <span class="v">{state.dashboard.silver.toFixed(2)}</span>
        </div>
        <div class="ticker-cell">
          <span class="k">Cu</span>
          <span class="v">{state.dashboard.copper.toFixed(2)}</span>
        </div>
        <div class="ticker-cell">
          <span class="k">Mode</span>
          <span class="v">{state.dashboard.displayMode}</span>
        </div>
        <div class="ticker-cell">
          <span class="k">#</span>
          <span class="v" id="ticker-counter">
            {state.dashboard.tickCount}
          </span>
        </div>
        <div class="ticker-cell">
          <span class="k">Mkt</span>
          <span class="v">{state.dashboard.marketState}</span>
        </div>
        <div class="ticker-cell">
          <span class="k">Lat</span>
          <span class="v">{state.dashboard.latencyMs}</span>
        </div>
        <div class="ticker-cell">
          <span class="k">Feeds</span>
          <span class="v">{state.dashboard.connectedFeeds}</span>
        </div>
      </div>

      <div class="controls">
        <button id="mount" type="button" class="btn" onClick={() => op('mount', 1)}>
          Mount 200
        </button>
        <button id="tick-1" type="button" class="btn" onClick={() => op('tick', 1)}>
          1 tick
        </button>
        <button id="tick-100" type="button" class="btn" onClick={() => op('tick', 100)}>
          100 ticks
        </button>
        <button id="burst-1k" type="button" class="btn" onClick={() => op('tick', 1000)}>
          Burst 1k
        </button>
        <button id="batch-1k" type="button" class="btn" onClick={() => batchOp('tick', 1000)}>
          Batch 1k
        </button>
        <button id="narrow-100" type="button" class="btn" onClick={() => op('narrow', 100)}>
          100 narrow
        </button>
        <button id="wide-toggle" type="button" class="btn" onClick={() => op('toggle', 1)}>
          Toggle mode
        </button>
        <button id="churn-50" type="button" class="btn" onClick={() => op('churn', 1)}>
          Churn 50
        </button>
        <button id="clear" type="button" class="btn" onClick={() => op('clear', 1)}>
          Clear
        </button>
      </div>

      <table id="symbols" class="ticker">
        <tbody>
          <For each={state.symbols}>
            {(sym) => (
              <tr class={`mode-${state.dashboard.displayMode}`}>
                <td>{sym.ticker}</td>
                <td class="col-price">{sym.price.toFixed(2)}</td>
                <td class="col-change">{sym.change.toFixed(2)}</td>
                <td class="col-change">{sym.changePct.toFixed(2)}</td>
                <td class="col-volume">{sym.volume}</td>
                <td>{sym.lastTickAt}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  )
}

render(() => <App />, document.getElementById('main')!)
