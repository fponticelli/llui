import { describe, it, expect, vi } from 'vitest'
import {
  init,
  update,
  connect,
  isLevelReady,
  isComplete,
  completeValues,
} from '../../src/components/cascade-select'
import type { CascadeSelectState, CascadeLevel } from '../../src/components/cascade-select'

type Ctx = { c: CascadeSelectState }
const wrap = (c: CascadeSelectState): Ctx => ({ c })

const levels: CascadeLevel[] = [
  {
    id: 'country',
    label: 'Country',
    options: [
      { value: 'US', label: 'United States' },
      { value: 'IT', label: 'Italy' },
    ],
  },
  {
    id: 'state',
    label: 'State/Region',
    options: [
      { value: 'CA', label: 'California' },
      { value: 'NY', label: 'New York' },
      { value: 'MI', label: 'Milan' },
    ],
  },
  {
    id: 'city',
    label: 'City',
    options: [{ value: 'SF', label: 'San Francisco' }],
  },
]

describe('cascade-select reducer', () => {
  it('initializes values array matching levels length', () => {
    const s = init({ levels })
    expect(s.values).toEqual([null, null, null])
  })

  it('setLevels resets values to match new length', () => {
    const s0 = init({ levels, values: ['US', 'CA', null] })
    const [s] = update(s0, { type: 'setLevels', levels: levels.slice(0, 2) })
    expect(s.values).toEqual([null, null])
  })

  it('setValue at level N clears levels > N', () => {
    const s0 = init({ levels, values: ['US', 'CA', 'SF'] })
    const [s] = update(s0, { type: 'setValue', levelIndex: 0, value: 'IT' })
    expect(s.values).toEqual(['IT', null, null])
  })

  it('setValue at leaf level preserves earlier levels', () => {
    const s0 = init({ levels, values: ['US', 'CA', null] })
    const [s] = update(s0, { type: 'setValue', levelIndex: 2, value: 'SF' })
    expect(s.values).toEqual(['US', 'CA', 'SF'])
  })

  it('setValue out of range is a no-op', () => {
    const s0 = init({ levels })
    const [s] = update(s0, { type: 'setValue', levelIndex: 10, value: 'X' })
    expect(s).toBe(s0)
  })

  it('clear wipes all values', () => {
    const s0 = init({ levels, values: ['US', 'CA', 'SF'] })
    const [s] = update(s0, { type: 'clear' })
    expect(s.values).toEqual([null, null, null])
  })
})

describe('helpers', () => {
  it('isLevelReady: level 0 always ready', () => {
    expect(isLevelReady(init({ levels }), 0)).toBe(true)
  })

  it('isLevelReady: level N ready only when all prior are set', () => {
    const s = init({ levels, values: ['US', null, null] })
    expect(isLevelReady(s, 1)).toBe(true)
    expect(isLevelReady(s, 2)).toBe(false)
    const s2 = init({ levels, values: ['US', 'CA', null] })
    expect(isLevelReady(s2, 2)).toBe(true)
  })

  it('isComplete + completeValues', () => {
    expect(isComplete(init({ levels }))).toBe(false)
    const full = init({ levels, values: ['US', 'CA', 'SF'] })
    expect(isComplete(full)).toBe(true)
    expect(completeValues(full)).toEqual(['US', 'CA', 'SF'])
    expect(completeValues(init({ levels }))).toBeNull()
  })
})

describe('cascade-select.connect', () => {
  it('level select disabled until prior level is set', () => {
    const p = connect<Ctx>((s) => s.c, vi.fn(), { id: 'x' })
    expect(p.level(1).select.disabled(wrap(init({ levels })))).toBe(true)
    expect(
      p.level(1).select.disabled(wrap(init({ levels, values: ['US', null, null] }))),
    ).toBe(false)
  })

  it('level select value reflects state', () => {
    const p = connect<Ctx>((s) => s.c, vi.fn(), { id: 'x' })
    expect(p.level(0).select.value(wrap(init({ levels })))).toBe('')
    expect(p.level(0).select.value(wrap(init({ levels, values: ['US', null, null] })))).toBe('US')
  })

  it('onChange dispatches setValue', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.c, send, { id: 'x' })
    const el = { value: 'US' } as HTMLSelectElement
    p.level(0).select.onChange({ target: el } as unknown as Event)
    expect(send).toHaveBeenCalledWith({ type: 'setValue', levelIndex: 0, value: 'US' })
  })

  it('onChange dispatches null for empty value', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.c, send, { id: 'x' })
    const el = { value: '' } as HTMLSelectElement
    p.level(0).select.onChange({ target: el } as unknown as Event)
    expect(send).toHaveBeenCalledWith({ type: 'setValue', levelIndex: 0, value: null })
  })

  it('clearTrigger disabled when nothing selected', () => {
    const p = connect<Ctx>((s) => s.c, vi.fn(), { id: 'x' })
    expect(p.clearTrigger.disabled(wrap(init({ levels })))).toBe(true)
    expect(
      p.clearTrigger.disabled(wrap(init({ levels, values: ['US', null, null] }))),
    ).toBe(false)
  })

  it('root data-complete reflects isComplete', () => {
    const p = connect<Ctx>((s) => s.c, vi.fn(), { id: 'x' })
    expect(p.root['data-complete'](wrap(init({ levels })))).toBeUndefined()
    expect(
      p.root['data-complete'](wrap(init({ levels, values: ['US', 'CA', 'SF'] }))),
    ).toBe('')
  })
})
