// Investigation: where does the time go in a jfb-shape Select op?
//
// The Option B perf microbench showed flat and registry dispatch are
// tied. But jfb's Select op shows a +9–34 % regression vs LLui's own
// April 2026 baseline. Where does the time actually go?
//
// jfb's Select shape: 1000 rows in `each()`, each row has a `selected`
// class accessor reading `state.selected === item.id`. A select msg
// changes `state.selected` (clears old row, sets new row).
//
// Per-row class bindings live on each row's scope and are wired via
// `addCheckedItemUpdater` (lifetime.ts) — they bypass Phase 2 entirely
// and fire from each.reconcileChanged. So neither flat nor registry
// dispatch is on the Select hot path.
//
// This file is a vitest-bench guarded by LLUI_PERF=1. It splits the
// Select op into mount + first-render and select-update phases so we
// can see which dominates. Run with:
//
//   LLUI_PERF=1 pnpm --filter @llui/dom vitest run select-perf-investigation

import { describe, it } from 'vitest'
import { mountApp } from '../src/mount'
import { div } from '../src/elements'
import { text } from '../src/primitives/text'
import { each } from '../src/primitives/each'
import type { ComponentDef } from '../src/types'

type Item = { id: number; label: string }
type State = { items: Item[]; selected: number | null }
type Msg = { type: 'select'; id: number }

function makeJfbShape(itemCount: number): ComponentDef<State, Msg, never> {
  const items: Item[] = Array.from({ length: itemCount }, (_, i) => ({
    id: i,
    label: `item ${i}`,
  }))
  return {
    name: 'JfbShape',
    init: () => [{ items, selected: null }, []],
    update: (s, m) => {
      switch (m.type) {
        case 'select':
          return [{ ...s, selected: m.id }, []]
      }
    },
    view: () =>
      each<State, Item>({
        items: (s) => s.items,
        key: (item) => item.id,
        render: ({ item }) => [
          div(
            {
              'data-id': item((i) => String(i.id)),
              class: (s: State) => (s.selected === item((i) => i.id)() ? 'selected' : ''),
            },
            [text(item((i) => i.label))],
          ),
        ],
      }),
    __prefixes: [(s) => s.items, (s) => s.selected],
    __compilerVersion: '__test__',
  }
}

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b)
  const m = sorted.length >> 1
  return sorted.length % 2 === 0 ? (sorted[m - 1]! + sorted[m]!) / 2 : sorted[m]!
}

const PERF_ENABLED = ((): boolean => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return Boolean((globalThis as any).process?.env?.LLUI_PERF)
  } catch {
    return false
  }
})()

describe.skipIf(!PERF_ENABLED)('Select perf investigation — jfb shape', () => {
  for (const N of [100, 500, 1000]) {
    it(`mount + select cycle — ${N} rows`, () => {
      const ITERS = 30

      // Warm-up: builds + JITs without measuring
      for (let w = 0; w < 3; w++) {
        const def = makeJfbShape(N)
        const c = document.createElement('div')
        const h = mountApp(c, def)
        h.send({ type: 'select', id: N >> 1 })
        h.flush()
        h.dispose()
      }

      const mountSamples: number[] = []
      const selectSamples: number[] = []
      const selectAgainSamples: number[] = []

      for (let i = 0; i < ITERS; i++) {
        const def = makeJfbShape(N)
        const container = document.createElement('div')

        const mountStart = performance.now()
        const handle = mountApp(container, def)
        const mountEnd = performance.now()
        mountSamples.push(mountEnd - mountStart)

        const selectStart = performance.now()
        handle.send({ type: 'select', id: 5 })
        handle.flush()
        const selectEnd = performance.now()
        selectSamples.push(selectEnd - selectStart)

        const selectAgainStart = performance.now()
        handle.send({ type: 'select', id: N - 5 })
        handle.flush()
        const selectAgainEnd = performance.now()
        selectAgainSamples.push(selectAgainEnd - selectAgainStart)

        handle.dispose()
      }

      const m = median(mountSamples)
      const s1 = median(selectSamples)
      const s2 = median(selectAgainSamples)

      const line = `[N=${N}] mount=${m.toFixed(2)}ms select(null→k)=${s1.toFixed(3)}ms select(k→j)=${s2.toFixed(3)}ms`
      console.log(line)
    })
  }

  it('time the breakdown — accessor calls vs DOM mutations at N=1000', () => {
    // Try to isolate where the time goes inside a single Select. We
    // can't instrument the runtime, but we CAN time pure DOM mutation
    // and accessor work as separate microbenches against the same
    // node count.
    const ITERS = 100

    // Test 1: bare DOM mutation cost — toggle a class on 2 elements.
    const root = document.createElement('div')
    const cells: HTMLElement[] = []
    for (let i = 0; i < 1000; i++) {
      const c = document.createElement('div')
      c.setAttribute('data-id', String(i))
      cells.push(c)
      root.appendChild(c)
    }

    const bareDom: number[] = []
    for (let i = 0; i < ITERS; i++) {
      const oldIdx = (i * 7) % 1000
      const newIdx = (i * 13) % 1000
      const t0 = performance.now()
      cells[oldIdx]!.setAttribute('class', '')
      cells[newIdx]!.setAttribute('class', 'selected')
      const t1 = performance.now()
      bareDom.push(t1 - t0)
    }

    // Test 2: arrow-function evaluation cost — call 1000 zero-arg
    // arrows (matches the per-row accessor shape).
    let counter = 0
    const accessors: Array<() => string> = []
    for (let i = 0; i < 1000; i++) {
      const id = i
      accessors.push(() => (counter === id ? 'selected' : ''))
    }
    const accessorCost: number[] = []
    for (let i = 0; i < ITERS; i++) {
      counter = i % 1000
      const t0 = performance.now()
      let total = 0
      for (let j = 0; j < 1000; j++) total += accessors[j]!().length
      const t1 = performance.now()
      accessorCost.push(t1 - t0)
      if (total < 0) console.log(total) // prevent dead-code elimination
    }

    const bareMed = median(bareDom)
    const accMed = median(accessorCost)
    const line = `[breakdown] bare-dom-2-class-toggles=${bareMed.toFixed(3)}ms 1000-arrow-evals=${accMed.toFixed(3)}ms`
    console.log(line)
  })
})
