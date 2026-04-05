import { describe, it, expect } from 'vitest'
import { sliceHandler } from '../src/slice-handler'
import { mergeHandlers } from '../src/merge-handlers'

type SubState = { count: number }
type SubMsg = { type: 'inc' } | { type: 'dec' }
type SubEffect = { type: 'logged' }

const sub = (s: SubState, m: SubMsg): [SubState, SubEffect[]] => {
  switch (m.type) {
    case 'inc':
      return [{ count: s.count + 1 }, [{ type: 'logged' }]]
    case 'dec':
      return [{ count: s.count - 1 }, []]
  }
}

type AppState = { counter: SubState; name: string }
type AppMsg = { type: 'counter'; msg: SubMsg } | { type: 'setName'; name: string }
type AppEffect = SubEffect

describe('sliceHandler', () => {
  const counterHandler = sliceHandler<AppState, AppMsg, AppEffect, SubState, SubMsg>({
    get: (s) => s.counter,
    set: (s, v) => ({ ...s, counter: v }),
    narrow: (m) => (m.type === 'counter' ? m.msg : null),
    sub,
  })

  it('runs sub.update on matching messages and rebuilds parent state', () => {
    const result = counterHandler(
      { counter: { count: 0 }, name: 'x' },
      { type: 'counter', msg: { type: 'inc' } },
    )
    expect(result).toEqual([{ counter: { count: 1 }, name: 'x' }, [{ type: 'logged' }]])
  })

  it('returns null for non-matching messages', () => {
    const result = counterHandler(
      { counter: { count: 0 }, name: 'x' },
      { type: 'setName', name: 'y' },
    )
    expect(result).toBeNull()
  })

  it('preserves sibling state fields', () => {
    const [s] = counterHandler(
      { counter: { count: 5 }, name: 'keep' },
      { type: 'counter', msg: { type: 'dec' } },
    )!
    expect(s.name).toBe('keep')
    expect(s.counter.count).toBe(4)
  })

  it('composes with mergeHandlers', () => {
    const update = mergeHandlers<AppState, AppMsg, AppEffect>(counterHandler, (s, m) =>
      m.type === 'setName' ? [{ ...s, name: m.name }, []] : null,
    )
    const r1 = update(
      { counter: { count: 0 }, name: 'a' },
      { type: 'counter', msg: { type: 'inc' } },
    )
    expect(r1[0].counter.count).toBe(1)
    const r2 = update({ counter: { count: 0 }, name: 'a' }, { type: 'setName', name: 'b' })
    expect(r2[0].name).toBe('b')
  })
})
