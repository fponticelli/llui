import { describe, it, expect } from 'vitest'
import { chainUpdate } from '../src/chain-update'

type State = { count: number; label: string }
type Msg = { type: 'inc' } | { type: 'setLabel'; value: string }
type Effect = { type: 'log'; message: string }

describe('chainUpdate', () => {
  it('calls the first handler that returns non-null', () => {
    const countHandler = (s: State, m: Msg): [State, Effect[]] | null => {
      if (m.type === 'inc') return [{ ...s, count: s.count + 1 }, []]
      return null
    }

    const labelHandler = (s: State, m: Msg): [State, Effect[]] | null => {
      if (m.type === 'setLabel') return [{ ...s, label: m.value }, []]
      return null
    }

    const update = chainUpdate<State, Msg, Effect>(countHandler, labelHandler)

    const [s1] = update({ count: 0, label: '' }, { type: 'inc' })
    expect(s1.count).toBe(1)

    const [s2] = update({ count: 0, label: '' }, { type: 'setLabel', value: 'hi' })
    expect(s2.label).toBe('hi')
  })

  it('returns unchanged state when no handler matches', () => {
    const update = chainUpdate<State, Msg, Effect>(
      () => null,
      () => null,
    )
    const state = { count: 5, label: 'x' }
    const [result, effects] = update(state, { type: 'inc' })
    expect(result).toBe(state)
    expect(effects).toEqual([])
  })

  it('preserves effects from the matching handler', () => {
    const update = chainUpdate<State, Msg, Effect>((s, m) => {
      if (m.type === 'inc')
        return [{ ...s, count: s.count + 1 }, [{ type: 'log', message: 'incremented' }]]
      return null
    })
    const [, effects] = update({ count: 0, label: '' }, { type: 'inc' })
    expect(effects).toEqual([{ type: 'log', message: 'incremented' }])
  })
})
