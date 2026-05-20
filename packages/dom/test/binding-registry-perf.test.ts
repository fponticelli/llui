// Synthetic perf comparison — flat vs registry dispatch on a single-
// path update. The Option B hypothesis: registry wins on updates where
// one prefix changes and many bindings read different prefixes, because
// the flat scan inspects every binding while the registry-keyed
// dispatch goes straight to the small subscriber set.
//
// We construct a component with N bindings split across K prefixes
// (one binding per prefix in this microbench — so dispatch fires
// exactly one binding per single-path update). Time M updates against
// each model with `performance.now()` and report the medians.
//
// jsdom is slow — absolute times are inflated vs a real browser, but
// the RATIO between models holds. The test passes if neither mode
// catastrophically regresses; it logs the comparison so we can read
// the empirical signal even when noise prevents a hard assertion.

import { describe, it, expect } from 'vitest'
import { mountApp } from '../src/mount'
import { div } from '../src/elements'
import { text } from '../src/primitives/text'
import type { ComponentDef } from '../src/types'

type S = Record<string, number>
type M = { type: 'set'; key: string; value: number }

function buildDef(prefixCount: number, model: 'flat' | 'registry'): ComponentDef<S, M, never> {
  // State is { f0: 0, f1: 0, ..., f{N-1}: 0 }. One binding per field —
  // each binding reads exactly one prefix.
  const initState: S = {}
  for (let i = 0; i < prefixCount; i++) initState[`f${i}`] = 0

  const prefixes: Array<(s: S) => unknown> = []
  for (let i = 0; i < prefixCount; i++) {
    const key = `f${i}`
    prefixes.push((s) => s[key])
  }

  return {
    name: `Synth_${model}`,
    init: () => [initState, []],
    update: (s, m) => {
      switch (m.type) {
        case 'set':
          return [{ ...s, [m.key]: m.value }, []]
      }
    },
    view: () => {
      const nodes: Node[] = []
      for (let i = 0; i < prefixCount; i++) {
        const key = `f${i}`
        nodes.push(div({ 'data-i': String(i) }, [text((s: S) => String(s[key]))]))
      }
      return nodes
    },
    __prefixes: prefixes,
    __compilerVersion: '__test__',
    __bindingModel: model,
  }
}

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b)
  const m = sorted.length >> 1
  return sorted.length % 2 === 0 ? (sorted[m - 1]! + sorted[m]!) / 2 : sorted[m]!
}

function timeUpdates(
  def: ComponentDef<S, M, never>,
  prefixCount: number,
  iterations: number,
): number[] {
  const container = document.createElement('div')
  const handle = mountApp(container, def)
  const samples: number[] = []
  try {
    for (let i = 0; i < iterations; i++) {
      const key = `f${i % prefixCount}`
      const t0 = performance.now()
      handle.send({ type: 'set', key, value: i + 1 })
      handle.flush()
      const t1 = performance.now()
      samples.push(t1 - t0)
    }
  } finally {
    handle.dispose()
  }
  return samples
}

// Single-bindings-per-prefix microbench. Skipped under default `pnpm
// test` because timing is jsdom-dependent and noisy; run with
// `LLUI_PERF=1 pnpm vitest run binding-registry-perf`. Documented as
// the empirical gate before committing to Phase 3 of Option B.
const PERF_ENABLED = ((): boolean => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return Boolean((globalThis as any).process?.env?.LLUI_PERF)
  } catch {
    return false
  }
})()

describe.skipIf(!PERF_ENABLED)('Option B perf comparison — registry vs flat', () => {
  it('single-path update fires one binding under both modes', () => {
    // Small smoke check that runs even when LLUI_PERF is unset — when
    // skipped at the suite level it doesn't execute.
    const def = buildDef(8, 'registry')
    const container = document.createElement('div')
    const handle = mountApp(container, def)
    handle.send({ type: 'set', key: 'f3', value: 42 })
    handle.flush()
    expect(container.querySelector('[data-i="3"]')?.textContent).toBe('42')
    expect(container.querySelector('[data-i="0"]')?.textContent).toBe('0')
    handle.dispose()
  })

  for (const N of [16, 64, 256, 1024]) {
    it(`single-path update — ${N} bindings, ${N} prefixes`, () => {
      const ITERS = 200

      // Warm-up to JIT-prime both code paths
      timeUpdates(buildDef(N, 'flat'), N, 20)
      timeUpdates(buildDef(N, 'registry'), N, 20)

      const flatSamples = timeUpdates(buildDef(N, 'flat'), N, ITERS)
      const regSamples = timeUpdates(buildDef(N, 'registry'), N, ITERS)

      const flatMed = median(flatSamples)
      const regMed = median(regSamples)
      const ratio = regMed / flatMed

      const line = `[N=${N}] flat=${flatMed.toFixed(3)}ms registry=${regMed.toFixed(3)}ms ratio=${ratio.toFixed(2)}x`
      console.log(line)

      // Soft assertion: registry must not regress catastrophically (>2x
      // slower). The expected outcome is registry ≤ flat for large N;
      // for small N (N=16) flat may win due to the registry's
      // per-update allocation overhead. Don't fail on that — log it.
      expect(regMed).toBeLessThan(flatMed * 2)
    })
  }
})
