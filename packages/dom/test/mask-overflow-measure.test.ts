import { describe, it } from 'vitest'
import { mountApp } from '../src/mount'
import { elSplit } from '../src/el-split'
import { FULL_MASK } from '../src/update-loop'
import type { ComponentDef } from '../src/types'

/**
 * Measures the runtime cost of FULL_MASK fallback vs ideal per-binding
 * bit masks. Skipped by default — run with `vitest run mask-overflow-measure`
 * to reproduce.
 *
 * Findings (jsdom, 2000 updates, median of 5 runs):
 *
 *   31 paths IDEAL    1.40 ms     (1 accessor re-runs per update)
 *   31 paths FULL     2.18 ms     (31 accessors re-run, 1.56x)
 *   40 paths FULL     3.76 ms
 *   60 paths FULL     6.01 ms
 *   80 paths FULL     8.31 ms
 *
 * Per-update overhead of FULL_MASK fallback is ~1-4 microseconds at
 * 40-80 paths. For a realistic app pushing 60 updates/sec, the worst-case
 * cost is well under 1% of frame budget. The warning-with-guidance from
 * the compiler is what actually steers authors to decompose components
 * that exceed 31 paths — the runtime fallback is just graceful overflow.
 */

type State = Record<string, number>
type Msg = { type: 'bump'; key: string }

function buildDef(pathCount: number, useFullMask: boolean): ComponentDef<State, Msg, never> {
  const keys = Array.from({ length: pathCount }, (_, i) => `f${i}`)
  const initState: State = {}
  for (const k of keys) initState[k] = 0

  const bindings: Array<[number, 'text', string, (s: State) => unknown]> = keys.map((k, i) => {
    const mask = useFullMask ? FULL_MASK : 1 << i
    return [mask, 'text', '', (s: State) => String(s[k])]
  })

  const bitFor: Record<string, number> = {}
  for (let i = 0; i < keys.length; i++) bitFor[keys[i]!] = 1 << i

  return {
    name: `Mask${pathCount}${useFullMask ? 'Full' : 'Ideal'}`,
    init: () => [initState, []],
    update: (state, msg) => {
      switch (msg.type) {
        case 'bump':
          return [{ ...state, [msg.key]: (state[msg.key] ?? 0) + 1 }, []]
      }
    },
    view: () => {
      const nodes = bindings.map((b) => elSplit('span', null, null, [b], null))
      return [elSplit('div', null, null, null, nodes)]
    },
    // __dirty is identical in both modes: it computes the diff bitmask
    // from old/new state. The only thing that differs between IDEAL and
    // FULL_MASK is the per-binding mask, which controls how many accessors
    // re-evaluate in Phase 2 for a given dirty mask.
    __dirty: (o, n) => {
      let m = 0
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i]!
        m |= Object.is(o[k], n[k]) ? 0 : bitFor[k]!
      }
      return m
    },
  }
}

function measure(pathCount: number, useFullMask: boolean, iterations: number): number {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const def = buildDef(pathCount, useFullMask)
  let sendFn!: (m: Msg) => void
  const origView = def.view
  def.view = (h) => {
    sendFn = h.send
    return origView(h)
  }
  const handle = mountApp(container, def)
  const keys = Array.from({ length: pathCount }, (_, i) => `f${i}`)

  // Warmup
  for (let i = 0; i < 50; i++) {
    sendFn({ type: 'bump', key: keys[i % pathCount]! })
    handle.flush()
  }

  const start = performance.now()
  for (let i = 0; i < iterations; i++) {
    sendFn({ type: 'bump', key: keys[i % pathCount]! })
    handle.flush()
  }
  const elapsed = performance.now() - start
  handle.dispose()
  document.body.removeChild(container)
  return elapsed
}

describe.skip('mask overflow overhead harness (manual)', () => {
  it('measure mask overflow overhead', () => {
    const ITER = 2000
    const results: Array<[string, number]> = []

    for (const [count, label] of [
      [31, '31 paths'],
      [40, '40 paths'],
      [60, '60 paths'],
      [80, '80 paths'],
    ] as Array<[number, string]>) {
      // run each config 5 times, take median
      const idealRuns: number[] = []
      const fullRuns: number[] = []
      for (let r = 0; r < 5; r++) {
        if (count <= 31) idealRuns.push(measure(count, false, ITER))
        fullRuns.push(measure(count, true, ITER))
      }
      idealRuns.sort((a, b) => a - b)
      fullRuns.sort((a, b) => a - b)
      const ideal = idealRuns[2] // median of 5
      const full = fullRuns[2]!
      if (ideal !== undefined) {
        results.push([`${label} IDEAL`, ideal])
        results.push([`${label} FULL  (×${(full / ideal).toFixed(2)})`, full])
      } else {
        results.push([`${label} FULL`, full])
      }
    }

    // eslint-disable-next-line no-console
    console.log(
      '\n--- mask overflow overhead (ms for 2000 updates, median of 5 runs) ---\n' +
        results.map(([k, v]) => `  ${k.padEnd(28)} ${v.toFixed(2)} ms`).join('\n') +
        '\n',
    )
  })
})
