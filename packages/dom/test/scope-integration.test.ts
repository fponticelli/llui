import { describe, it, expect } from 'vitest'
import { mountApp } from '../src/mount'
import { scope } from '../src/primitives/scope'
import { sample } from '../src/primitives/sample'
import { component } from '../src/component'
import { div } from '../src/elements'
import { text } from '../src/primitives/text'
import { flush } from '../src/runtime'

// End-to-end regression for the dicerun2 epoch-rebuild use case.
// Outer state carries a stats object plus an epoch counter. The chart
// subtree reads stats via sample() at rebuild time — never as a binding.
// Bumping the epoch rebuilds the chart; stats-only changes do not.
// A live counter elsewhere stays reactive.

describe('scope() + sample() — dicerun2 epoch-rebuild integration', () => {
  it('chart rebuilds only on epoch bump; stats-only updates skip; live binding stays reactive', () => {
    type Stats = { samples: number; mean: number }
    type S = { stats: Stats; epoch: number; live: number }
    type Msg =
      | { type: 'updateStats'; stats: Stats }
      | { type: 'rebuildChart' }
      | { type: 'tickLive' }

    let chartBuildCount = 0
    let capturedStats: Stats | null = null

    const Def = component<S, Msg, never>({
      name: 'Dashboard',
      init: () => [{ stats: { samples: 0, mean: 0 }, epoch: 0, live: 0 }, []],
      update: (s, m) => {
        switch (m.type) {
          case 'updateStats':
            return [{ ...s, stats: m.stats }, []]
          case 'rebuildChart':
            return [{ ...s, epoch: s.epoch + 1 }, []]
          case 'tickLive':
            return [{ ...s, live: s.live + 1 }, []]
        }
      },
      view: () => [
        div({}, [
          div({ id: 'live' }, [text((s: S) => String(s.live))]),
          ...scope<S, Msg>({
            on: (s) => String(s.epoch),
            render: () => {
              chartBuildCount++
              capturedStats = sample<S, Stats>((s) => s.stats)
              return [div({ id: `chart-${chartBuildCount}` })]
            },
          }),
        ]),
      ],
    })

    const container = document.createElement('div')
    const handle = mountApp(container, Def)

    expect(chartBuildCount).toBe(1)
    expect(capturedStats).toEqual({ samples: 0, mean: 0 })
    expect(container.querySelector('#chart-1')).not.toBeNull()
    expect(container.querySelector('#live')?.textContent).toBe('0')

    // Stats update — chart should NOT rebuild
    handle.send({ type: 'updateStats', stats: { samples: 10, mean: 5 } })
    flush()
    expect(chartBuildCount).toBe(1)

    // Live tick — live text updates, chart unchanged
    handle.send({ type: 'tickLive' })
    flush()
    expect(container.querySelector('#live')?.textContent).toBe('1')
    expect(chartBuildCount).toBe(1)

    // Epoch bump — chart rebuilds with the latest stats snapshot
    handle.send({ type: 'rebuildChart' })
    flush()
    expect(chartBuildCount).toBe(2)
    expect(capturedStats).toEqual({ samples: 10, mean: 5 })
    expect(container.querySelector('#chart-1')).toBeNull()
    expect(container.querySelector('#chart-2')).not.toBeNull()

    handle.dispose()
  })
})
