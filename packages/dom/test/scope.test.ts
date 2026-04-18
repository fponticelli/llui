import { describe, it, expect } from 'vitest'
import { mountApp } from '../src/mount'
import { scope } from '../src/primitives/scope'
import { sample } from '../src/primitives/sample'
import { component } from '../src/component'
import { div } from '../src/elements'
import { onMount } from '../src/primitives/on-mount'
import { flush } from '../src/runtime'

describe('scope() — keyed subtree rebuild', () => {
  it('runs render once when key never changes', () => {
    type S = { epoch: number }
    let buildCount = 0
    const Def = component<S, never, never>({
      name: 'S',
      init: () => [{ epoch: 0 }, []],
      update: (s) => [s, []],
      view: () => [
        ...scope<S>({
          on: (s) => String(s.epoch),
          render: () => {
            buildCount++
            return [div({ id: 'region' })]
          },
        }),
      ],
    })

    const container = document.createElement('div')
    const handle = mountApp(container, Def)
    expect(buildCount).toBe(1)
    expect(container.querySelector('#region')).not.toBeNull()
    handle.dispose()
  })

  it('rebuilds when the key changes', () => {
    type S = { epoch: number }
    type Msg = { type: 'bump' }
    let buildCount = 0

    const Def = component<S, Msg, never>({
      name: 'S',
      init: () => [{ epoch: 0 }, []],
      update: (s, m) => (m.type === 'bump' ? [{ epoch: s.epoch + 1 }, []] : [s, []]),
      view: () => [
        ...scope<S, Msg>({
          on: (s) => String(s.epoch),
          render: () => {
            buildCount++
            return [div({ id: `region-${buildCount}` })]
          },
        }),
      ],
    })

    const container = document.createElement('div')
    const handle = mountApp(container, Def)
    expect(buildCount).toBe(1)
    expect(container.querySelector('#region-1')).not.toBeNull()

    handle.send({ type: 'bump' })
    flush()
    expect(buildCount).toBe(2)
    expect(container.querySelector('#region-1')).toBeNull()
    expect(container.querySelector('#region-2')).not.toBeNull()

    handle.dispose()
  })

  it('disposes the arm when the component unmounts', () => {
    type S = { epoch: number }
    let disposed = false
    const Def = component<S, never, never>({
      name: 'S',
      init: () => [{ epoch: 0 }, []],
      update: (s) => [s, []],
      view: () => [
        ...scope<S>({
          on: (s) => String(s.epoch),
          render: () => {
            onMount(() => {
              return () => {
                disposed = true
              }
            })
            return [div()]
          },
        }),
      ],
    })

    const container = document.createElement('div')
    const handle = mountApp(container, Def)
    expect(disposed).toBe(false)
    handle.dispose()
    expect(disposed).toBe(true)
  })

  it('disposes the old arm on rebuild — fires leave disposers', () => {
    type S = { epoch: number }
    type Msg = { type: 'bump' }
    const disposeCalls: number[] = []

    const Def = component<S, Msg, never>({
      name: 'S',
      init: () => [{ epoch: 0 }, []],
      update: (s, m) => (m.type === 'bump' ? [{ epoch: s.epoch + 1 }, []] : [s, []]),
      view: () => [
        ...scope<S, Msg>({
          on: (s) => String(s.epoch),
          render: () => {
            const ep = sample<S, number>((s) => s.epoch)
            onMount(() => () => disposeCalls.push(ep))
            return [div()]
          },
        }),
      ],
    })

    const container = document.createElement('div')
    const handle = mountApp(container, Def)
    expect(disposeCalls).toEqual([])

    handle.send({ type: 'bump' })
    flush()
    // First arm (epoch 0) must have fired its dispose callback when rebuilt
    expect(disposeCalls).toEqual([0])

    handle.dispose()
    // Second arm (epoch 1) disposes on unmount
    expect(disposeCalls).toEqual([0, 1])
  })

  it('composes with sample() for whole-state snapshot reads at rebuild time', () => {
    type Stats = { samples: number; mean: number }
    type S = { stats: Stats; epoch: number }
    type Msg = { type: 'rebuild' } | { type: 'updateStats'; stats: Stats }
    const snapshotsAtRebuild: Stats[] = []

    const Def = component<S, Msg, never>({
      name: 'Dash',
      init: () => [{ stats: { samples: 0, mean: 0 }, epoch: 0 }, []],
      update: (s, m) => {
        switch (m.type) {
          case 'rebuild':
            return [{ ...s, epoch: s.epoch + 1 }, []]
          case 'updateStats':
            return [{ ...s, stats: m.stats }, []]
        }
      },
      view: () => [
        ...scope<S, Msg>({
          on: (s) => String(s.epoch),
          render: () => {
            const snap = sample<S, Stats>((s) => s.stats)
            snapshotsAtRebuild.push(snap)
            return [div()]
          },
        }),
      ],
    })

    const container = document.createElement('div')
    const handle = mountApp(container, Def)
    expect(snapshotsAtRebuild).toEqual([{ samples: 0, mean: 0 }])

    // Change stats without bumping epoch — render must NOT run
    handle.send({ type: 'updateStats', stats: { samples: 5, mean: 2 } })
    flush()
    expect(snapshotsAtRebuild).toEqual([{ samples: 0, mean: 0 }])

    // Bump epoch — render runs and captures the latest stats
    handle.send({ type: 'rebuild' })
    flush()
    expect(snapshotsAtRebuild).toEqual([
      { samples: 0, mean: 0 },
      { samples: 5, mean: 2 },
    ])

    handle.dispose()
  })
})
