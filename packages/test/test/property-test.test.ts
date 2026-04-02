import { describe, it, expect } from 'vitest'
import { propertyTest } from '../src/property-test'
import { component } from '@llui/core'

describe('propertyTest', () => {
  it('passes when all invariants hold', () => {
    const Counter = component<{ count: number }, { type: 'inc' } | { type: 'dec' }, never>({
      name: 'Counter',
      init: () => [{ count: 0 }, []],
      update: (state, msg) => {
        switch (msg.type) {
          case 'inc':
            return [{ count: state.count + 1 }, []]
          case 'dec':
            return [{ count: Math.max(0, state.count - 1) }, []]
        }
      },
      view: () => [],
    })

    // Should not throw
    propertyTest(Counter, {
      invariants: [
        (state) => state.count >= 0,
        (state) => typeof state.count === 'number',
      ],
      messageGenerators: {
        inc: () => ({ type: 'inc' as const }),
        dec: () => ({ type: 'dec' as const }),
      },
      runs: 50,
      maxSequenceLength: 20,
    })
  })

  it('throws when an invariant is violated', () => {
    const Buggy = component<{ count: number }, { type: 'dec' }, never>({
      name: 'Buggy',
      init: () => [{ count: 0 }, []],
      update: (state) => [{ count: state.count - 1 }, []], // goes negative!
      view: () => [],
    })

    expect(() =>
      propertyTest(Buggy, {
        invariants: [(state) => state.count >= 0],
        messageGenerators: {
          dec: () => ({ type: 'dec' as const }),
        },
        runs: 10,
        maxSequenceLength: 5,
      }),
    ).toThrow(/invariant/)
  })

  it('reports the failing message sequence', () => {
    const Buggy = component<{ count: number }, { type: 'dec' }, never>({
      name: 'Buggy',
      init: () => [{ count: 0 }, []],
      update: (state) => [{ count: state.count - 1 }, []],
      view: () => [],
    })

    try {
      propertyTest(Buggy, {
        invariants: [(state) => state.count >= 0],
        messageGenerators: {
          dec: () => ({ type: 'dec' as const }),
        },
        runs: 10,
        maxSequenceLength: 5,
      })
      expect.unreachable()
    } catch (e) {
      expect((e as Error).message).toContain('dec')
    }
  })
})
