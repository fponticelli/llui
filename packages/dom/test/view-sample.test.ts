import { describe, it, expect } from 'vitest'
import { mountApp } from '../src/mount'
import { component } from '../src/component'
import { div } from '../src/elements'
import { text } from '../src/primitives/text'
import { each } from '../src/primitives/each'
import { branch } from '../src/primitives/branch'
import { sample } from '../src/primitives/sample'

describe('sample() — top-level import', () => {
  it('reads current state inside a top-level view builder', () => {
    type S = { count: number; label: string }
    let observed: number | null = null

    const Def = component<S, never, never>({
      name: 'Observer',
      init: () => [{ count: 42, label: 'x' }, []],
      update: (s) => [s, []],
      view: () => {
        observed = sample<S, number>((s) => s.count)
        return [div([text((s: S) => s.label)])]
      },
    })

    const container = document.createElement('div')
    mountApp(container, Def).dispose()
    expect(observed).toBe(42)
  })

  it('reads current state inside an each() render callback', () => {
    type S = { items: number[]; bonus: number }
    const reads: Array<{ item: number; bonus: number }> = []

    const Def = component<S, never, never>({
      name: 'EachSampler',
      init: () => [{ items: [1, 2, 3], bonus: 10 }, []],
      update: (s) => [s, []],
      view: () => [
        div(
          {},
          each<S, number, never>({
            items: (s) => s.items,
            key: (n) => n,
            render: ({ item }) => {
              const bonus = sample<S, number>((s) => s.bonus)
              reads.push({ item: item.current(), bonus })
              return [div()]
            },
          }),
        ),
      ],
    })

    const container = document.createElement('div')
    mountApp(container, Def).dispose()
    expect(reads).toEqual([
      { item: 1, bonus: 10 },
      { item: 2, bonus: 10 },
      { item: 3, bonus: 10 },
    ])
  })

  it('throws when called outside a render context', () => {
    expect(() => sample((s: { x: number }) => s.x)).toThrow(/sample/)
  })
})

describe('h.sample — View bag method', () => {
  it('is available inside branch cases', () => {
    type S = { mode: 'a' | 'b'; payload: string }
    let captured: string | null = null

    const Def = component<S, never, never>({
      name: 'Br',
      init: () => [{ mode: 'a', payload: 'hi' }, []],
      update: (s) => [s, []],
      view: () => [
        ...branch<S, never>({
          on: (s) => s.mode,
          cases: {
            a: (h) => {
              captured = h.sample((s: S) => s.payload)
              return [div()]
            },
            b: () => [div()],
          },
        }),
      ],
    })

    const container = document.createElement('div')
    mountApp(container, Def).dispose()
    expect(captured).toBe('hi')
  })
})
