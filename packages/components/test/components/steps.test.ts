import { describe, it, expect, vi } from 'vitest'
import { init, update, connect, stepStatus } from '../../src/components/steps'
import type { StepsState } from '../../src/components/steps'

type Ctx = { s: StepsState }
const wrap = (s: StepsState): Ctx => ({ s })

describe('steps reducer', () => {
  it('initializes at step 0', () => {
    expect(init({ steps: ['a', 'b', 'c'] })).toMatchObject({
      current: 0,
      completed: [],
      linear: true,
    })
  })

  it('next moves forward and marks current completed', () => {
    const [s] = update(init({ steps: ['a', 'b'] }), { type: 'next' })
    expect(s.current).toBe(1)
    expect(s.completed).toEqual([0])
  })

  it('next at last step stays', () => {
    const s0 = init({ steps: ['a', 'b'], current: 1 })
    const [s] = update(s0, { type: 'next' })
    expect(s.current).toBe(1)
  })

  it('prev decrements', () => {
    const s0 = init({ steps: ['a', 'b'], current: 1 })
    const [s] = update(s0, { type: 'prev' })
    expect(s.current).toBe(0)
  })

  it('linear: goTo forward requires completion', () => {
    const s0 = init({ steps: ['a', 'b', 'c'], current: 0, linear: true })
    const [s] = update(s0, { type: 'goTo', step: 2 })
    expect(s.current).toBe(0) // blocked
  })

  it('non-linear: goTo anywhere', () => {
    const s0 = init({ steps: ['a', 'b', 'c'], current: 0, linear: false })
    const [s] = update(s0, { type: 'goTo', step: 2 })
    expect(s.current).toBe(2)
  })

  it('complete adds to completed list', () => {
    const [s] = update(init({ steps: ['a', 'b'] }), { type: 'complete', step: 0 })
    expect(s.completed).toContain(0)
  })

  it('markError tags step as error', () => {
    const [s] = update(init({ steps: ['a'] }), { type: 'markError', step: 0 })
    expect(s.errors).toContain(0)
  })

  it('reset clears progress', () => {
    const s0 = init({ steps: ['a', 'b'], current: 1, completed: [0] })
    const [s] = update(s0, { type: 'reset' })
    expect(s.current).toBe(0)
    expect(s.completed).toEqual([])
  })
})

describe('stepStatus', () => {
  const s = init({ steps: ['a', 'b', 'c'], current: 1, completed: [0] })

  it('returns completed/current/pending', () => {
    expect(stepStatus(s, 0)).toBe('completed')
    expect(stepStatus(s, 1)).toBe('current')
    expect(stepStatus(s, 2)).toBe('pending')
  })

  it('error takes precedence', () => {
    const s2 = { ...s, errors: [1] }
    expect(stepStatus(s2, 1)).toBe('error')
  })
})

describe('steps.connect', () => {
  const p = connect<Ctx>((s) => s.s, vi.fn())

  it('next disabled at last step', () => {
    expect(p.nextTrigger.disabled(wrap(init({ steps: ['a', 'b'], current: 1 })))).toBe(true)
    expect(p.nextTrigger.disabled(wrap(init({ steps: ['a', 'b'], current: 0 })))).toBe(false)
  })

  it('prev disabled at step 0', () => {
    expect(p.prevTrigger.disabled(wrap(init({ steps: ['a', 'b'], current: 0 })))).toBe(true)
  })

  it('item aria-current="step" for active', () => {
    expect(p.item(1).item['aria-current'](wrap(init({ steps: ['a', 'b'], current: 1 })))).toBe(
      'step',
    )
    expect(
      p.item(0).item['aria-current'](wrap(init({ steps: ['a', 'b'], current: 1 }))),
    ).toBeUndefined()
  })

  it('item data-status reflects computed status', () => {
    expect(
      p.item(0).item['data-status'](wrap(init({ steps: ['a', 'b'], current: 1, completed: [0] }))),
    ).toBe('completed')
  })

  it('nextTrigger click sends next', () => {
    const send = vi.fn()
    const pc = connect<Ctx>((s) => s.s, send)
    pc.nextTrigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'next' })
  })
})
