import { describe, it, expect } from 'vitest'
import { propertyTest } from '../src/property-test'
import { component } from '@llui/dom'

// A component that fails an invariant once `count` crosses a threshold, so the
// failing sequence depends on how many `inc`s the random stream produces —
// making the failure seed-sensitive and thus a good determinism probe.
const Threshold = component<{ count: number }, { type: 'inc' } | { type: 'noop' }, never>({
  name: 'Threshold',
  init: () => [{ count: 0 }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'inc':
        return [{ count: state.count + 1 }, []]
      case 'noop':
        return [state, []]
    }
  },
  view: () => [],
})

const config = {
  invariants: [(s: { count: number }) => s.count < 3],
  messageGenerators: {
    inc: () => ({ type: 'inc' as const }),
    noop: () => ({ type: 'noop' as const }),
  },
  runs: 200,
  maxSequenceLength: 20,
}

describe('propertyTest seeding', () => {
  it('is deterministic for a fixed seed — same run throws the same message', () => {
    const grab = (): string => {
      try {
        propertyTest(Threshold, { ...config, seed: 12345 })
        return '<no failure>'
      } catch (e) {
        return (e as Error).message
      }
    }
    const a = grab()
    const b = grab()
    expect(a).toBe(b)
    expect(a).not.toBe('<no failure>')
  })

  it('prints the seed and the full JSON of the minimal failing messages', () => {
    let msg = ''
    try {
      propertyTest(Threshold, { ...config, seed: 999 })
    } catch (e) {
      msg = (e as Error).message
    }
    expect(msg).toContain('Seed: 999')
    expect(msg).toContain('pass `seed: 999` to replay')
    expect(msg).toContain('Minimal failing messages:')
    // The minimal sequence is three incs; their payloads are printed as JSON.
    expect(msg).toContain('"type": "inc"')
  })

  it('different seeds are independent (both still catch the bug)', () => {
    const fails = (seed: number): boolean => {
      try {
        propertyTest(Threshold, { ...config, seed })
        return false
      } catch {
        return true
      }
    }
    expect(fails(1)).toBe(true)
    expect(fails(2)).toBe(true)
  })
})
