import { describe, it, expect, vi } from 'vitest'
import { init, update, connect } from '../../src/patterns/wizard'
import type { WizardValidators, WizardEffect } from '../../src/patterns/wizard'
import { rootSignal, read } from '../_signal'

describe('wizard reducer', () => {
  it('initializes from steps init', () => {
    const s = init({ steps: ['a', 'b', 'c'] })
    expect(s.steps.current).toBe(0)
    expect(s.steps.steps).toEqual(['a', 'b', 'c'])
    expect(s.validating).toBeNull()
  })

  it('next with passing sync validator marks completed + advances', () => {
    const validators: WizardValidators = { 0: () => true }
    const [s, fx] = update(init({ steps: ['a', 'b'] }), { type: 'next' }, validators)
    expect(s.steps.current).toBe(1)
    expect(s.steps.completed).toContain(0)
    expect(s.steps.errors).not.toContain(0)
    expect(fx).toEqual([])
  })

  it('next with failing sync validator marks error + stays', () => {
    const validators: WizardValidators = { 0: () => false }
    const [s, fx] = update(init({ steps: ['a', 'b'] }), { type: 'next' }, validators)
    expect(s.steps.current).toBe(0)
    expect(s.steps.completed).not.toContain(0)
    expect(s.steps.errors).toContain(0)
    expect(fx).toEqual([])
  })

  it('next with no validator passes through (advances)', () => {
    const [s] = update(init({ steps: ['a', 'b'] }), { type: 'next' })
    expect(s.steps.current).toBe(1)
    expect(s.steps.completed).toContain(0)
  })

  it('next clears a prior error on the step when it now passes', () => {
    const s0 = init({ steps: ['a', 'b'] })
    s0.steps.errors = [0]
    const [s] = update(s0, { type: 'next' }, { 0: () => true })
    expect(s.steps.errors).not.toContain(0)
    expect(s.steps.current).toBe(1)
  })

  it('next with Standard Schema (sync) passing advances', () => {
    const schema = {
      '~standard': {
        version: 1 as const,
        vendor: 'test',
        validate: () => ({ value: {} }),
      },
    }
    const [s] = update(init({ steps: ['a', 'b'] }), { type: 'next' }, { 0: schema })
    expect(s.steps.current).toBe(1)
  })

  it('next with Standard Schema (sync) failing marks error + stays', () => {
    const schema = {
      '~standard': {
        version: 1 as const,
        vendor: 'test',
        validate: () => ({ issues: [{ message: 'bad' }] }),
      },
    }
    const [s] = update(init({ steps: ['a', 'b'] }), { type: 'next' }, { 0: schema })
    expect(s.steps.current).toBe(0)
    expect(s.steps.errors).toContain(0)
  })

  it('async validator: next emits validateStep effect + sets validating, does NOT advance', () => {
    const validators: WizardValidators = { 0: () => Promise.resolve(true) }
    const [s, fx] = update(init({ steps: ['a', 'b'] }), { type: 'next' }, validators)
    expect(s.steps.current).toBe(0)
    expect(s.validating).toBe(0)
    expect(fx).toHaveLength(1)
    const eff = fx[0] as WizardEffect
    expect(eff.type).toBe('validateStep')
    expect(eff.step).toBe(0)
  })

  it('rapid next while validating is a no-op (no double-advance, no second effect)', () => {
    const validators: WizardValidators = { 0: () => Promise.resolve(true) }
    const [s1, fx1] = update(init({ steps: ['a', 'b'] }), { type: 'next' }, validators)
    expect(fx1).toHaveLength(1)
    const [s2, fx2] = update(s1, { type: 'next' }, validators)
    expect(s2.validating).toBe(0)
    expect(s2.steps.current).toBe(0)
    expect(fx2).toEqual([])
  })

  it('stepValid clears validating, marks completed + advances', () => {
    const v0 = init({ steps: ['a', 'b'] })
    const validators: WizardValidators = { 0: () => Promise.resolve(true) }
    const [s1] = update(v0, { type: 'next' }, validators)
    const [s2, fx] = update(s1, { type: 'stepValid', step: 0 })
    expect(s2.validating).toBeNull()
    expect(s2.steps.current).toBe(1)
    expect(s2.steps.completed).toContain(0)
    expect(fx).toEqual([])
  })

  it('stepInvalid clears validating, marks error + stays', () => {
    const v0 = init({ steps: ['a', 'b'] })
    const validators: WizardValidators = { 0: () => Promise.resolve(false) }
    const [s1] = update(v0, { type: 'next' }, validators)
    const [s2] = update(s1, { type: 'stepInvalid', step: 0 })
    expect(s2.validating).toBeNull()
    expect(s2.steps.current).toBe(0)
    expect(s2.steps.errors).toContain(0)
  })

  it('stale stepValid for a non-validating step is ignored', () => {
    const s0 = init({ steps: ['a', 'b'] })
    const [s] = update(s0, { type: 'stepValid', step: 0 })
    expect(s.steps.current).toBe(0)
    expect(s.validating).toBeNull()
  })

  it('prev is never gated by validation', () => {
    const s0 = init({ steps: ['a', 'b'], current: 1 })
    const [s] = update(s0, { type: 'prev' })
    expect(s.steps.current).toBe(0)
  })

  it('prev from step 0 stays', () => {
    const [s] = update(init({ steps: ['a', 'b'] }), { type: 'prev' })
    expect(s.steps.current).toBe(0)
  })

  it('linear goTo jump forward blocked unless completed', () => {
    const s0 = init({ steps: ['a', 'b', 'c'], current: 0, linear: true })
    const [s] = update(s0, { type: 'goTo', step: 2 })
    expect(s.steps.current).toBe(0)
  })

  it('non-linear goTo jumps anywhere', () => {
    const s0 = init({ steps: ['a', 'b', 'c'], current: 0, linear: false })
    const [s] = update(s0, { type: 'goTo', step: 2 })
    expect(s.steps.current).toBe(2)
  })

  it('goTo back is always allowed (linear)', () => {
    const s0 = init({ steps: ['a', 'b', 'c'], current: 2, linear: true })
    const [s] = update(s0, { type: 'goTo', step: 0 })
    expect(s.steps.current).toBe(0)
  })

  it('reset clears progress + validating', () => {
    const s0 = init({ steps: ['a', 'b'], current: 1 })
    s0.steps.completed = [0]
    s0.validating = 0
    const [s] = update(s0, { type: 'reset' })
    expect(s.steps.current).toBe(0)
    expect(s.steps.completed).toEqual([])
    expect(s.validating).toBeNull()
  })
})

describe('wizard.connect', () => {
  it('nextTrigger click sends next', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send)
    p.nextTrigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'next' })
  })

  it('prevTrigger click sends prev', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send)
    p.prevTrigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'prev' })
  })

  it('stepTrigger(i) click sends goTo', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send)
    p.stepTrigger(2).onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'goTo', step: 2 })
  })

  it('prevTrigger disabled at step 0', () => {
    const p = connect(rootSignal(), vi.fn())
    expect(read(p.prevTrigger.disabled, init({ steps: ['a', 'b'], current: 0 }))).toBe(true)
    expect(read(p.prevTrigger.disabled, init({ steps: ['a', 'b'], current: 1 }))).toBe(false)
  })

  it('nextTrigger disabled at last step', () => {
    const p = connect(rootSignal(), vi.fn())
    expect(read(p.nextTrigger.disabled, init({ steps: ['a', 'b'], current: 1 }))).toBe(true)
    expect(read(p.nextTrigger.disabled, init({ steps: ['a', 'b'], current: 0 }))).toBe(false)
  })

  it('nextTrigger disabled + aria-busy while validating', () => {
    const p = connect(rootSignal(), vi.fn())
    const validating = { ...init({ steps: ['a', 'b'], current: 0 }), validating: 0 }
    expect(read(p.nextTrigger.disabled, validating)).toBe(true)
    expect(read(p.nextTrigger['aria-busy'], validating)).toBe('true')
    const idle = init({ steps: ['a', 'b'], current: 0 })
    expect(read(p.nextTrigger['aria-busy'], idle)).toBeUndefined()
  })

  it('prevTrigger never gated by validating', () => {
    const p = connect(rootSignal(), vi.fn())
    const validating = { ...init({ steps: ['a', 'b'], current: 1 }), validating: 1 }
    expect(read(p.prevTrigger.disabled, validating)).toBe(false)
  })

  it('stepTrigger respects linear gating (forward blocked)', () => {
    const p = connect(rootSignal(), vi.fn())
    const st = init({ steps: ['a', 'b', 'c'], current: 0, linear: true })
    expect(read(p.stepTrigger(2).disabled, st)).toBe(true)
    expect(read(p.stepTrigger(0).disabled, st)).toBe(false)
  })

  it('item parts pass through from steps connect', () => {
    const p = connect(rootSignal(), vi.fn())
    expect(read(p.item(1).item['aria-current'], init({ steps: ['a', 'b'], current: 1 }))).toBe(
      'step',
    )
  })
})
