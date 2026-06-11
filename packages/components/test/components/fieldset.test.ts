import { describe, it, expect } from 'vitest'
import { init, update, connect } from '../../src/components/fieldset'
import type { FieldsetState } from '../../src/components/fieldset'
import { rootSignal, read } from '../_signal'

describe('fieldset reducer', () => {
  it('initializes with disabled/invalid false', () => {
    expect(init({ id: 'billing' })).toEqual({ id: 'billing', disabled: false, invalid: false })
  })

  it('honors init overrides', () => {
    expect(init({ id: 'billing', disabled: true })).toMatchObject({ disabled: true })
  })

  it('setDisabled toggles disabled', () => {
    const [s] = update(init({ id: 'x' }), { type: 'setDisabled', disabled: true })
    expect(s.disabled).toBe(true)
  })

  it('setInvalid toggles invalid', () => {
    const [s] = update(init({ id: 'x' }), { type: 'setInvalid', invalid: true })
    expect(s.invalid).toBe(true)
  })

  it('returns no effects', () => {
    const [, fx] = update(init({ id: 'x' }), { type: 'setDisabled', disabled: true })
    expect(fx).toEqual([])
  })
})

const stateOf = (over: Partial<FieldsetState> = {}): FieldsetState => ({
  ...init({ id: 'billing' }),
  ...over,
})

describe('fieldset.connect — legend association', () => {
  it('root is a group labelled by the legend', () => {
    const p = connect(rootSignal<FieldsetState>(), () => {}, { id: 'billing' })
    expect(p.root.role).toBe('group')
    expect(p.root['aria-labelledby']).toBe('billing:legend')
    expect(p.legend.id).toBe('billing:legend')
    expect(p.root['data-scope']).toBe('fieldset')
  })

  it('errorText is a derived stable polite live region', () => {
    const p = connect(rootSignal<FieldsetState>(), () => {}, { id: 'billing' })
    expect(p.errorText.id).toBe('billing:error')
    expect(p.errorText.role).toBe('alert')
    expect(p.errorText['aria-live']).toBe('polite')
  })
})

describe('fieldset.connect — disabled propagation', () => {
  it('native fieldset root reflects disabled so children inherit it', () => {
    const p = connect(rootSignal<FieldsetState>(), () => {}, { id: 'billing' })
    expect(read(p.root.disabled, stateOf({ disabled: true }))).toBe(true)
    expect(read(p.root.disabled, stateOf({ disabled: false }))).toBe(false)
  })

  it('aria-disabled mirrors disabled for the group semantics', () => {
    const p = connect(rootSignal<FieldsetState>(), () => {}, { id: 'billing' })
    expect(read(p.root['aria-disabled'], stateOf({ disabled: true }))).toBe('true')
    expect(read(p.root['aria-disabled'], stateOf({ disabled: false }))).toBeUndefined()
  })

  it('root exposes reactive data-invalid / data-disabled', () => {
    const p = connect(rootSignal<FieldsetState>(), () => {}, { id: 'billing' })
    expect(read(p.root['data-invalid'], stateOf({ invalid: true }))).toBe('')
    expect(read(p.root['data-disabled'], stateOf({ disabled: true }))).toBe('')
  })
})
