import { describe, it, expect, vi } from 'vitest'
import { mountApp } from '../src/mount'
import { div } from '../src/elements'
import { text } from '../src/primitives/text'
import { memo } from '../src/primitives/memo'
import type { ComponentDef } from '../src/types'

type State = { count: number; label: string }
type Msg = { type: 'inc' } | { type: 'setLabel'; value: string }

describe('memo()', () => {
  it('caches result when output is unchanged', () => {
    const compute = vi.fn((s: State) => s.count > 0 ? 'positive' : 'zero')
    const memoized = memo(compute)

    const state1: State = { count: 1, label: 'a' }
    expect(memoized(state1)).toBe('positive')
    expect(compute).toHaveBeenCalledTimes(1)

    // Same logical result, different state object
    const state2: State = { count: 2, label: 'b' }
    expect(memoized(state2)).toBe('positive')
    expect(compute).toHaveBeenCalledTimes(2) // re-evaluated but same output

    // Verify output stability — same reference returned
    expect(memoized(state2)).toBe('positive')
  })

  it('recomputes when output changes', () => {
    const compute = vi.fn((s: State) => String(s.count))
    const memoized = memo(compute)

    expect(memoized({ count: 0, label: '' })).toBe('0')
    expect(memoized({ count: 1, label: '' })).toBe('1')
    expect(compute).toHaveBeenCalledTimes(2)
  })

  it('skips re-evaluation when dirty mask does not overlap', () => {
    const compute = vi.fn((s: State) => `count=${s.count}`)
    const memoized = memo(compute, 0b01) // depends on count (bit 0)

    let sendFn: (msg: Msg) => void

    const def: ComponentDef<State, Msg, never> = {
      name: 'MemoTest',
      init: () => [{ count: 0, label: 'hi' }, []],
      update: (state, msg) => {
        switch (msg.type) {
          case 'inc':
            return [{ ...state, count: state.count + 1 }, []]
          case 'setLabel':
            return [{ ...state, label: msg.value }, []]
        }
      },
      view: (_state, send) => {
        sendFn = send
        return [
          div({}, [
            text((s: State) => memoized(s)),
            text((s: State) => s.label),
          ]),
        ]
      },
      // count = bit 0, label = bit 1
      __dirty: (o, n) =>
        (Object.is(o.count, n.count) ? 0 : 0b01) |
        (Object.is(o.label, n.label) ? 0 : 0b10),
    }

    const container = document.createElement('div')
    const handle = mountApp(container, def)

    // Initial evaluation
    expect(compute).toHaveBeenCalledTimes(1)
    compute.mockClear()

    // Change label only — dirty = 0b10, memo mask = 0b01 → skip
    sendFn!({ type: 'setLabel', value: 'bye' })
    handle.flush()
    expect(compute).toHaveBeenCalledTimes(0) // skipped!

    // Change count — dirty = 0b01, memo mask = 0b01 → re-evaluate
    sendFn!({ type: 'inc' })
    handle.flush()
    expect(compute).toHaveBeenCalledTimes(1)
  })
})
